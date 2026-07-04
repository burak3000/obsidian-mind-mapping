export interface ScreenRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface InlineEditorOptions {
	initialText: string;
	rect: ScreenRect;
	onCommit: (text: string) => void;
	onCancel: () => void;
	onCommitAndCreateChild: (text: string) => void;
}

/**
 * Lightweight overlay editor (plan §9.5, addendum §4.5): a plain positioned
 * `<textarea>`, not a round-trip through the file. Keystrokes are handled
 * entirely by the native element — the model/layout/render pipeline is
 * untouched until commit, so typing never triggers a tree mutation,
 * relayout, or re-render (addendum rule 6: no full work per keystroke).
 * A `<textarea>` (not `<input>`) so Shift+Enter can insert an actual
 * newline for long/multi-line labels — plain `<input>` has no concept of a
 * line break at all.
 *
 * Positioned `absolute` inside `host` (which must be `position: relative`
 * or similar), not `fixed` against the viewport — `fixed` silently
 * anchors to the nearest transformed ancestor instead of the viewport if
 * one exists anywhere up the tree, which Obsidian's workspace often has
 * (pane animations, mobile), landing the input in the wrong place.
 */
export class InlineEditor {
	private readonly input: HTMLTextAreaElement;
	private committed = false;

	constructor(host: HTMLElement, opts: InlineEditorOptions) {
		const input = document.createElement("textarea");
		input.className = "mm-inline-editor";
		input.value = opts.initialText;
		input.rows = 1;
		input.style.position = "absolute";
		input.style.left = `${opts.rect.left}px`;
		input.style.top = `${opts.rect.top}px`;
		input.style.width = `${opts.rect.width}px`;
		input.style.height = `${opts.rect.height}px`;
		host.appendChild(input);
		input.focus();
		input.select();
		this.input = input;

		const finish = (action: () => void) => {
			if (this.committed) return;
			this.committed = true;
			action();
			input.remove();
		};

		// Grows the overlay to fit content that wraps past the node's
		// current (pre-edit) box height — a pure DOM style write on the
		// overlay element itself, not a tree mutation/relayout, so it stays
		// within the "no full work per keystroke" rule same as everything
		// else in this class.
		input.addEventListener("input", () => {
			input.style.height = "auto";
			input.style.height = `${input.scrollHeight}px`;
		});

		input.addEventListener("keydown", (evt) => {
			evt.stopPropagation(); // keep global node-navigation shortcuts from firing while typing
			if (evt.key === "Enter" && !evt.shiftKey) {
				// Closes editing and leaves the node selected (same as
				// blur/onCommit) rather than immediately creating a new
				// sibling — a second Enter, now that nothing is being
				// edited, is what creates the sibling (see MindMapView's
				// keydown handler). Shift+Enter is deliberately left
				// unhandled here so the textarea's own default behavior
				// (insert a newline) applies.
				evt.preventDefault();
				finish(() => opts.onCommit(input.value));
			} else if (evt.key === "Tab") {
				evt.preventDefault();
				finish(() => opts.onCommitAndCreateChild(input.value));
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				finish(() => opts.onCancel());
			}
		});

		input.addEventListener("blur", () => finish(() => opts.onCommit(input.value)));
	}

	destroy(): void {
		if (this.committed) return;
		this.committed = true;
		this.input.remove();
	}
}
