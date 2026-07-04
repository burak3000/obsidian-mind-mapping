// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { InlineEditor } from "../src/view/InlineEditor";

const RECT = { left: 0, top: 0, width: 100, height: 20 };

function fireKey(input: HTMLTextAreaElement, key: string, opts: Partial<KeyboardEventInit> = {}) {
	const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
	input.dispatchEvent(evt);
	return evt;
}

describe("InlineEditor", () => {
	it("pre-fills and focuses a textarea with the initial text", () => {
		const host = document.createElement("div");
		document.body.appendChild(host); // jsdom only tracks activeElement for attached nodes
		new InlineEditor(host, {
			initialText: "hello",
			rect: RECT,
			onCommit: () => {},
			onCancel: () => {},
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		expect(input).not.toBeNull();
		expect(input.value).toBe("hello");
		expect(document.activeElement).toBe(input);
		document.body.removeChild(host);
	});

	it("Enter commits and closes editing without creating a sibling", () => {
		const onCommit = vi.fn();
		const host = document.createElement("div");
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel: () => {},
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		input.value = "edited";
		fireKey(input, "Enter");
		expect(onCommit).toHaveBeenCalledWith("edited");
		expect(host.querySelector("textarea")).toBeNull();
	});

	it("Shift+Enter is left unhandled (no preventDefault, no commit) so the textarea inserts a newline itself", () => {
		const onCommit = vi.fn();
		const host = document.createElement("div");
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel: () => {},
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		const evt = fireKey(input, "Enter", { shiftKey: true });
		expect(evt.defaultPrevented).toBe(false);
		expect(onCommit).not.toHaveBeenCalled();
		expect(host.querySelector("textarea")).not.toBeNull(); // editing stays open
	});

	it("Tab commits and requests a child", () => {
		const onCommitAndCreateChild = vi.fn();
		const host = document.createElement("div");
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit: () => {},
			onCancel: () => {},
			onCommitAndCreateChild,
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		fireKey(input, "Tab");
		expect(onCommitAndCreateChild).toHaveBeenCalledWith("x");
	});

	it("Escape cancels without committing", () => {
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		const host = document.createElement("div");
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel,
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		fireKey(input, "Escape");
		expect(onCancel).toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("blur commits the current value exactly once", () => {
		const onCommit = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel: () => {},
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		input.value = "blurred value";
		input.dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledWith("blurred value");
		expect(onCommit).toHaveBeenCalledTimes(1);
		document.body.removeChild(host);
	});

	it("Enter does not also fire blur's onCommit a second time", () => {
		const onCommit = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel: () => {},
			onCommitAndCreateChild: () => {},
		});
		const input = host.querySelector("textarea") as HTMLTextAreaElement;
		fireKey(input, "Enter");
		input.dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledTimes(1);
		document.body.removeChild(host);
	});

	it("destroy() removes the textarea without firing any callback", () => {
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		const host = document.createElement("div");
		const editor = new InlineEditor(host, {
			initialText: "x",
			rect: RECT,
			onCommit,
			onCancel,
			onCommitAndCreateChild: () => {},
		});
		editor.destroy();
		expect(host.querySelector("textarea")).toBeNull();
		expect(onCommit).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
	});
});
