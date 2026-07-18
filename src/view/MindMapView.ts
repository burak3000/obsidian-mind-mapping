import { Menu, Notice, TAbstractFile, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import { parseMindMap } from "../sync/parser";
import { serializeMindMap, serializeSubtree, SerializeConfig } from "../sync/serializer";
import { computeLayout, DEFAULT_LAYOUT_CONFIG } from "../layout/layoutEngine";
import { SvgRenderer } from "../render/SvgRenderer";
import { Controller, ControllerListener } from "../controller/Controller";
import { InlineEditor } from "./InlineEditor";
import { debounce } from "../sync/debounce";
import { findEquivalentNode } from "../sync/reconcile";
import { navigateFrom, Direction } from "../render/navigation";
import { collectVisibleNodes } from "../model/visibility";
import { assignMissingColors } from "../render/colors";
import { assignMissingSides } from "../layout/sides";
import { ensurePersistentIds, forcePersistentId } from "../sync/metadata";
import { LinkKind, buildLinkText, getDisplayText, getImageEmbed, getSoleLink } from "../model/links";
import { MindNode } from "../model/types";
import { resolveRelations } from "../model/relations";
import { LinkModal, RelationTargetOption } from "./LinkModal";
import { SearchPanel } from "./SearchPanel";
import { searchNodes } from "../model/search";
import { MindMapSettings } from "../settings/PluginSettings";
import { LayoutConfig } from "../layout/layoutEngine";
import { resolveGoToTarget } from "../sync/goToSection";
import { parseExternalPaste } from "../sync/parseExternalPaste";

export const VIEW_TYPE_MINDMAP = "mindmap-view";

/** Decoupled from `main.ts`'s concrete Plugin class to avoid a circular import — anything with a live `settings` object works. */
export interface SettingsProvider {
	settings: MindMapSettings;
}

/**
 * M2: full edit pipeline. Keystrokes inside the inline editor never touch
 * the model (see InlineEditor); commits go through Controller, which
 * relayouts + does a dirty-tracked render update + schedules a debounced
 * write-back. External file changes are reconciled by best-effort
 * structural position matching (see reconcile.ts) with self-write echoes
 * suppressed by content comparison.
 */
export class MindMapView extends TextFileView implements ControllerListener {
	private controller: Controller | null = null;
	private renderer: SvgRenderer | null = null;
	private inlineEditor: InlineEditor | null = null;
	private searchPanel: SearchPanel | null = null;
	private lastWrittenText = "";
	/** The last markdown text *we* wrote to the OS clipboard (tree copy, plan item 06) — paste compares against this to tell "internal copy/cut" apart from "user copied something else outside the plugin". */
	private lastWrittenClipboardText: string | null = null;
	private readonly scheduleWrite: ReturnType<typeof debounce>;

	constructor(leaf: WorkspaceLeaf, private readonly settingsProvider: SettingsProvider) {
		super(leaf);
		// Debounce delay is baked in at construction time from the *current*
		// setting value — a mid-session settings change takes effect the next
		// time a map is opened, not live. See DECISIONS.md.
		this.scheduleWrite = debounce(() => this.writeNow(), this.settingsProvider.settings.writeDebounceMs);
	}

	private get layoutConfig(): LayoutConfig {
		return { ...DEFAULT_LAYOUT_CONFIG, mode: this.settingsProvider.settings.layoutMode };
	}

	private get serializeConfig(): SerializeConfig {
		return { headingDepth: this.settingsProvider.settings.headingDepth };
	}

	getViewType(): string {
		return VIEW_TYPE_MINDMAP;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Mind map";
	}

	getIcon(): string {
		return "git-fork";
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, _clear: boolean): void {
		this.data = data;
		this.lastWrittenText = data;
		this.buildFromScratch();
	}

	clear(): void {
		this.scheduleWrite.cancel();
		this.inlineEditor?.destroy();
		this.inlineEditor = null;
		this.searchPanel?.destroy();
		this.searchPanel = null;
		this.renderer?.destroy();
		this.renderer = null;
		this.controller = null;
		this.data = "";
	}

	async onOpen(): Promise<void> {
		this.contentEl.tabIndex = 0;
		this.registerDomEvent(this.contentEl, "keydown", (evt) => this.onKeyDown(evt));
		this.registerDomEvent(this.contentEl, "mousedown", (evt) => {
			// Don't steal focus from the inline editor or search panel — a
			// click there is the user placing the caret / typing a query, not
			// a request to refocus the mind map canvas. Blurring the editor
			// on its own click-to-position-cursor was committing (and
			// closing) it out from under the user.
			if ((evt.target as HTMLElement).closest(".mm-inline-editor, .mm-search-panel")) return;
			this.contentEl.focus();
		});
		this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultModify(file)));
		this.addAction("search", "Search mind map", () => this.toggleSearch());
	}

	onunload(): void {
		this.scheduleWrite.cancel();
		this.inlineEditor?.destroy();
		this.searchPanel?.destroy();
		this.renderer?.destroy();
	}

	private buildFromScratch(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("mindmap-view-container");

		const fallbackTitle = this.file?.basename ?? "Untitled";
		const model = parseMindMap(this.data, fallbackTitle);
		assignMissingColors(model.root);
		assignMissingSides(model.root);
		computeLayout(model.root, this.layoutConfig);
		// R1a/R2: classify every node's links before the first mount, so
		// relation arrows and cross-doc badges are present from the very first
		// paint, not just after the first edit.
		const activeRelations = resolveRelations(model, this.file?.basename ?? null);

		this.inlineEditor?.destroy();
		this.inlineEditor = null;
		this.searchPanel?.destroy();
		this.searchPanel = null;
		this.controller = new Controller(model);
		this.controller.addListener(this);

		this.renderer?.destroy();
		this.renderer = new SvgRenderer(container, this.settingsProvider.settings.animationNodeThreshold, this.layoutConfig, this.settingsProvider.settings.showRelations);
		this.renderer.setNodeClickHandler((id, evt) => {
			if (evt.ctrlKey || evt.metaKey) this.controller?.toggleSelection(id);
			else if (evt.shiftKey) this.controller?.selectRange(id);
			else this.controller?.select(id);
		});
		this.renderer.setNodeDblClickHandler((id) => this.controller?.requestEdit(id));
		this.renderer.setBadgeClickHandler((id) => this.controller?.toggleFold(id));
		this.renderer.setCrossDocBadgeClickHandler((id) => this.openCrossDocRelation(id));
		this.renderer.setBackgroundClickHandler(() => this.controller?.select(null));
		this.renderer.setNodeContextMenuHandler((id, evt) => this.showNodeMenu(id, evt));
		this.renderer.setLinkClickHandler((kind, target) => this.openLink(kind, target));
		this.renderer.setImageClickHandler((kind, target) => this.openImage(kind, target));
		this.renderer.setImageResolver((node) => this.resolveNodeImageUrl(node));
		this.renderer.setManualMoveHandler((id, pos) => this.controller?.setManualPosition(id, pos));
		this.renderer.setReorderHandler((id, targetId, position) => this.controller?.moveNode(id, targetId, position));
		this.renderer.setManualWidthHandler((id, width) => this.controller?.setManualWidth(id, width));
		this.renderer.mount(model, activeRelations);
	}

	// --- ControllerListener ---

	onChange(): void {
		if (!this.controller || !this.renderer) return;
		assignMissingColors(this.controller.model.root);
		assignMissingSides(this.controller.model.root);
		computeLayout(this.controller.model.root, this.layoutConfig);
		// R1a/R2: re-classify every node's links against the now-current tree
		// (a rename/delete/undo can change which block ids exist) *before*
		// ensurePersistentIds/serialize, since both depend on the
		// `isRelationTarget` flags this sets (R1a item 2 — forces a relation's
		// target to keep its block-id suffix across serialize). See
		// model/relations.ts's own doc comment for why this walk is cheap
		// despite running on every change, not just relation edits.
		const activeRelations = resolveRelations(this.controller.model, this.file?.basename ?? null);
		this.renderer.update(this.controller.model, activeRelations);
		this.renderer.setSelection(this.controller.selectedIds, this.controller.selectedId);
		ensurePersistentIds(this.controller.model.root, this.controller.model.byId);
		this.data = serializeMindMap(this.controller.model, this.serializeConfig);
		this.scheduleWrite();
	}

	onEditRequest(nodeId: string): void {
		this.ensureNodeVisibleForEdit(nodeId);
		this.openInlineEditor(nodeId);
	}

	// --- Inline editing ---

	/**
	 * F2: a freshly created node (Tab/Enter/Shift+Enter -> addChildToSelected/
	 * addSiblingToSelected) can land outside the current viewport — or, on a
	 * >300-node map, entirely culled out of the DOM (see `SvgRenderer`'s
	 * culling threshold) — with nothing panning to it first. Runs ahead of
	 * every `openInlineEditor` call (F2/dblclick-on-an-existing-node included)
	 * rather than being duplicated per creation shortcut: an already-visible
	 * node (the common F2/dblclick case) costs nothing extra, since
	 * `ensureWorldRectVisible` no-ops and skips the recull entirely (D4,
	 * minimal-pan — see DECISIONS.md). Must run *before* `openInlineEditor`
	 * reads `getNodeScreenRect`: panning is what re-culls and creates the
	 * node's DOM element in the first place when it was previously culled
	 * out, and `ensureWorldRectVisible` does that re-cull synchronously
	 * (not rAF-batched) for exactly this reason.
	 */
	private ensureNodeVisibleForEdit(nodeId: string): void {
		if (!this.controller || !this.renderer) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node?.layout) return;
		this.renderer.ensureWorldRectVisible(node.layout);
	}

	private openInlineEditor(nodeId: string): void {
		if (!this.controller || !this.renderer) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const rect = this.renderer.getNodeScreenRect(nodeId);
		if (!rect) return;
		const { minWidth, maxWidth, fontSize } = this.renderer.getNodeEditMetrics(node);

		this.inlineEditor?.destroy();
		this.inlineEditor = new InlineEditor(this.contentEl, {
			initialText: node.text,
			rect,
			minWidth,
			maxWidth,
			fontSize,
			onCommit: (text) => {
				this.inlineEditor = null;
				this.controller?.commitRename(nodeId, text);
				this.controller?.select(nodeId);
				// Committing can grow the node (empty -> real, possibly
				// multi-line text), reflowing the branch enough to push a node
				// we panned to at create-time back out past the viewport margin
				// — which reads as the view "jumping back" and losing the node
				// on Enter. Re-run the minimal-pan ensure-visible now that
				// layout reflects the final text so the completed node stays in
				// view. No-op (D4) when it's still comfortably visible.
				this.ensureNodeVisibleForEdit(nodeId);
				this.contentEl.focus();
			},
			onCancel: () => {
				this.inlineEditor = null;
				this.contentEl.focus();
			},
			onCommitAndCreateChild: (text) => {
				this.inlineEditor = null;
				this.controller?.commitRename(nodeId, text);
				this.controller?.select(nodeId);
				this.controller?.addChildToSelected();
			},
		});
	}

	// --- Links (R5) ---

	private openLink(kind: LinkKind, target: string): void {
		if (kind === "wikilink") {
			this.app.workspace.openLinkText(target, this.file?.path ?? "", false);
			return;
		}
		// mdlink: an external URL opens in the system browser; anything else
		// is treated as a vault-relative path (note, attachment, etc.) and
		// resolved the same way a wikilink would be.
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
			window.open(target, "_blank");
		} else {
			this.app.workspace.openLinkText(target, this.file?.path ?? "", false);
		}
	}

	/** R-image-display, decision A: clicking a node's image thumbnail opens the image — in a new tab, unlike `openLink`, so the mind map stays open (same reasoning as "Go to note section" always opening in a new tab). */
	private openImage(kind: LinkKind, target: string): void {
		if (kind === "mdlink" && /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
			window.open(target, "_blank");
			return;
		}
		this.app.workspace.openLinkText(target, this.file?.path ?? "", true);
	}

	/** R-image-display: resolves a node's image embed target to a displayable URL — remote URLs are used as-is; vault-relative targets go through Obsidian's native attachment resolution (`getFirstLinkpathDest` + `getResourcePath`), same mechanism a normal embedded image in a markdown note uses. Null (embed present but unresolvable, or no embed at all) leaves the renderer's placeholder/missing-glyph showing. */
	private resolveNodeImageUrl(node: MindNode): string | null {
		const embed = getImageEmbed(node.text);
		if (!embed) return null;
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(embed.target)) return embed.target;
		const dest = this.app.metadataCache.getFirstLinkpathDest(embed.target, this.file?.path ?? "");
		return dest ? this.app.vault.getResourcePath(dest) : null;
	}

	/** R2: clicking a node's cross-document badge opens its first cross-doc relation target via the same path a regular link click uses (`openLink`, reused rather than reinvented per the plan). A node with several cross-doc relations (rare) only opens the first — a picker for that case is outside the minimum badge+click design (D3). */
	private openCrossDocRelation(nodeId: string): void {
		if (!this.controller) return;
		const node = this.controller.model.byId.get(nodeId);
		const relation = node?.resolvedRelations?.find((r) => r.kind === "cross-doc");
		if (!relation) return;
		this.openLink(relation.linkKind, relation.rawTarget);
	}

	/** Display label for a node in the relation-target picker (R1a authoring): its link-stripped text, truncated so long node text doesn't blow out the dropdown. */
	private relationOptionLabel(node: MindNode): string {
		const text = getDisplayText(node.text).trim() || "(untitled)";
		return text.length > 48 ? `${text.slice(0, 48)}…` : text;
	}

	/**
	 * Ctrl/Cmd+Shift+L (R5, extended by R1a item 6; moved off Ctrl/Cmd+K —
	 * see the keydown handler): besides the existing free-text
	 * wikilink/URL editor, offers a dropdown of every other node in this map
	 * as a same-document relation target. Picking one forces that target to
	 * have a persistent block id *before* building the link text
	 * (`forcePersistentId` — see its own doc comment in sync/metadata.ts for
	 * why minting has to happen here, at authoring time, rather than being
	 * left to the next `ensurePersistentIds` pass), then writes `[[#^id]]`
	 * to the source node via the same `commitRename` path every other edit
	 * here already uses (undo/redo, debounced write-back, all unchanged).
	 */
	private openLinkEditor(nodeId: string): void {
		if (!this.controller) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const existing = getSoleLink(node.text);
		const existingRelation = node.resolvedRelations?.find((r) => r.kind === "same-doc");
		const relationTargetNode = existingRelation?.targetId ? this.controller.model.byId.get(existingRelation.targetId) : undefined;

		const relationTargets: RelationTargetOption[] = [];
		const collectTargets = (n: MindNode) => {
			if (n !== node) relationTargets.push({ id: n.id, label: this.relationOptionLabel(n) });
			n.children.forEach(collectTargets);
		};
		collectTargets(this.controller.model.root);

		// A bare `[[#^id]]` link (no alias) prefills an ugly raw-target label
		// ("#^id") — when it's a resolved same-doc relation, show the target
		// node's own text instead, a much more meaningful default.
		const initialLabel = existing && existingRelation && existing.label === existing.target && relationTargetNode ? this.relationOptionLabel(relationTargetNode) : (existing?.label ?? node.text);

		new LinkModal(this.app, {
			initialLabel,
			initialKind: existing?.kind ?? "wikilink",
			initialTarget: existing?.target ?? "",
			hasExistingLink: existing !== null,
			relationTargets,
			initialRelationTargetNodeId: existingRelation?.targetId,
			onSave: (result) => {
				if (result.relationTargetNodeId) {
					const targetNode = this.controller?.model.byId.get(result.relationTargetNodeId);
					if (targetNode && this.controller) {
						const id = forcePersistentId(targetNode, this.controller.model.byId);
						this.controller.commitRename(nodeId, buildLinkText({ label: result.label, kind: "wikilink", target: `#^${id}` }));
					}
					return;
				}
				this.controller?.commitRename(nodeId, buildLinkText(result));
			},
			onRemove: () => {
				if (existing) this.controller?.commitRename(nodeId, existing.label);
			},
			onClose: () => this.contentEl.focus(),
		}).open();
	}

	/** "Rebalance" command (plan §9.3) — exposed for main.ts's Obsidian command to call on the active view. */
	rebalance(): void {
		this.controller?.rebalance();
	}

	// --- Context menu (R-context-menu) ---

	/** Right-click on a node: select it first (menu actions operate on the selection, same as the keyboard shortcuts), then show an Obsidian-native `Menu` with "Go to note section" plus the existing keyboard-shortcut actions. */
	private showNodeMenu(nodeId: string, evt: MouseEvent): void {
		if (!this.controller) return;
		this.controller.select(nodeId);
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;

		const target = resolveGoToTarget(this.controller.model, node, this.serializeConfig);
		const menu = new Menu();
		menu
			.addItem((item) =>
				item
					.setTitle("Go to note section")
					.setIcon("arrow-right-to-line")
					.setDisabled(target.kind === "unavailable")
					.onClick(() => this.goToNoteSection(nodeId))
			)
			.addSeparator()
			.addItem((item) => item.setTitle("Edit").setIcon("pencil").onClick(() => this.controller?.requestEdit(nodeId)))
			.addItem((item) =>
				item
					.setTitle("Add child")
					.setIcon("plus")
					.onClick(() => this.controller?.addChildToSelected())
			)
			.addItem((item) =>
				item
					.setTitle("Add sibling")
					.setIcon("list-plus")
					.onClick(() => this.controller?.addSiblingToSelected("after"))
			)
			.addItem((item) => item.setTitle("Edit link").setIcon("link").onClick(() => this.openLinkEditor(nodeId)))
			.addItem((item) =>
				item
					.setTitle(node.folded ? "Unfold" : "Fold")
					.setIcon(node.folded ? "chevron-right" : "chevron-down")
					.onClick(() => this.controller?.toggleFold(nodeId))
			)
			.addSeparator()
			.addItem((item) =>
				item
					.setTitle("Copy")
					.setIcon("copy")
					.onClick(() => {
						this.controller?.copySelected();
						this.writeClipboardText();
					})
			)
			.addItem((item) =>
				item
					.setTitle("Cut")
					.setIcon("scissors")
					.onClick(() => {
						this.controller?.cutSelected();
						this.writeClipboardText();
					})
			)
			.addItem((item) =>
				item
					.setTitle("Paste")
					.setIcon("clipboard-paste")
					.onClick(() => this.handlePaste())
			)
			.addItem((item) =>
				item
					.setTitle("Copy subtree as markdown")
					.setIcon("clipboard-copy")
					.onClick(() => {
						// Just this one node's subtree, regardless of any active
						// multi-selection — doesn't touch the internal clipboard,
						// so it doesn't disturb a pending Ctrl+C/X paste target.
						navigator.clipboard?.writeText(serializeSubtree(node)).catch(() => {});
					})
			)
			.addSeparator()
			.addItem((item) => item.setTitle("Delete").setIcon("trash").onClick(() => this.controller?.deleteSelected()));

		menu.showAtMouseEvent(evt);
	}

	/** "Go to note section": opens the backing file (new tab, so the map stays open) and jumps to the exact heading/list line the node came from — three-tier target resolution, see `resolveGoToTarget`. */
	private async goToNoteSection(nodeId: string): Promise<void> {
		if (!this.controller || !this.file) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const target = resolveGoToTarget(this.controller.model, node, this.serializeConfig);
		if (target.kind === "unavailable") return;

		// The map's own edits are debounced up to writeDebounceMs — flush first
		// so the markdown view (and, for the line-number fallback, the line
		// count it's opened against) reflects the current content, not
		// whatever was last actually written to disk.
		await this.flushPendingWrite();

		if (target.kind === "blockid") {
			await this.app.workspace.openLinkText(`#^${target.ref}`, this.file.path, true);
		} else if (target.kind === "heading") {
			await this.app.workspace.openLinkText(`#${target.ref}`, this.file.path, true);
		} else {
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(this.file, { eState: { line: target.line } });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	/** Ctrl/Cmd+M toggle (R-ctrl-m): flushes any pending debounced write immediately, so switching to the markdown editor right after an edit doesn't show stale content. No-op if there's nothing pending. */
	async flushPendingWrite(): Promise<void> {
		this.scheduleWrite.cancel();
		if (this.data !== this.lastWrittenText) await this.writeNow();
	}

	// --- OS clipboard ("tree copy", plan item 06) ---
	//
	// All raw `navigator.clipboard` I/O lives here, not in Controller — its
	// mutation methods (`pasteToSelected`/`pasteSubtrees`) stay fully
	// synchronous and testable without stubbing the clipboard API. Copy/cut
	// write the exported markdown after the fact; paste reads the OS
	// clipboard and decides which of the two paste paths applies before
	// calling into the (synchronous) Controller.

	/** After copySelected()/cutSelected(): mirrors the just-copied subtree(s) to the OS clipboard as plain markdown, so it can be pasted into any other app. Fire-and-forget — a denied/unavailable clipboard permission shouldn't block the (already-completed) internal copy. */
	private writeClipboardText(): void {
		if (!this.controller) return;
		const text = this.controller.getClipboardMarkdown();
		if (text === null) return;
		this.lastWrittenClipboardText = text;
		navigator.clipboard?.writeText(text)?.catch(() => {
			/* permission denied or unavailable — internal clipboard still works for paste-within-the-plugin */
		});
	}

	/**
	 * Ctrl/Cmd+V: an image on the OS clipboard (screenshot, copied from a
	 * browser, etc.) takes priority — saved into the vault's attachment
	 * folder and inserted as a new child node whose text is its embed
	 * markdown, since there's no meaningful "paste as text" fallback for
	 * image bytes. Otherwise, reads clipboard text; if it differs from what
	 * we last wrote ourselves, the user copied something from *outside*
	 * this plugin, so parse it (`parseExternalPaste`) and insert that
	 * instead of the (stale, in this case) internal clipboard.
	 */
	private async handlePaste(): Promise<void> {
		if (!this.controller) return;

		const embedText = await this.pasteClipboardImage();
		if (embedText !== null) {
			this.controller.pasteImageAsChild(embedText);
			return;
		}

		let osText: string | null = null;
		try {
			osText = (await navigator.clipboard?.readText()) ?? null;
		} catch {
			osText = null; // permission denied / unavailable — fall through to the internal clipboard
		}
		if (osText !== null && osText !== this.lastWrittenClipboardText) {
			const nodes = parseExternalPaste(osText);
			if (nodes.length > 0) {
				this.controller.pasteSubtrees(nodes);
				return;
			}
		}
		this.controller.pasteToSelected();
	}

	/** SVG extensions are the one common image type mismatched between MIME subtype (`svg+xml`) and file extension (`svg`) — every other type we handle (`png`, `jpeg`→treated as `jpg`, `gif`, `webp`, `bmp`) already matches. */
	private static readonly IMAGE_EXT_FOR_MIME: Record<string, string> = { jpeg: "jpg", "svg+xml": "svg" };

	/**
	 * If the OS clipboard holds image data, writes it into the vault's
	 * configured attachment location and returns the embed markdown
	 * (`![[Pasted image ...]]`) to insert as a new node — null if the
	 * clipboard has no image (falls through to the text-paste path in
	 * `handlePaste`) or the read/write fails (permission denied, no active
	 * file, unsupported browser API — same defensive style as
	 * `writeClipboardText`/`handlePaste`'s own text read).
	 */
	private async pasteClipboardImage(): Promise<string | null> {
		if (!this.file || typeof navigator.clipboard?.read !== "function") return null;
		let items: ClipboardItems;
		try {
			items = await navigator.clipboard.read();
		} catch {
			return null;
		}
		for (const item of items) {
			const mime = item.types.find((t) => t.startsWith("image/"));
			if (!mime) continue;
			try {
				const blob = await item.getType(mime);
				const subtype = mime.slice("image/".length);
				const ext = MindMapView.IMAGE_EXT_FOR_MIME[subtype] ?? subtype;
				const stamp = window.moment ? window.moment().format("YYYYMMDDHHmmss") : String(Date.now());
				const filename = `Pasted image ${stamp}.${ext}`;
				const path = await this.app.fileManager.getAvailablePathForAttachment(filename, this.file.path);
				const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
				return `![[${this.app.metadataCache.fileToLinktext(file, this.file.path)}]]`;
			} catch {
				new Notice("Mind map: couldn't paste the clipboard image.");
				return null;
			}
		}
		return null;
	}

	// --- Search ---

	/** Exposed for main.ts's Obsidian command and the header search action. Opens the panel, or just refocuses it if it's already open — same as a browser's find-in-page shortcut. */
	toggleSearch(): void {
		if (this.searchPanel) {
			this.searchPanel.focus();
			return;
		}
		this.openSearchPanel();
	}

	private openSearchPanel(): void {
		if (!this.controller) return;
		this.searchPanel = new SearchPanel(this.contentEl, {
			onQuery: (query) => searchNodes(this.controller!.model.root, query),
			onSelect: (nodeId) => this.focusNode(nodeId),
			onClose: () => this.closeSearchPanel(),
		});
	}

	private closeSearchPanel(): void {
		this.searchPanel?.destroy();
		this.searchPanel = null;
		this.contentEl.focus();
	}

	/** Unfolds whatever's hiding a node (if anything), selects it, and pans the view to center it — used for both search results and (later) any other "jump to a node that might be off-screen" need. */
	private focusNode(nodeId: string): void {
		if (!this.controller || !this.renderer) return;
		this.controller.revealAndSelect(nodeId);
		const node = this.controller.model.byId.get(nodeId);
		if (node?.layout) {
			this.renderer.centerOnWorldPoint(node.layout.x + node.layout.w / 2, node.layout.y + node.layout.h / 2);
		}
	}

	// --- Keyboard shortcuts (plan §8) ---

	private onKeyDown(evt: KeyboardEvent): void {
		if (this.inlineEditor || !this.controller) return; // InlineEditor owns keys while editing
		const mod = evt.ctrlKey || evt.metaKey;

		if (mod && evt.key.toLowerCase() === "f") {
			evt.preventDefault();
			this.toggleSearch();
			return;
		}

		if (evt.key === "Escape") {
			evt.preventDefault();
			this.controller.collapseSelection();
			return;
		}

		if (evt.key === "Tab") {
			evt.preventDefault();
			this.controller.addChildToSelected();
		} else if (evt.key === "Enter" && !mod) {
			evt.preventDefault();
			this.controller.addSiblingToSelected(evt.shiftKey ? "before" : "after");
		} else if (evt.key === "F2" || (evt.key === " " && !mod)) {
			evt.preventDefault();
			if (this.controller.selectedId) this.controller.requestEdit(this.controller.selectedId);
		} else if (evt.key === "Delete" || evt.key === "Backspace") {
			evt.preventDefault();
			this.controller.deleteSelected();
		} else if (mod && evt.key.toLowerCase() === "z" && evt.shiftKey) {
			evt.preventDefault();
			this.controller.redo();
		} else if (mod && evt.key.toLowerCase() === "z") {
			evt.preventDefault();
			this.controller.undo();
		} else if (mod && evt.key.toLowerCase() === "y") {
			evt.preventDefault();
			this.controller.redo();
		} else if (evt.altKey && (evt.key === "ArrowUp" || evt.key === "ArrowDown")) {
			// Keyboard equivalent of the drag-reorder before/after gesture:
			// reorders the selected node among its own siblings rather than
			// changing the selection (checked ahead of the plain-arrow
			// navigation branch below, which this would otherwise fall into).
			evt.preventDefault();
			this.controller.moveSelectedInSiblingOrder(evt.key === "ArrowUp" ? "up" : "down");
		} else if (evt.key === "ArrowUp" || evt.key === "ArrowDown" || evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
			evt.preventDefault();
			this.navigate(evt.key);
		} else if (mod && evt.key === "Home") {
			evt.preventDefault();
			this.renderer?.centerOnRoot();
		} else if (mod && evt.key === "/") {
			evt.preventDefault();
			if (this.controller.selectedId) this.controller.toggleFold(this.controller.selectedId);
		} else if (mod && evt.shiftKey && evt.key.toLowerCase() === "c") {
			// Second binding for the same fold/unfold action as Mod+/ above —
			// not a replacement. Not known to collide with anything in this
			// plugin or an Obsidian core default at the time this was added;
			// if it turns out to clash with something in a live vault
			// (Settings -> Hotkeys), rebind the same way Mod+K -> Mod+Shift+L
			// was resolved for the link editor.
			evt.preventDefault();
			if (this.controller.selectedId) this.controller.toggleFold(this.controller.selectedId);
		} else if (mod && evt.shiftKey && evt.key.toLowerCase() === "l") {
			// Not Mod+K: Obsidian's own core "Insert markdown link" command
			// defaults to that binding and its global hotkey manager wins the
			// keystroke before this view-scoped handler ever sees it (same
			// class of collision as the Rebalance command's move off
			// Mod+Shift+B — see DECISIONS.md).
			evt.preventDefault();
			if (this.controller.selectedId) this.openLinkEditor(this.controller.selectedId);
		} else if (mod && evt.key.toLowerCase() === "c") {
			evt.preventDefault();
			this.controller.copySelected();
			this.writeClipboardText();
		} else if (mod && evt.key.toLowerCase() === "x") {
			evt.preventDefault();
			this.controller.cutSelected();
			this.writeClipboardText();
		} else if (mod && evt.key.toLowerCase() === "v") {
			evt.preventDefault();
			this.handlePaste();
		}
	}

	private navigate(key: string): void {
		if (!this.controller) return;
		if (!this.controller.selectedId) {
			// First arrow press with nothing selected: select the root as
			// visible feedback instead of silently navigating from it.
			this.controller.select(this.controller.model.root.id);
			return;
		}
		const node = this.controller.model.byId.get(this.controller.selectedId);
		if (!node) return;
		const direction: Direction = key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : "right";
		const visible = collectVisibleNodes(this.controller.model.root);
		const next = navigateFrom(node, direction, visible);
		if (next) this.controller.select(next.id);
	}

	// --- Sync: debounced write-back + external-change reconciliation ---

	private async writeNow(): Promise<void> {
		if (!this.file) return;
		const text = this.data;
		this.lastWrittenText = text;
		await this.app.vault.modify(this.file, text);
	}

	private async onVaultModify(file: TAbstractFile): Promise<void> {
		if (file !== this.file || !this.controller) return;
		// Don't yank the model out from under an active edit.
		if (this.inlineEditor) return;

		const text = await this.app.vault.cachedRead(file as TFile);
		if (text === this.lastWrittenText || text === this.data) return; // our own echo

		const hasPendingWrite = this.data !== this.lastWrittenText;
		if (hasPendingWrite) {
			// N2: never silently drop either side. Keep the in-editor state (it
			// will still be written back on the next debounce tick) and tell
			// the user rather than guessing at a merge.
			new Notice("Mind map: file changed externally while you had unsaved edits. Kept your in-editor changes.");
			return;
		}

		const fallbackTitle = this.file?.basename ?? "Untitled";
		const oldModel = this.controller.model;
		const oldSelectedId = this.controller.selectedId;
		const newModel = parseMindMap(text, fallbackTitle);
		// Carry over first-level branch colors and sides by structural
		// position so an external reparse doesn't visually reshuffle
		// existing branches (same reasoning as the sticky-sides fix — see
		// DECISIONS.md).
		oldModel.root.children.forEach((oldChild, index) => {
			const newChild = newModel.root.children[index];
			if (!newChild) return;
			if (oldChild.colorKey) newChild.colorKey = oldChild.colorKey;
			if (oldChild.branchSide) newChild.branchSide = oldChild.branchSide;
		});
		assignMissingColors(newModel.root);
		assignMissingSides(newModel.root);
		computeLayout(newModel.root, this.layoutConfig);
		const activeRelations = resolveRelations(newModel, this.file?.basename ?? null);

		let newSelectedId: string | null = null;
		const oldSelectedNode = oldSelectedId ? oldModel.byId.get(oldSelectedId) : undefined;
		if (oldSelectedNode) {
			newSelectedId = findEquivalentNode(newModel.root, oldSelectedNode)?.id ?? null;
		}

		this.data = text;
		this.lastWrittenText = text;
		this.controller.removeListener(this);
		this.controller = new Controller(newModel);
		this.controller.selectedId = newSelectedId;
		this.controller.addListener(this);
		// Full re-parse assigns fresh synthetic ids to any node without a
		// persisted ^blockid (metadata-bearing nodes keep their real id
		// straight from the text — see reconcile.ts), so this is a fresh
		// mount, not a diffed update; the plan explicitly allows full
		// re-parse as the M2 fallback (incremental region re-parse is a
		// later optimization).
		this.renderer?.mount(newModel, activeRelations);
		this.renderer?.selectNode(newSelectedId);
	}
}
