// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/view/SearchPanel";
import { SearchOutcome } from "../src/model/search";

function fireKey(input: HTMLInputElement, key: string) {
	input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

const OUTCOME: SearchOutcome = {
	results: [
		{ id: "n1", text: "Alpha" },
		{ id: "n2", text: "Beta" },
	],
	totalMatches: 2,
};

let attachedHosts: HTMLElement[] = [];
afterEach(() => {
	for (const host of attachedHosts) host.remove();
	attachedHosts = [];
});

/** Builds a SearchPanel with vi.fn() spies for onSelect/onClose (override via opts) and `onQuery` defaulting to always return OUTCOME. `attach: true` appends the host to document.body — needed for activeElement/focus tests. */
function makePanel(opts: { onQuery?: () => SearchOutcome; attach?: boolean } = {}) {
	const host = document.createElement("div");
	if (opts.attach) {
		document.body.appendChild(host);
		attachedHosts.push(host);
	}
	const onSelect = vi.fn();
	const onClose = vi.fn();
	const panel = new SearchPanel(host, { onQuery: opts.onQuery ?? (() => OUTCOME), onSelect, onClose });
	const input = host.querySelector(".mm-search-input") as HTMLInputElement;
	return { host, panel, input, onSelect, onClose };
}

function type(input: HTMLInputElement, value = ""): void {
	input.value = value;
	input.dispatchEvent(new Event("input"));
}

describe("SearchPanel", () => {
	it("focuses the input on creation and runs a query on every keystroke", () => {
		const onQuery = vi.fn().mockReturnValue(OUTCOME);
		const { host, input } = makePanel({ onQuery, attach: true });
		expect(document.activeElement).toBe(input);

		type(input, "alp");
		expect(onQuery).toHaveBeenCalledWith("alp");
		expect(host.querySelectorAll(".mm-search-result").length).toBe(2);
		expect(host.querySelector(".mm-search-result")!.textContent).toBe("Alpha");
	});

	it("clicking a result calls onSelect with that node's id", () => {
		const { host, input, onSelect } = makePanel();
		type(input);
		host.querySelectorAll(".mm-search-result")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onSelect).toHaveBeenCalledWith("n2");
	});

	it("Enter selects the first result by default", () => {
		const { input, onSelect } = makePanel();
		type(input);
		fireKey(input, "Enter");
		expect(onSelect).toHaveBeenCalledWith("n1");
	});

	it("ArrowDown/ArrowUp move the highlighted result, and Enter selects it", () => {
		const { host, input, onSelect } = makePanel();
		type(input);

		fireKey(input, "ArrowDown"); // 0 -> 1
		expect(host.querySelectorAll(".mm-search-result")[1].classList.contains("mm-search-result-active")).toBe(true);

		fireKey(input, "Enter");
		expect(onSelect).toHaveBeenCalledWith("n2");
	});

	it("ArrowDown wraps from the last result back to the first", () => {
		const { host, input } = makePanel();
		type(input);
		fireKey(input, "ArrowDown"); // 0 -> 1
		fireKey(input, "ArrowDown"); // 1 -> wraps to 0
		expect(host.querySelectorAll(".mm-search-result")[0].classList.contains("mm-search-result-active")).toBe(true);
	});

	it("Escape calls onClose", () => {
		const { input, onClose } = makePanel({ onQuery: () => ({ results: [], totalMatches: 0 }) });
		fireKey(input, "Escape");
		expect(onClose).toHaveBeenCalled();
	});

	it("shows a count of total matches even when the result list is capped", () => {
		const { host, input } = makePanel({ onQuery: () => ({ results: [{ id: "n1", text: "x" }], totalMatches: 5 }) });
		type(input, "x");
		expect(host.querySelector(".mm-search-count")!.textContent).toContain("5 matches");
	});

	it("shows nothing for an empty query and 'No matches' for a query with zero hits", () => {
		const { host, input } = makePanel({ onQuery: () => ({ results: [], totalMatches: 0 }) });

		type(input, "");
		expect(host.querySelector(".mm-search-count")!.textContent).toBe("");

		type(input, "nothing matches this");
		expect(host.querySelector(".mm-search-count")!.textContent).toBe("No matches");
	});

	it("destroy() removes the panel from the DOM", () => {
		const { host, panel } = makePanel();
		panel.destroy();
		expect(host.querySelector(".mm-search-panel")).toBeNull();
	});

	it("focus() re-focuses the input without rebuilding the panel", () => {
		const { input, panel } = makePanel({ attach: true });
		(document.activeElement as HTMLElement).blur();
		expect(document.activeElement).not.toBe(input);

		panel.focus();
		expect(document.activeElement).toBe(input);
	});
});
