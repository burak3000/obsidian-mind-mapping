// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { computeLayout, DEFAULT_LAYOUT_CONFIG } from "../src/layout/layoutEngine";
import { SvgRenderer } from "../src/render/SvgRenderer";

// Force everything onto one side with a small level gap so many nodes land
// at predictably large depth-axis (x) offsets — makes it easy to construct
// a small tree where most nodes are clearly outside a narrow viewport.
const WIDE_CFG = { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" as const, levelGap: 1000 };

function makeChain(depth: number): string {
	const lines = ["# Root"];
	for (let i = 1; i <= depth; i++) {
		lines.push(`${"  ".repeat(Math.max(0, i - 2))}${i === 1 ? "##" : "-"} Node ${i}`);
	}
	return lines.join("\n");
}

describe("viewport culling", () => {
	it("below the culling threshold, every node renders regardless of position", () => {
		const model = parseMindMap(makeChain(10), "fallback");
		computeLayout(model.root, WIDE_CFG);

		const container = document.createElement("div");
		Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		expect(container.querySelectorAll(".mm-node").length).toBe(11); // root + 10
		renderer.destroy();
	});

	it("above the culling threshold, nodes far outside the viewport are not in the DOM", () => {
		const model = parseMindMap(makeChain(400), "fallback");
		computeLayout(model.root, WIDE_CFG);

		const container = document.createElement("div");
		Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const rendered = container.querySelectorAll(".mm-node").length;
		expect(rendered).toBeGreaterThan(0);
		expect(rendered).toBeLessThan(401); // far fewer than the full 401 nodes
		renderer.destroy();
	});

	it("panning toward a previously-culled node brings it back into the DOM", async () => {
		const model = parseMindMap(makeChain(400), "fallback");
		computeLayout(model.root, WIDE_CFG);

		const container = document.createElement("div");
		Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		await nextFrame(); // let the initial mount's rAF-scheduled transform+recull settle

		const deepest = (() => {
			let n = model.root;
			while (n.children.length) n = n.children[0];
			return n;
		})();
		const deepestX = deepest.layout!.x;
		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).toBeNull();

		// Pan left by exactly deepestX (in screen px, scale=1) so the deepest
		// node's world position lands back under the viewport's origin.
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: -deepestX, clientY: 0, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: -deepestX, clientY: 0, pointerId: 1 }));
		await nextFrame();

		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).not.toBeNull();
		renderer.destroy();
	});
});

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
