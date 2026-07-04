import { Notice, TAbstractFile, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import { parseMindMap } from "../sync/parser";
import { serializeMindMap } from "../sync/serializer";
import { computeLayout, DEFAULT_LAYOUT_CONFIG } from "../layout/layoutEngine";
import { SvgRenderer } from "../render/SvgRenderer";
import { Controller, ControllerListener } from "../controller/Controller";
import { InlineEditor } from "./InlineEditor";
import { debounce } from "../sync/debounce";
import { findEquivalentNode } from "../sync/reconcile";
import { findNearestInDirection, Direction } from "../render/navigation";
import { collectVisibleNodes } from "../model/visibility";
import { assignMissingColors } from "../render/colors";
import { assignMissingSides } from "../layout/sides";
import { ensurePersistentIds } from "../sync/metadata";
import { LinkKind, buildLinkText, getSoleLink } from "../model/links";
import { LinkModal } from "./LinkModal";
import { SearchPanel } from "./SearchPanel";
import { searchNodes } from "../model/search";
import { MindMapSettings } from "../settings/PluginSettings";
import { LayoutConfig } from "../layout/layoutEngine";
import { SerializeConfig } from "../sync/serializer";

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
		this.registerDomEvent(this.contentEl, "mousedown", () => this.contentEl.focus());
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

		this.inlineEditor?.destroy();
		this.inlineEditor = null;
		this.searchPanel?.destroy();
		this.searchPanel = null;
		this.controller = new Controller(model);
		this.controller.addListener(this);

		this.renderer?.destroy();
		this.renderer = new SvgRenderer(container, this.settingsProvider.settings.animationNodeThreshold, this.layoutConfig);
		this.renderer.setNodeClickHandler((id) => this.controller?.select(id));
		this.renderer.setNodeDblClickHandler((id) => this.controller?.requestEdit(id));
		this.renderer.setBadgeClickHandler((id) => this.controller?.toggleFold(id));
		this.renderer.setLinkClickHandler((kind, target) => this.openLink(kind, target));
		this.renderer.setManualMoveHandler((id, pos) => this.controller?.setManualPosition(id, pos));
		this.renderer.setReorderHandler((id, targetId) => this.controller?.moveNode(id, targetId));
		this.renderer.setManualWidthHandler((id, width) => this.controller?.setManualWidth(id, width));
		this.renderer.mount(model);
	}

	// --- ControllerListener ---

	onChange(): void {
		if (!this.controller || !this.renderer) return;
		assignMissingColors(this.controller.model.root);
		assignMissingSides(this.controller.model.root);
		computeLayout(this.controller.model.root, this.layoutConfig);
		this.renderer.update(this.controller.model);
		this.renderer.selectNode(this.controller.selectedId);
		ensurePersistentIds(this.controller.model.root, this.controller.model.byId);
		this.data = serializeMindMap(this.controller.model, this.serializeConfig);
		this.scheduleWrite();
	}

	onEditRequest(nodeId: string): void {
		this.openInlineEditor(nodeId);
	}

	// --- Inline editing ---

	private openInlineEditor(nodeId: string): void {
		if (!this.controller || !this.renderer) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const rect = this.renderer.getNodeScreenRect(nodeId);
		if (!rect) return;

		this.inlineEditor?.destroy();
		this.inlineEditor = new InlineEditor(this.contentEl, {
			initialText: node.text,
			rect,
			onCommit: (text) => {
				this.inlineEditor = null;
				this.controller?.commitRename(nodeId, text);
				this.controller?.select(nodeId);
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

	private openLinkEditor(nodeId: string): void {
		if (!this.controller) return;
		const node = this.controller.model.byId.get(nodeId);
		if (!node) return;
		const existing = getSoleLink(node.text);

		new LinkModal(this.app, {
			initialLabel: existing?.label ?? node.text,
			initialKind: existing?.kind ?? "wikilink",
			initialTarget: existing?.target ?? "",
			hasExistingLink: existing !== null,
			onSave: (result) => this.controller?.commitRename(nodeId, buildLinkText(result)),
			onRemove: () => {
				if (existing) this.controller?.commitRename(nodeId, existing.label);
			},
		}).open();
	}

	/** "Rebalance" command (plan §9.3) — exposed for main.ts's Obsidian command to call on the active view. */
	rebalance(): void {
		this.controller?.rebalance();
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
		} else if (evt.key === "ArrowUp" || evt.key === "ArrowDown" || evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
			evt.preventDefault();
			this.navigate(evt.key);
		} else if (mod && evt.key === "Home") {
			evt.preventDefault();
			this.renderer?.centerOnRoot();
		} else if (mod && evt.key === "/") {
			evt.preventDefault();
			if (this.controller.selectedId) this.controller.toggleFold(this.controller.selectedId);
		} else if (mod && evt.key.toLowerCase() === "k") {
			evt.preventDefault();
			if (this.controller.selectedId) this.openLinkEditor(this.controller.selectedId);
		}
	}

	private navigate(key: string): void {
		if (!this.controller) return;
		const selectedId = this.controller.selectedId ?? this.controller.model.root.id;
		const node = this.controller.model.byId.get(selectedId);
		if (!node) return;
		const direction: Direction = key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : "right";
		const visible = collectVisibleNodes(this.controller.model.root);
		const next = findNearestInDirection(visible, node, direction);
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
		this.renderer?.mount(newModel);
		this.renderer?.selectNode(newSelectedId);
	}
}
