import { App, Modal, Setting } from "obsidian";
import { LinkKind } from "../model/links";
import { LinkItem, LinkItemBadge } from "../model/relations";
import { CURRENT_DOCUMENT_ID } from "../sync/foreignRelation";

/** Caps how many matches a combobox (document or node) renders at once, so a large vault / 1,000+ node map doesn't dump its whole list into the DOM on every keystroke. */
const RELATION_COMBOBOX_MAX_RESULTS = 50;

/** R1a authoring (D2a): a node in some document the relation dropdown can target. Which document it belongs to is tracked separately by the modal's own `selectedDocId` state, not on this option itself. */
export interface RelationTargetOption {
	id: string;
	label: string;
}

/** R4: every vault `.md` file selectable in the "pick a document" combobox (D6: all vault files, not frontmatter-filtered) — `CURRENT_DOCUMENT_ID` is always first/pre-selected. */
export interface DocumentOption {
	id: string;
	label: string;
}

/**
 * The relation-target picker's selection (R3, widened by R4). A
 * discriminated union on `kind` rather than a stringly-typed `fileId` so
 * `onAddRelation`'s two branches (same-doc, in-memory vs. foreign-file,
 * read/write) are exhaustively checked at compile time instead of relying
 * on a magic-string comparison at every call site.
 */
export type RelationTarget = { kind: "current"; nodeId: string } | { kind: "foreign"; filePath: string; nodeId: string };

const BADGE_LABEL: Record<LinkItemBadge, string> = {
	"same-doc": "Relation",
	"cross-doc": "Cross-doc",
	external: "External link",
	unresolved: "Unresolved link",
};

export interface LinkModalOptions {
	/** Every relation/link already on the node (R3), document/text order. Passed fresh at open time; refreshed thereafter by this modal itself using each on* callback's return value. */
	items: LinkItem[];
	/** R4: every vault `.md` file selectable in the "pick a document" combobox — `CURRENT_DOCUMENT_ID` first/pre-selected, since relating within the current document is the common case. */
	documents: DocumentOption[];
	/** Nodes in the current document selectable as a same-doc relation target (R1a/R3), document-ordered, excluding the node being edited. Empty on a single-node map (nothing to relate to). Used to render the node combobox synchronously the instant the modal opens (current document is the default selection) — the same in-memory `relationTargets`/`collectTargets` path as before R4, no vault I/O. */
	relationTargets: RelationTargetOption[];
	/** R4: resolves the node combobox's options for whichever document is selected in the document combobox. Called for every selection, including re-selecting the current document — `CURRENT_DOCUMENT_ID` is guaranteed (see `resolveRelationTargetsForDocument` in sync/foreignRelation.ts) to resolve from `relationTargets` with no vault call at all; any other id triggers a one-time (cached by the caller for this modal's lifetime) read + parse of that file. */
	getRelationTargetsForDocument: (docId: string) => Promise<RelationTargetOption[]>;
	/** Commits an added relation (via `commitRename` for the current document, or a one-off foreign-file read-modify-write for R4 — either way, immediate, no separate "Save") and returns the node's refreshed item list for this modal to re-render. May be async (the foreign-file path does vault I/O); the current-document path resolves with no I/O. */
	onAddRelation: (target: RelationTarget, label: string) => LinkItem[] | Promise<LinkItem[]>;
	/** Commits an added free-text link (the "Link" radio path — free-text wikilink/URL/path, unchanged fields from the old single-edit modal) immediately and returns the refreshed item list. */
	onAddLink: (kind: LinkKind, target: string, label: string) => LinkItem[];
	/** Removes exactly one item, identified by its `occurrenceIndex`, immediately and returns the refreshed item list. */
	onRemoveItem: (occurrenceIndex: number) => LinkItem[];
	/** Fired on every close path (dismiss/Escape/Close button) so the caller can restore focus to the mind map. */
	onClose?: () => void;
}

type AddMode = "relation" | "link";

/**
 * Ctrl/Cmd+Shift+L (R3/R5, redesigned from the earlier single-edit "Edit
 * link" modal): lists every relation/link already on the node — each
 * individually removable — plus a radio-gated add flow: *Document
 * relation* (default, a same-document relation arrow to another node in
 * this map, D2a: this modal is the only relation-authoring surface) or
 * *Link* (the original free-text wikilink/URL/path editor, unchanged).
 * Adding appends to the node's text rather than replacing it (D7: visible
 * append, `"existing → target label"`), which is what lets one node carry
 * multiple relations (R5) — every add/remove commits immediately, so
 * there's no longer a final "Save"; a single "Close" button replaces it.
 */
export class LinkModal extends Modal {
	private items: LinkItem[];
	private mode: AddMode = "relation";

	// "Document relation" sub-form state.
	private relationTargetNodeId: string | null = null;
	private relationLabel = "";
	/** R4: which document combobox-1 currently has selected — `CURRENT_DOCUMENT_ID` or a vault path. */
	private selectedDocId: string = CURRENT_DOCUMENT_ID;
	/** R4: combobox-2's current option list — the current document's `relationTargets` until the user picks a different document, then whatever `getRelationTargetsForDocument` resolves (cached per-path by the caller, not re-fetched here). */
	private currentNodeTargets: RelationTargetOption[];

	// "Link" sub-form state. Defaults to "URL or file path" (not "Wikilink")
	// since the "Link" radio is specifically for external resources — a
	// wikilink to a vault note is better served by "Document relation".
	private linkLabel = "";
	private linkKind: LinkKind = "mdlink";
	private linkTarget = "";

	private itemsContainer!: HTMLElement;
	private relationForm!: HTMLElement;
	private linkForm!: HTMLElement;
	/** R4: the node combobox's own container, re-rendered in place when the selected document changes (without rebuilding the display-text field / document combobox around it). */
	private nodeComboContainer!: HTMLElement;

	constructor(app: App, private readonly opts: LinkModalOptions) {
		super(app);
		this.items = opts.items;
		this.currentNodeTargets = opts.relationTargets;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("mm-link-modal");
		contentEl.createEl("h3", { text: "Links & relations" });

		this.itemsContainer = contentEl.createDiv({ cls: "mm-link-items" });
		this.renderItems();

		contentEl.createEl("h4", { text: "Add" });
		this.renderModeRadio(contentEl);

		this.relationForm = contentEl.createDiv({ cls: "mm-link-add-form" });
		this.renderRelationForm(this.relationForm);

		this.linkForm = contentEl.createDiv({ cls: "mm-link-add-form" });
		this.renderLinkForm(this.linkForm);

		this.updateFormVisibility();

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Close")
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.opts.onClose?.();
	}

	// --- Item list ---

	private renderItems(): void {
		this.itemsContainer.empty();
		if (this.items.length === 0) {
			this.itemsContainer.createDiv({ cls: "mm-link-items-empty", text: "No links yet." });
			return;
		}
		for (const item of this.items) {
			const row = new Setting(this.itemsContainer).setName(item.label || item.rawTarget);
			row.settingEl.addClass("mm-link-item");
			row.nameEl.createSpan({ cls: `mm-link-item-badge mm-link-item-badge-${item.badge}`, text: BADGE_LABEL[item.badge] });
			row.addButton((btn) =>
				btn
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => {
						this.items = this.opts.onRemoveItem(item.occurrenceIndex);
						this.renderItems();
					})
			);
		}
	}

	// --- Add: mode radio ---

	private renderModeRadio(container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: "mm-link-mode-radio" });
		const groupName = "mm-link-add-mode";

		const makeOption = (value: AddMode, text: string) => {
			const label = wrapper.createEl("label", { cls: "mm-link-mode-option" });
			const input = label.createEl("input", { type: "radio", attr: { name: groupName, value } });
			input.checked = value === this.mode;
			input.addEventListener("change", () => {
				if (!input.checked) return;
				this.mode = value;
				this.updateFormVisibility();
			});
			label.createSpan({ text });
		};

		makeOption("relation", "Document relation");
		makeOption("link", "Link");
	}

	private updateFormVisibility(): void {
		this.relationForm.style.display = this.mode === "relation" ? "" : "none";
		this.linkForm.style.display = this.mode === "link" ? "" : "none";
	}

	// --- Add: "Document relation" sub-form (R4: document combobox + node combobox) ---

	private renderRelationForm(container: HTMLElement): void {
		new Setting(container).setName("Display text").addText((text) =>
			text.setValue(this.relationLabel).onChange((v) => {
				this.relationLabel = v;
			})
		);

		const docSetting = new Setting(container)
			.setName("Document")
			.setDesc("Pick the file the target node lives in — defaults to this document (D6: every vault .md file is searchable).");
		docSetting.settingEl.addClass("mm-relation-setting");
		this.renderDocumentCombobox(docSetting.controlEl);

		const nodeSetting = new Setting(container)
			.setName("Node")
			.setDesc("Search for a node by its text — draws a same-document relation arrow, or a cross-document one if the document above isn't this one.");
		nodeSetting.settingEl.addClass("mm-relation-setting");
		this.nodeComboContainer = nodeSetting.controlEl.createDiv();
		this.renderNodeCombobox(this.nodeComboContainer);

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("Add relation")
				.setCta()
				.onClick(async () => {
					if (!this.relationTargetNodeId) return;
					const picked = this.currentNodeTargets.find((o) => o.id === this.relationTargetNodeId);
					const label = this.relationLabel.trim() || picked?.label || "relation";
					const target: RelationTarget =
						this.selectedDocId === CURRENT_DOCUMENT_ID
							? { kind: "current", nodeId: this.relationTargetNodeId }
							: { kind: "foreign", filePath: this.selectedDocId, nodeId: this.relationTargetNodeId };
					// Foreign targets do vault I/O (onAddRelation may be async); disable to avoid a
					// double-submit while that's in flight. The current-document path resolves with
					// no I/O, so this is a no-observable-delay guard there.
					btn.setDisabled(true);
					try {
						this.items = await this.opts.onAddRelation(target, label);
					} finally {
						btn.setDisabled(false);
					}
					this.renderItems();
					// Reset for the next add — R5 multiplicity is the point of this modal. Keep the
					// selected document (relating several nodes in the same file is common), just
					// clear the node pick + label.
					this.relationLabel = "";
					this.relationTargetNodeId = null;
					this.relationForm.empty();
					this.renderRelationForm(this.relationForm);
				})
		);
	}

	/** R4: re-renders just the node combobox in place (not the whole relation form) when the selected document changes. */
	private renderNodeCombobox(container: HTMLElement): void {
		container.empty();
		this.renderSearchCombobox(
			container,
			() => this.currentNodeTargets,
			"Search nodes by text…",
			"No matching nodes",
			(opt) => {
				this.relationTargetNodeId = opt.id;
			},
			() => {
				this.relationTargetNodeId = null;
			},
			""
		);
	}

	/**
	 * R4: combobox 1, "pick a document" — every vault `.md` file
	 * (`opts.documents`, D6) plus `CURRENT_DOCUMENT_ID`, pre-selected since
	 * relating within the current document is the common case. Selecting a
	 * different document kicks off `onDocumentSelected`, which lazily
	 * fetches (and the caller caches) that file's node list for combobox 2.
	 */
	private renderDocumentCombobox(container: HTMLElement): void {
		const currentLabel = this.opts.documents.find((d) => d.id === this.selectedDocId)?.label ?? "";
		this.renderSearchCombobox(
			container,
			() => this.opts.documents,
			"Search documents…",
			"No matching documents",
			(opt) => {
				void this.onDocumentSelected(opt.id);
			},
			() => {
				// Typing alone doesn't clear the selection — only picking a new option does
				// (matches the node combobox's "Enter/click commits" behavior).
			},
			currentLabel
		);
	}

	/**
	 * R4: fetches (or reuses the caller's per-modal-session cache for) the
	 * node list for a newly selected document, then re-renders the node
	 * combobox alone. Guards against a stale response landing after the
	 * user has already switched to yet another document while the first
	 * fetch was in flight.
	 */
	private async onDocumentSelected(docId: string): Promise<void> {
		if (docId === this.selectedDocId) return;
		this.selectedDocId = docId;
		this.relationTargetNodeId = null;
		// Clear immediately so a dropdown opened mid-fetch shows "no matches"
		// rather than the previous document's stale node list.
		this.currentNodeTargets = docId === CURRENT_DOCUMENT_ID ? this.opts.relationTargets : [];
		this.renderNodeCombobox(this.nodeComboContainer);

		const targets = await this.opts.getRelationTargetsForDocument(docId);
		if (this.selectedDocId !== docId) return; // user already picked another document
		this.currentNodeTargets = targets;
		this.renderNodeCombobox(this.nodeComboContainer);
	}

	// --- Add: "Link" sub-form (unchanged fields from the old single-edit modal) ---

	private renderLinkForm(container: HTMLElement): void {
		new Setting(container).setName("Display text").addText((text) =>
			text.setValue(this.linkLabel).onChange((v) => {
				this.linkLabel = v;
			})
		);

		new Setting(container).setName("Link type").addDropdown((dropdown) =>
			dropdown
				.addOption("wikilink", "Wikilink (note in this vault)")
				.addOption("mdlink", "URL or file path")
				.setValue(this.linkKind)
				.onChange((v) => {
					this.linkKind = v as LinkKind;
				})
		);

		new Setting(container).setName("Target").setDesc("A note title for a wikilink; a URL (with or without https://), an absolute file path, or a folder path for a URL/file-path link — opens in the browser, default app, or file browser respectively.").addText((text) =>
			text.setValue(this.linkTarget).onChange((v) => {
				this.linkTarget = v;
			})
		);

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("Add link")
				.setCta()
				.onClick(() => {
					if (!this.linkTarget.trim()) return;
					this.items = this.opts.onAddLink(this.linkKind, this.linkTarget.trim(), this.linkLabel.trim() || this.linkTarget.trim());
					this.renderItems();
					this.linkLabel = "";
					this.linkTarget = "";
					this.linkForm.empty();
					this.renderLinkForm(this.linkForm);
				})
		);
	}

	/**
	 * Hand-rolled searchable combobox (input + filtered dropdown list),
	 * generic over any `{id, label}` option list — used for both the node
	 * picker (M-R3/R5) and the R4 document picker. Not Obsidian's
	 * `AbstractInputSuggest`: that popover is meant for workspace-level
	 * inputs and doesn't reliably show up when attached to an input inside a
	 * `Modal`, so this renders its own list in the modal's own DOM instead.
	 * `getOptions` is a getter (not a snapshot) so a combobox whose backing
	 * list changes after render (the node picker, when the document
	 * selection changes) always filters against the current list.
	 */
	private renderSearchCombobox<T extends { id: string; label: string }>(
		container: HTMLElement,
		getOptions: () => T[],
		placeholder: string,
		emptyText: string,
		onSelect: (opt: T) => void,
		onTyping: () => void,
		initialValue: string
	): void {
		const wrapper = container.createDiv({ cls: "mm-relation-combobox" });
		const input = wrapper.createEl("input", {
			type: "text",
			cls: "mm-relation-combobox-input",
			attr: { placeholder },
		});
		input.value = initialValue;
		const list = wrapper.createDiv({ cls: "mm-relation-combobox-list" });
		list.style.display = "none";

		let activeIndex = -1;
		let shown: T[] = [];

		const setActive = (index: number) => {
			const items = list.querySelectorAll<HTMLElement>(".mm-relation-combobox-item");
			items.forEach((el, i) => el.toggleClass("is-active", i === index));
			activeIndex = index;
		};

		const closeList = () => {
			list.style.display = "none";
			activeIndex = -1;
		};

		const select = (opt: T) => {
			input.value = opt.label;
			onSelect(opt);
			closeList();
		};

		const openList = (query: string) => {
			const q = query.trim().toLowerCase();
			const all = getOptions();
			shown = (q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all).slice(0, RELATION_COMBOBOX_MAX_RESULTS);
			list.empty();
			if (shown.length === 0) {
				list.createDiv({ cls: "mm-relation-combobox-empty", text: emptyText });
				list.style.display = "block";
				activeIndex = -1;
				return;
			}
			for (const opt of shown) {
				const item = list.createDiv({ cls: "mm-relation-combobox-item", text: opt.label });
				item.addEventListener("mousedown", (evt) => {
					evt.preventDefault();
					select(opt);
				});
			}
			list.style.display = "block";
			setActive(0);
		};

		input.addEventListener("focus", () => openList(input.value));
		input.addEventListener("input", () => {
			onTyping();
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
					select(shown[activeIndex]);
				}
			} else if (evt.key === "Escape") {
				closeList();
			}
		});
	}
}
