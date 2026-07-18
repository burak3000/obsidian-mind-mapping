import { App, PluginSettingTab, Setting } from "obsidian";
import type MindMapPlugin from "../main";

export class MindMapSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MindMapPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Layout mode")
			.setDesc("How first-level branches are arranged around the root (plan §9.3). Changing this only affects maps opened after saving.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("balanced", "Balanced (left and right)")
					.addOption("right-only", "Right only")
					.addOption("left-only", "Left only")
					.setValue(this.plugin.settings.layoutMode)
					.onChange(async (value) => {
						this.plugin.settings.layoutMode = value as typeof this.plugin.settings.layoutMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Heading depth")
			.setDesc("Nodes at or above this depth are written as markdown headings; deeper nodes become list items. Root is depth 0 (always H1); default 1 means first-level branches are H2.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 5, 1)
					.setValue(this.plugin.settings.headingDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.headingDepth = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Write-back delay")
			.setDesc("How long to wait after your last edit before saving to the file, in milliseconds (plan §7.3 default: 400). Takes effect for maps opened after saving.")
			.addSlider((slider) =>
				slider
					.setLimits(100, 2000, 50)
					.setValue(this.plugin.settings.writeDebounceMs)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.writeDebounceMs = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show relations")
			.setDesc(
				"Draw arrows for same-document relations (R1a: a node whose text links to another node in this map via a block reference). Off skips relation rendering entirely, not just hides it. Takes effect for maps opened after saving."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRelations).onChange(async (value) => {
					this.plugin.settings.showRelations = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Animation cutoff")
			.setDesc("Above this many visible nodes, fold/unfold position animations turn off and changes apply instantly (addendum §8 item 2, chosen default: 500). Takes effect for maps opened after saving.")
			.addSlider((slider) =>
				slider
					.setLimits(50, 3000, 50)
					.setValue(this.plugin.settings.animationNodeThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.animationNodeThreshold = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
