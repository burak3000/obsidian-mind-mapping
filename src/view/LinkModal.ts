import { App, Modal, Setting } from "obsidian";
import { LinkKind } from "../model/links";

/** R1a authoring (D2a): a node in this map the relation dropdown can target. */
export interface RelationTargetOption {
	id: string;
	label: string;
}

export interface LinkModalResult {
	label: string;
	kind: LinkKind;
	target: string;
	/**
	 * Set when the user picked a node in this map from the relation dropdown
	 * instead of typing a free-text target (R1a authoring, D2a) — the caller
	 * (`MindMapView.openLinkEditor`) resolves this to a forced-persistent
	 * block id and builds the actual `[[#^id]]` link text; `kind`/`target`
	 * on this result are just the free-text fields' (unused) values in that
	 * case.
	 */
	relationTargetNodeId?: string;
}

export interface LinkModalOptions {
	initialLabel: string;
	initialKind: LinkKind;
	initialTarget: string;
	hasExistingLink: boolean;
	/** Nodes in this map selectable as a same-document relation target (R1a), document-ordered, excluding the node being edited. Empty on a single-node map (nothing to relate to) — the dropdown is omitted entirely in that case. */
	relationTargets: RelationTargetOption[];
	/** Pre-selects the relation dropdown when reopening the editor on a node whose existing link is already a resolved same-doc relation. */
	initialRelationTargetNodeId?: string;
	onSave: (result: LinkModalResult) => void;
	onRemove: () => void;
	/** Fired on every close path (save, remove, or dismiss/Escape) so the caller can restore focus to the mind map. */
	onClose?: () => void;
}

/**
 * Ctrl/Cmd+Shift+L (R5, extended by R1a): add/edit/remove a link on the selected
 * node — either a free-text target (wikilink to a note / URL / vault path)
 * or, via the relation dropdown, a same-document relation arrow to another
 * node in this map (D2a: this modal is the *only* relation-authoring
 * surface — no drag-to-connect gesture, see DECISIONS.md).
 */
export class LinkModal extends Modal {
	private label: string;
	private kind: LinkKind;
	private target: string;
	private relationTargetNodeId: string | null;

	constructor(app: App, private readonly opts: LinkModalOptions) {
		super(app);
		this.label = opts.initialLabel;
		this.kind = opts.initialKind;
		this.target = opts.initialTarget;
		this.relationTargetNodeId = opts.initialRelationTargetNodeId ?? null;
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

		if (this.opts.relationTargets.length > 0) {
			new Setting(contentEl)
				.setName("Or: relation to a node in this map")
				.setDesc("Pick a node instead of the Target field above — draws a same-document relation arrow rather than a regular link.")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "— none —");
					for (const opt of this.opts.relationTargets) dropdown.addOption(opt.id, opt.label);
					dropdown.setValue(this.relationTargetNodeId ?? "");
					dropdown.onChange((v) => {
						this.relationTargetNodeId = v || null;
					});
				});
		}

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
					if (this.relationTargetNodeId) {
						const picked = this.opts.relationTargets.find((o) => o.id === this.relationTargetNodeId);
						this.opts.onSave({
							label: this.label.trim() || picked?.label || "relation",
							kind: "wikilink",
							target: "",
							relationTargetNodeId: this.relationTargetNodeId,
						});
						this.close();
						return;
					}
					if (!this.target.trim()) return;
					this.opts.onSave({ label: this.label.trim() || this.target.trim(), kind: this.kind, target: this.target.trim() });
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.opts.onClose?.();
	}
}
