import { App, Modal, Setting } from "obsidian";
import { LinkKind } from "../model/links";

export interface LinkModalResult {
	label: string;
	kind: LinkKind;
	target: string;
}

export interface LinkModalOptions {
	initialLabel: string;
	initialKind: LinkKind;
	initialTarget: string;
	hasExistingLink: boolean;
	onSave: (result: LinkModalResult) => void;
	onRemove: () => void;
}

/** Ctrl/Cmd+K (R5): add/edit/remove a link on the selected node. */
export class LinkModal extends Modal {
	private label: string;
	private kind: LinkKind;
	private target: string;

	constructor(app: App, private readonly opts: LinkModalOptions) {
		super(app);
		this.label = opts.initialLabel;
		this.kind = opts.initialKind;
		this.target = opts.initialTarget;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Edit link" });

		new Setting(contentEl).setName("Display text").addText((text) =>
			text.setValue(this.label).onChange((v) => {
				this.label = v;
			})
		);

		new Setting(contentEl).setName("Link type").addDropdown((dropdown) =>
			dropdown
				.addOption("wikilink", "Wikilink (note in this vault)")
				.addOption("mdlink", "URL or file path")
				.setValue(this.kind)
				.onChange((v) => {
					this.kind = v as LinkKind;
				})
		);

		new Setting(contentEl).setName("Target").setDesc("Note title for a wikilink, or a URL/vault path for a URL link.").addText((text) =>
			text.setValue(this.target).onChange((v) => {
				this.target = v;
			})
		);

		const buttons = new Setting(contentEl);
		if (this.opts.hasExistingLink) {
			buttons.addButton((btn) =>
				btn.setButtonText("Remove link").onClick(() => {
					this.opts.onRemove();
					this.close();
				})
			);
		}
		buttons.addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					if (!this.target.trim()) return;
					this.opts.onSave({ label: this.label.trim() || this.target.trim(), kind: this.kind, target: this.target.trim() });
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
