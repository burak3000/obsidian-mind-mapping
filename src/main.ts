import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { MindMapView, VIEW_TYPE_MINDMAP } from "./view/MindMapView";
import { DEFAULT_SETTINGS, MindMapSettings } from "./settings/PluginSettings";
import { MindMapSettingsTab } from "./settings/SettingsTab";

export default class MindMapPlugin extends Plugin {
	settings: MindMapSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MindMapSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindMapView(leaf, this));

		this.addCommand({
			id: "open-as-mindmap",
			name: "Open as mind map",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.openAsMindMap(file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) => {
					item
						.setTitle("Open as mind map")
						.setIcon("git-fork")
						.onClick(() => this.openAsMindMap(file));
				});
			})
		);

		this.addCommand({
			id: "toggle-mindmap-view",
			name: "Toggle mind-map view",
			hotkeys: [{ modifiers: ["Mod"], key: "m" }],
			checkCallback: (checking) => {
				const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (mdView?.file && mdView.file.extension === "md") {
					if (!checking) this.switchLeafToMindMap(mdView.leaf, mdView.file);
					return true;
				}
				const mmView = this.app.workspace.getActiveViewOfType(MindMapView);
				if (mmView?.file) {
					if (!checking) this.switchLeafToMarkdown(mmView);
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "rebalance-mindmap",
			name: "Rebalance mind map",
			// Registered through Obsidian's own command hotkey system, not a raw
			// keydown listener in the view (that never actually fired — see git
			// history). Ctrl/Cmd+Shift+B rather than plain Ctrl/Cmd+B: the plain
			// combo is Obsidian's own default "Toggle bold" hotkey, and even
			// though our checkCallback would only claim it while a MindMapView is
			// active, addCommand still registers it as a conflicting binding in
			// Settings → Hotkeys — Shift avoids stepping on Obsidian's default
			// entirely instead of relying on context-based disambiguation.
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "b" }],
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindMapView);
				if (!view) return false;
				if (!checking) view.rebalance();
				return true;
			},
		});

		this.addCommand({
			id: "search-mindmap",
			name: "Search mind map",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindMapView);
				if (!view) return false;
				if (!checking) view.toggleSearch();
				return true;
			},
		});
	}

	onunload(): void {
		// Views are torn down by Obsidian; nothing to release ourselves.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async openAsMindMap(file: TFile): Promise<void> {
		const leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_MINDMAP,
			state: { file: file.path },
		});
		this.app.workspace.revealLeaf(leaf);
	}

	/** Ctrl/Cmd+M toggle, markdown -> mind map: switches the *same* leaf (not a new tab), so repeated toggling doesn't pile up duplicate views and back/forward navigation still works. */
	private async switchLeafToMindMap(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
		await leaf.setViewState({
			type: VIEW_TYPE_MINDMAP,
			state: { file: file.path },
		});
	}

	/** Ctrl/Cmd+M toggle, mind map -> markdown: flushes the debounced write first so the markdown editor doesn't open stale (pre-last-edit) content. */
	private async switchLeafToMarkdown(view: MindMapView): Promise<void> {
		const file = view.file;
		if (!file) return;
		await view.flushPendingWrite();
		await view.leaf.setViewState({
			type: "markdown",
			state: { file: file.path },
		});
	}
}
