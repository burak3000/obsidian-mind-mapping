import { App, Modal, Setting } from "obsidian";
import { LinkKind } from "../model/links";

/** Caps how many matches the relation combobox renders at once, so a 1,000+ node map doesn't dump its whole node list into the DOM on every keystroke. */
const RELATION_COMBOBOX_MAX_RESULTS = 50;

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
		this.modalEl.addClass("mm-link-modal");
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
			const setting = new Setting(contentEl)
				.setName("Or: relation to a node in this map")
				.setDesc("Search for a node by its text instead of the Target field above — draws a same-document relation arrow rather than a regular link.");
			setting.settingEl.addClass("mm-relation-setting");
			this.renderRelationCombobox(setting.controlEl);
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

	/**
	 * Hand-rolled searchable combobox (input + filtered dropdown list) for
	 * `relationTargets`. Not Obsidian's `AbstractInputSuggest`: that popover
	 * is meant for workspace-level inputs and doesn't reliably show up when
	 * attached to an input inside a `Modal`, so this renders its own list in
	 * the modal's own DOM instead.
	 */
	private renderRelationCombobox(container: HTMLElement): void {
		const initial = this.opts.relationTargets.find((o) => o.id === this.relationTargetNodeId);

		const wrapper = container.createDiv({ cls: "mm-relation-combobox" });
		const input = wrapper.createEl("input", {
			type: "text",
			cls: "mm-relation-combobox-input",
			attr: { placeholder: "Search nodes by text…" },
		});
		if (initial) input.value = initial.label;
		const list = wrapper.createDiv({ cls: "mm-relation-combobox-list" });
		list.style.display = "none";

		let activeIndex = -1;
		let shown: RelationTargetOption[] = [];

		const setActive = (index: number) => {
			const items = list.querySelectorAll<HTMLElement>(".mm-relation-combobox-item");
			items.forEach((el, i) => el.toggleClass("is-active", i === index));
			activeIndex = index;
		};

		const closeList = () => {
			list.style.display = "none";
			activeIndex = -1;
		};

		const openList = (query: string) => {
			const q = query.trim().toLowerCase();
			shown = (q ? this.opts.relationTargets.filter((o) => o.label.toLowerCase().includes(q)) : this.opts.relationTargets).slice(
				0,
				RELATION_COMBOBOX_MAX_RESULTS
			);
			list.empty();
			if (shown.length === 0) {
				list.createDiv({ cls: "mm-relation-combobox-empty", text: "No matching nodes" });
				list.style.display = "block";
				activeIndex = -1;
				return;
			}
			for (const opt of shown) {
				const item = list.createDiv({ cls: "mm-relation-combobox-item", text: opt.label });
				item.addEventListener("mousedown", (evt) => {
					evt.preventDefault();
					input.value = opt.label;
					this.relationTargetNodeId = opt.id;
					closeList();
				});
			}
			list.style.display = "block";
			setActive(0);
		};

		input.addEventListener("focus", () => openList(input.value));
		input.addEventListener("input", () => {
			this.relationTargetNodeId = null;
			openList(input.value);
		});
		input.addEventListener("blur", () => closeList());
		input.addEventListener("keydown", (evt) => {
			if (list.style.display === "none" && (evt.key === "ArrowDown" || evt.key === "ArrowUp")) {
				openList(input.value);
				return;
			}
			if (evt.key === "ArrowDown") {
				evt.preventDefault();
				if (shown.length > 0) setActive((activeIndex + 1) % shown.length);
			} else if (evt.key === "ArrowUp") {
				evt.preventDefault();
				if (shown.length > 0) setActive((activeIndex - 1 + shown.length) % shown.length);
			} else if (evt.key === "Enter") {
				if (activeIndex >= 0 && shown[activeIndex]) {
					evt.preventDefault();
					const opt = shown[activeIndex];
					input.value = opt.label;
					this.relationTargetNodeId = opt.id;
					closeList();
				}
			} else if (evt.key === "Escape") {
				closeList();
			}
		});
	}
}
