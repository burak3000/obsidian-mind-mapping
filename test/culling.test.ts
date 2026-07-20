// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { SvgRenderer } from "../src/render/SvgRenderer";
import { buildModel } from "./helpers/render";
import type { MindMapModel, MindNode } from "../src/model/types";

// Force everything onto one side with a small level gap so many nodes land
// at predictably large depth-axis (x) offsets — makes it easy to construct
// a small tree where most nodes are clearly outside a narrow viewport.
const WIDE_CFG = { mode: "right-only" as const, levelGap: 1000 };

function makeChain(depth: number): string {
	const lines = ["# Root"];
	for (let i = 1; i <= depth; i++) lines.push(`${"  ".repeat(Math.max(0, i - 2))}${i === 1 ? "##" : "-"} Node ${i}`);
	return lines.join("\n");
}

function deepestNode(model: MindMapModel): MindNode {
	let n = model.root;
	while (n.children.length) n = n.children[0];
	return n;
}

function makeContainer(width = 800, height = 600): HTMLDivElement {
	const container = document.createElement("div");
	Object.defineProperty(container, "clientWidth", { value: width, configurable: true });
	Object.defineProperty(container, "clientHeight", { value: height, configurable: true });
	return container;
}

let liveRenderers: SvgRenderer[] = [];
afterEach(() => {
	for (const r of liveRenderers) r.destroy();
	liveRenderers = [];
});

function mountChain(depth: number, setup?: (r: SvgRenderer) => void, md: string = makeChain(depth)) {
	const model = buildModel(md, WIDE_CFG);
	const container = makeContainer();
	const renderer = new SvgRenderer(container);
	liveRenderers.push(renderer);
	setup?.(renderer);
	renderer.mount(model);
	return { model, container, renderer };
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Pans the canvas left by `x` screen px (scale=1), e.g. to bring a node at world-x `x` back under the viewport origin. */
function panLeftBy(container: HTMLElement, x: number): void {
	const svg = container.querySelector(".mm-svg")!;
	svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
	svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: -x, clientY: 0, pointerId: 1 }));
	svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: -x, clientY: 0, pointerId: 1 }));
}

describe("viewport culling", () => {
	it("below the culling threshold, every node renders regardless of position", () => {
		const { container } = mountChain(10);
		expect(container.querySelectorAll(".mm-node").length).toBe(11); // root + 10
	});

	it("above the culling threshold, nodes far outside the viewport are not in the DOM", () => {
		const { container } = mountChain(400);
		const rendered = container.querySelectorAll(".mm-node").length;
		expect(rendered).toBeGreaterThan(0);
		expect(rendered).toBeLessThan(401); // far fewer than the full 401 nodes
	});

	it("panning toward a previously-culled node brings it back into the DOM", async () => {
		const { model, container } = mountChain(400);
		await nextFrame(); // let the initial mount's rAF-scheduled transform+recull settle

		const deepest = deepestNode(model);
		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).toBeNull();

		panLeftBy(container, deepest.layout!.x);
		await nextFrame();

		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).not.toBeNull();
	});

	it("centerOnWorldPoint brings a culled-out node back into the DOM (search-jump support)", async () => {
		const { model, container, renderer } = mountChain(400);
		await nextFrame();

		const deepest = deepestNode(model);
		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).toBeNull();

		// Read straight from the model's layout (as MindMapView's search-jump
		// does), not the renderer's own DOM cache — that's the whole point:
		// a culled node's entry there was already pruned by applyVisibleSet.
		renderer.centerOnWorldPoint(deepest.layout!.x + deepest.layout!.w / 2, deepest.layout!.y + deepest.layout!.h / 2);
		await nextFrame();

		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).not.toBeNull();
	});

	it("image embed lazy-load (plan item 07) rides along with culling: the resolver isn't called for a culled-out node, and is called once it scrolls into view", async () => {
		const resolvedIds: string[] = [];
		const { model, container } = mountChain(
			400,
			(r) =>
				r.setImageResolver((node) => {
					resolvedIds.push(node.id);
					return "resource://photo.png";
				}),
			makeChain(400).replace("Node 400", "Node 400 ![[photo.png]]"),
		);
		await nextFrame();

		const deepest = deepestNode(model);
		expect(container.querySelector(`[data-node-id="${deepest.id}"]`)).toBeNull(); // culled out
		expect(resolvedIds).not.toContain(deepest.id); // never resolved while off-screen

		panLeftBy(container, deepest.layout!.x);
		await nextFrame();

		expect(container.querySelector(`[data-node-id="${deepest.id}"] .mm-node-image`)).not.toBeNull();
		expect(resolvedIds).toContain(deepest.id); // resolved now that it's visible
	});
});
