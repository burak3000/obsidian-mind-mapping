import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
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
			id: "rebalance-mindmap",
			name: "Rebalance mind map",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindMapView);
				if (!view) return false;
				if (!checking) view.rebalance();
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
}
