import { Menu, Notice, Platform, TAbstractFile, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
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
import {
	LinkKind,
	appendLinkText,
	buildLinkText,
	getDisplayText,
	getImageEmbed,
	isUrlTarget,
	isAbsoluteFilesystemPath,
	normalizeUrlTarget,
	expandHomePath,
	removeLinkOccurrence,
} from "../model/links";
import { MindMapModel, MindNode } from "../model/types";
import { BADGE_DEFS } from "../model/statusBadges";
import { listNodeLinkItems, resolveRelations } from "../model/relations";
import { LinkModal, RelationTarget, RelationTargetOption, DocumentOption } from "./LinkModal";
import { CURRENT_DOCUMENT_ID, commitForeignRelationTarget, resolveRelationTargetsForDocument } from "../sync/foreignRelation";
import { SearchPanel } from "./SearchPanel";
import { searchNodes } from "../model/search";
import { MindMapSettings } from "../settings/PluginSettings";
import { LayoutConfig } from "../layout/layoutEngine";
import { resolveGoToTarget } from "../sync/goToSection";
import { parseExternalPaste } from "../sync/parseExternalPaste";

export const VIEW_TYPE_MINDMAP = "mindmap-view";

/**
 * Builds a context-menu item title with the label left-aligned and a muted,
 * parenthesized keyboard-shortcut hint pushed to the right. Obsidian's
 * `Menu`/`MenuItem` only auto-shows a hotkey hint for items backed by a
 * registered `Command` — these menu items are plain `onClick` closures (see
 * `showNodeMenu`), so nothing surfaces the matching `onKeyDown` binding
 * otherwise, even though most of these actions do have one. `setTitle`
 * accepts a `DocumentFragment` as well as a plain string (Obsidian API), so
 * the hint is rendered directly into the title rather than needing any
 * private/internal menu API.
 *
 * The row's own `min-width` (styles.css `.mm-menu-item-row`) is what
 * actually pushes the hint right, not `justify-content` alone: Obsidian's
 * `.menu-item-title` wraps its content at that content's own natural
 * (shrink-to-fit) width rather than stretching to the full menu width, so a
 * flex child asking for 100% of an undefined/shrink-wrapped parent width
 * gets no extra space to distribute. A `min-width` sets a floor on our own
 * row regardless of what the ancestor does, and since every menu already
 * sizes itself to its widest item ("Copy subtree as markdown" here), every
 * row ends up rendered at a consistent width — the hints line up as a
 * column instead of sitting flush against varying-length labels.
 *
 * `mac`/`other` are given as pre-formatted strings (rather than a generic
 * modifier-list formatter) since this is a small, fixed set of shortcuts.
 */
function menuItemTitle(label: string, hotkey?: { mac: string; other: string }): string | DocumentFragment {
	if (!hotkey) return label;
	const frag = document.createDocumentFragment();
	const row = document.createElement("span");
	row.classList.add("mm-menu-item-row");
	const labelEl = document.createElement("span");
	labelEl.classList.add("mm-menu-item-label");
	labelEl.textContent = label;
	const hintEl = document.createElement("span");
	hintEl.classList.add("mm-menu-item-hotkey");
	hintEl.textContent = `(${Platform.isMacOS ? hotkey.mac : hotkey.other})`;
	row.appendChild(labelEl);
	row.appendChild(hintEl);
	frag.appendChild(row);
	return frag;
}

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
	/** F3: the node `inlineEditor` is currently editing, kept in sync with `inlineEditor` itself (set together, cleared together) so the viewport-change handler knows which node's screen rect to recompute. Null whenever `inlineEditor` is null. */
	private editingNodeId: string | null = null;
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
		this.editingNodeId = null;
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
		this.editingNodeId = null;
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
		this.renderer.setStatusBadgeClickHandler((id) => this.showStatusBadgeMenuForNode(id));
		this.renderer.setBackgroundClickHandler(() => this.controller?.select(null));
		this.renderer.setNodeContextMenuHandler((id, evt) => this.showNodeMenu(id, evt));
		this.renderer.setLinkClickHandler((kind, target) => this.openLink(kind, target));
		this.renderer.setImageClickHandler((kind, target) => this.openImage(kind, target));
		this.renderer.setImageResolver((node) => this.resolveNodeImageUrl(node));
		this.renderer.setManualMoveHandler((id, pos) => this.controller?.setManualPosition(id, pos));
		this.renderer.setReorderHandler((id, targetId, position) => this.controller?.moveNode(id, targetId, position));
		this.renderer.setManualWidthHandler((id, width) => this.controller?.setManualWidth(id, width));
		this.renderer.setViewportChangeHandler(() => this.repositionInlineEditorForViewport());
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
				this.editingNodeId = null;
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
				this.editingNodeId = null;
				this.contentEl.focus();
			},
			onCommitAndCreateChild: (text) => {
				this.inlineEditor = null;
				this.editingNodeId = null;
				this.controller?.commitRename(nodeId, text);
				this.controller?.select(nodeId);
				this.controller?.addChildToSelected();
			},
		});
		this.editingNodeId = nodeId;
	}

	/**
	 * F3: fired once per applied viewport frame (see
	 * `SvgRenderer.setViewportChangeHandler`'s doc comment) — re-syncs the
	 * open inline editor's on-screen position (and font size) to the node it
	 * is editing, since panning/zooming moves the node underneath the
	 * overlay without the overlay knowing. No-ops immediately whenever no
	 * editor is open (the common case, including every frame of ordinary
	 * pan/zoom with nothing being edited), so this adds no cost outside an
	 * active edit session.
	 */
	private repositionInlineEditorForViewport(): void {
		if (!this.inlineEditor || !this.editingNodeId || !this.controller || !this.renderer) return;
		const rect = this.renderer.getNodeScreenRect(this.editingNodeId);
		// The node being edited was visible when the editor opened, but an
		// extreme pan can cull it back out of the DOM before its box is
		// re-created (see `getNodeScreenRect`'s doc comment / `lastLayout`
		// pruning in `recull`) — skip repositioning this frame rather than
		// crash or fight the DOM; the next applied frame (e.g. panning back)
		// will pick it up again once the node re-enters the culled set.
		if (!rect) return;
		const node = this.controller.model.byId.get(this.editingNodeId);
		const fontSize = node ? this.renderer.getNodeEditMetrics(node).fontSize : undefined;
		this.inlineEditor.reposition(rect, fontSize);
	}

	// --- Links (R5) ---

	/**
	 * Lazily resolves Electron's `shell` (`openExternal`/`openPath`) —
	 * `require("electron")` only works on desktop (Obsidian mobile has no
	 * Node/Electron underneath at all), so this is called from inside
	 * `openLink`/`openImage`, never at module load time, and guarded so a
	 * mobile session degrades to `window.open` for URLs and a `Notice` for
	 * filesystem paths instead of crashing plugin load. `electron` is
	 * already marked `external` in esbuild.config.mjs (never bundled) —
	 * this is the runtime counterpart of that, resolved by Obsidian's own
	 * process, same as every other Obsidian community plugin that opens
	 * local files/folders.
	 */
	private getElectronShell(): { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string> } | null {
		try {
			return (require("electron") as { shell: { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string> } }).shell;
		} catch {
			return null;
		}
	}

	/** Node's `os.homedir()`, resolved the same lazy/guarded way as `getElectronShell` (unavailable on mobile). */
	private getHomeDir(): string | null {
		try {
			return (require("os") as { homedir(): string }).homedir();
		} catch {
			return null;
		}
	}

	/**
	 * Opens a URL (with or without an explicit scheme — `normalizeUrlTarget`
	 * adds `https://` when needed) in the system's default browser via
	 * Electron's `shell.openExternal`, falling back to `window.open` where
	 * Electron isn't available (mobile).
	 */
	private openExternalUrl(target: string): void {
		const url = normalizeUrlTarget(target);
		const shell = this.getElectronShell();
		if (shell) {
			shell.openExternal(url).catch(() => new Notice(`Couldn't open ${url}`));
		} else {
			window.open(url, "_blank");
		}
	}

	/**
	 * Opens an absolute filesystem path via `shell.openPath` — Electron's
	 * own behavior already covers both halves of the request this
	 * implements: a *file* path opens in its OS-registered default app, and
	 * a *folder* path opens in the system file browser (Finder/Explorer/
	 * whatever the Linux desktop's default is) — no separate file-vs-folder
	 * branch needed, `shell.openPath` picks the right one for whatever the
	 * path actually is. `~`/`~/…` is expanded first since `shell.openPath`
	 * doesn't do that itself.
	 */
	private openFilesystemPath(target: string): void {
		const shell = this.getElectronShell();
		if (!shell) {
			new Notice("Opening local files/folders isn't supported on this platform.");
			return;
		}
		const homeDir = this.getHomeDir();
		const resolved = homeDir ? expandHomePath(target, homeDir) : target;
		shell.openPath(resolved).then((result) => {
			if (result) new Notice(`Couldn't open "${target}": ${result}`);
		});
	}

	/**
	 * Three target shapes, three destinations (matching the original note's
	 * "web url / file path / folder" spec for the Link type): a URL
	 * (`isUrlTarget` — scheme or bare domain) opens in the system browser; an
	 * absolute filesystem path (`isAbsoluteFilesystemPath` — `/…`, `~/…`,
	 * `C:\…`) opens via the OS (file → default app, folder → file browser,
	 * both via `shell.openPath`); anything else is a vault-relative
	 * note/attachment reference, resolved through Obsidian's own
	 * `openLinkText` exactly as before. Checked in that order, ahead of the
	 * `kind` the link happens to be stored as — a URL or absolute path
	 * stored as `kind: "wikilink"` (typed directly as `[[https://…]]`, or
	 * entered into the modal with "Wikilink" left selected) must still open
	 * correctly rather than trying to create/open a vault note named after
	 * it (the originally reported bug).
	 */
	private openLink(kind: LinkKind, target: string): void {
		if (isUrlTarget(target)) {
			this.openExternalUrl(target);
			return;
		}
		if (isAbsoluteFilesystemPath(target)) {
			this.openFilesystemPath(target);
			return;
		}
		// wikilink, or an mdlink whose target isn't a URL/absolute path: a
		// vault-relative reference (note, attachment, etc.), resolved the
		// same way regardless of `kind`.
		this.app.workspace.openLinkText(target, this.file?.path ?? "", false);
	}

	/** R-image-display, decision A: clicking a node's image thumbnail opens the image — in a new tab, unlike `openLink`, so the mind map stays open (same reasoning as "Go to note section" always opening in a new tab). Same target-shape routing as `openLink`. */
	private openImage(kind: LinkKind, target: string): void {
		if (isUrlTarget(target)) {
			this.openExternalUrl(target);
			return;
		}
		if (isAbsoluteFilesystemPath(target)) {
			this.openFilesystemPath(target);
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

	/** R4: true if `path` is open in some other leaf right now — a cheap `iterateAllLeaves` scan, only ever run at "Add relation" commit time (not a hot path), used to warn rather than silently race a foreign-file write against unsaved edits sitting in that pane. */
	private isFileOpenElsewhere(path: string): boolean {
		let found = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as unknown as { file?: TFile };
			if (view?.file?.path === path) found = true;
		});
		return found;
	}

	/**
	 * Ctrl/Cmd+Shift+L (R3/R5, extended by R1a item 6 and R4; moved off
	 * Ctrl/Cmd+K — see the keydown handler): lists every relation/link
	 * already on the node (`listNodeLinkItems`), each individually
	 * removable, plus a radio-gated add flow — *Document relation* (R4:
	 * pick any vault `.md` file, D6, then a node inside it — the current
	 * document is pre-selected and stays fully in-memory/instant, exactly
	 * as before R4) or *Link* (the original free-text wikilink/URL/path
	 * editor).
	 *
	 * Adding a same-document relation forces the target to have a
	 * persistent block id first (`forcePersistentId` — see its own doc
	 * comment in sync/metadata.ts for why minting has to happen here, at
	 * authoring time, rather than being left to the next
	 * `ensurePersistentIds` pass), then *appends* `[[#^id]]` to the source
	 * node's text (D7: visible append, `appendLinkText`) rather than
	 * replacing it — what lets one node carry multiple relations (R5).
	 *
	 * Adding a **foreign**-document relation (R4) does the equivalent for a
	 * file that isn't open in this view: `resolveRelationTargetsForDocument`
	 * (sync/foreignRelation.ts) lazily reads+parses a newly selected
	 * document once per modal session (cached in `foreignModelCache`,
	 * scoped to this method's closure — never touching the layout/render
	 * hot path or the current file's own debounced write pipeline); on Add,
	 * `commitForeignRelationTarget` re-reads that file **fresh** (not the
	 * picker-time cache — it may have changed), locates the same node by
	 * structural position (ids aren't stable across two separate parses of
	 * the same text, see that function's doc comment), and writes the file
	 * back only if a new persistent id actually had to be minted — relating
	 * to an already-referenced foreign node is a zero-write no-op.
	 *
	 * Every add/remove commits immediately via the same `commitRename` path
	 * every other edit here already uses (undo/redo, debounced write-back,
	 * all unchanged); the modal re-renders its own item list from each
	 * callback's return value rather than waiting for a final Save.
	 */
	private openLinkEditor(nodeId: string): void {
		if (!this.controller) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;

		const relationTargets: RelationTargetOption[] = [];
		const collectTargets = (n: MindNode) => {
			if (n !== node) relationTargets.push({ id: n.id, label: this.relationOptionLabel(n) });
			n.children.forEach(collectTargets);
		};
		collectTargets(this.controller.model.root);

		// R4: every vault .md file (D6 — not frontmatter-filtered), current
		// document first/pre-selected. Parsed foreign-file models are cached
		// here, scoped to this modal's lifetime (a fresh Map each time the
		// modal opens; nothing persists it beyond this closure).
		const documents: DocumentOption[] = [
			{ id: CURRENT_DOCUMENT_ID, label: `${this.file?.basename ?? "this document"} (current)` },
			...this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path !== this.file?.path)
				.map((f) => ({ id: f.path, label: f.basename })),
		];
		const foreignModelCache = new Map<string, MindMapModel>();

		const fileBasename = this.file?.basename ?? null;
		const currentItems = () => (this.controller ? listNodeLinkItems(node, this.controller.model, fileBasename) : []);

		new LinkModal(this.app, {
			items: currentItems(),
			documents,
			relationTargets,
			getRelationTargetsForDocument: (docId) =>
				resolveRelationTargetsForDocument(docId, relationTargets, {
					vault: this.app.vault,
					resolveFile: (path) => {
						const f = this.app.vault.getAbstractFileByPath(path);
						return f instanceof TFile ? f : null;
					},
					models: foreignModelCache,
					labelFor: (n) => this.relationOptionLabel(n),
				}),
			onAddRelation: async (target: RelationTarget, label: string) => {
				if (!this.controller) return currentItems();

				if (target.kind === "current") {
					const targetNode = this.controller.model.byId.get(target.nodeId);
					if (!targetNode) return currentItems();
					const id = forcePersistentId(targetNode, this.controller.model.byId);
					const linkText = buildLinkText({ label, kind: "wikilink", target: `#^${id}` });
					this.controller.commitRename(nodeId, appendLinkText(node.text, linkText));
					return currentItems();
				}

				// R4: foreign-file target — a one-off read-modify-write outside
				// the current file's live debounced pipeline.
				const cachedModel = foreignModelCache.get(target.filePath);
				const pickerNode = cachedModel?.byId.get(target.nodeId);
				const foreignFile = this.app.vault.getAbstractFileByPath(target.filePath);
				if (!pickerNode || !(foreignFile instanceof TFile)) return currentItems();

				if (this.isFileOpenElsewhere(target.filePath)) {
					new Notice(`"${foreignFile.basename}" is open in another pane — relate carefully, it may have unsaved changes not reflected here.`);
				}

				const result = await commitForeignRelationTarget(this.app.vault, foreignFile, pickerNode);
				if (!result) return currentItems(); // foreign file changed shape since the picker was populated; nothing safe to link to
				const linkText = buildLinkText({ label, kind: "wikilink", target: `${foreignFile.basename}#^${result.targetId}` });
				this.controller.commitRename(nodeId, appendLinkText(node.text, linkText));
				return currentItems();
			},
			onAddLink: (kind, target, label) => {
				if (!this.controller) return currentItems();
				// A URL or absolute filesystem path is always built as an mdlink,
				// regardless of which "Link type" the user left selected — a
				// wikilink pointed at either (e.g. Target left as "Wikilink" while
				// pasting a URL/path in) would otherwise round-trip as
				// `[[https://...]]`/`[[/Users/...]]`, which both looks wrong in the
				// raw markdown and used to make Cmd/Ctrl+click try to create a note
				// named after it (see `openLink`'s matching defensive check for
				// links that already exist in this shape).
				const finalKind: LinkKind = isUrlTarget(target) || isAbsoluteFilesystemPath(target) ? "mdlink" : kind;
				const linkText = buildLinkText({ label, kind: finalKind, target });
				this.controller.commitRename(nodeId, appendLinkText(node.text, linkText));
				return currentItems();
			},
			onRemoveItem: (occurrenceIndex) => {
				if (!this.controller) return currentItems();
				this.controller.commitRename(nodeId, removeLinkOccurrence(node.text, occurrenceIndex));
				return currentItems();
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
					.setTitle(menuItemTitle("Go to note section", { mac: "⌘⇧G", other: "Ctrl+Shift+G" }))
					.setIcon("arrow-right-to-line")
					.setDisabled(target.kind === "unavailable")
					.onClick(() => this.goToNoteSection(nodeId))
			)
			.addSeparator()
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Edit", { mac: "F2", other: "F2" }))
					.setIcon("pencil")
					.onClick(() => this.controller?.requestEdit(nodeId))
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Add child", { mac: "Tab", other: "Tab" }))
					.setIcon("plus")
					.onClick(() => this.controller?.addChildToSelected())
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Add sibling", { mac: "Enter", other: "Enter" }))
					.setIcon("list-plus")
					.onClick(() => this.controller?.addSiblingToSelected("after"))
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Edit link", { mac: "⌘⇧L", other: "Ctrl+Shift+L" }))
					.setIcon("link")
					.onClick(() => this.openLinkEditor(nodeId))
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle(node.folded ? "Unfold" : "Fold", { mac: "⌘/", other: "Ctrl+/" }))
					.setIcon(node.folded ? "chevron-right" : "chevron-down")
					.onClick(() => this.controller?.toggleFold(nodeId))
			)
			.addSeparator();
		this.addStatusBadgeMenuItems(menu, node);
		menu
			.addSeparator()
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Copy", { mac: "⌘C", other: "Ctrl+C" }))
					.setIcon("copy")
					.onClick(() => {
						this.controller?.copySelected();
						this.writeClipboardText();
					})
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Cut", { mac: "⌘X", other: "Ctrl+X" }))
					.setIcon("scissors")
					.onClick(() => {
						this.controller?.cutSelected();
						this.writeClipboardText();
					})
			)
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Paste", { mac: "⌘V", other: "Ctrl+V" }))
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
			.addItem((item) =>
				item
					.setTitle(menuItemTitle("Delete", { mac: "⌫", other: "Delete" }))
					.setIcon("trash")
					.onClick(() => this.controller?.deleteSelected())
			);

		menu.showAtMouseEvent(evt);
	}

	/** Shared by `showNodeMenu`, the Cmd+Shift+I quick-pick menu, and a status-badge click — the 6 canonical statuses (model/statusBadges.ts) plus "Clear status" when one is set, each checked to show the node's current status. A badge with its own direct-toggle shortcut (currently just "done", Cmd+Shift+D) shows that hint next to its label, same as `showNodeMenu`'s other items. */
	private addStatusBadgeMenuItems(menu: Menu, node: MindNode): void {
		for (const { key, label, hotkey } of BADGE_DEFS) {
			menu.addItem((item) =>
				item
					.setTitle(menuItemTitle(label, hotkey))
					.setChecked(node.statusBadge === key)
					.onClick(() => this.controller?.setStatusBadge(node.id, key))
			);
		}
		if (node.statusBadge !== undefined) {
			menu.addItem((item) => item.setTitle("Clear status").onClick(() => this.controller?.setStatusBadge(node.id, undefined)));
		}
	}

	/** Cmd+Shift+I and a status-badge click: opens the same status quick-pick as the context menu's section, positioned at the node's current screen location. */
	private showStatusBadgeMenuForNode(nodeId: string): void {
		if (!this.controller || !this.renderer) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const rect = this.renderer.getNodeScreenRect(nodeId);
		if (!rect) return;

		const menu = new Menu();
		this.addStatusBadgeMenuItems(menu, node);
		menu.showAtPosition({ x: rect.left, y: rect.top + rect.height });
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

		// Editing a node's label: a text clipboard is left entirely to the
		// field's own native paste (already happened, or is a no-op source
		// like an unsupported clipboard type) — inserting it as a node here
		// too would duplicate it as both label text and a new child. This
		// also covers the context-menu "Paste" item, which has no editing
		// guard of its own and calls straight in here.
		if (this.editingNodeId) return;

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
		if (!this.controller) return;
		const mod = evt.ctrlKey || evt.metaKey;

		if (this.inlineEditor) {
			// InlineEditor owns every other key while editing. Paste is the
			// one exception: an image on the clipboard can't be typed into
			// the field, so it still needs to reach handlePaste to become a
			// child node (see InlineEditor's own keydown handler, which lets
			// this one combination bubble). Left un-prevented so the native
			// paste still fills the field when the clipboard instead holds
			// plain text — handlePaste no-ops in that case.
			if (mod && evt.key.toLowerCase() === "v") this.handlePaste();
			return;
		}

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
		} else if (mod && evt.shiftKey && evt.key.toLowerCase() === "g") {
			// Keyboard equivalent of the context menu's "Go to note section"
			// item. Not known to collide with anything in this plugin or an
			// Obsidian core default at the time this was added — same caveat
			// as every other Mod+Shift binding here (only Obsidian's own live
			// hotkey registry can't be checked from code); rebind the same way
			// Mod+K -> Mod+Shift+L was resolved if it turns out to clash.
			evt.preventDefault();
			if (this.controller.selectedId) this.goToNoteSection(this.controller.selectedId);
		} else if (mod && evt.shiftKey && evt.key.toLowerCase() === "i") {
			// Opens the status quick-pick menu (plans/09) for the selected node —
			// same caveat as every other Mod+Shift binding here: not known to
			// collide with anything in this plugin or an Obsidian core default
			// at the time this was added; rebind the same way Mod+K -> Mod+
			// Shift+L was resolved if it turns out to clash in a live vault.
			evt.preventDefault();
			if (this.controller.selectedId) this.showStatusBadgeMenuForNode(this.controller.selectedId);
		} else if (mod && evt.shiftKey && evt.key.toLowerCase() === "d") {
			// Direct-toggle for the "Done" status badge (plans/09), skipping the
			// quick-pick menu — confirmed free (no existing Mod+Shift+D binding
			// in this plugin or main.ts); same live-vault-collision caveat as
			// every other Mod+Shift binding here.
			evt.preventDefault();
			if (this.controller.selectedId) this.controller.toggleStatusBadge(this.controller.selectedId, "done");
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
