// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { computeLayout, DEFAULT_LAYOUT_CONFIG } from "../src/layout/layoutEngine";
import { SvgRenderer } from "../src/render/SvgRenderer";
import { resolveRelations } from "../src/model/relations";

const WIDE_CFG = { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" as const, levelGap: 1000 };

function makeContainer(width = 800, height = 600): HTMLDivElement {
	const container = document.createElement("div");
	Object.defineProperty(container, "clientWidth", { value: width, configurable: true });
	Object.defineProperty(container, "clientHeight", { value: height, configurable: true });
	return container;
}

describe("SvgRenderer: R1a relation arrows", () => {
	it("mount() with activeRelations draws one .mm-relation path per relation, in the relationsG layer between edges and nodes", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);
		const activeRelations = resolveRelations(model, "fallback");
		expect(activeRelations.length).toBe(1);

		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, activeRelations);

		const relations = container.querySelectorAll(".mm-relation");
		expect(relations.length).toBe(1);
		expect(relations[0].getAttribute("marker-end")).toBe("url(#mm-relation-arrowhead)");

		// Layer order: relations sit between edges and nodes.
		const viewport = container.querySelector(".mm-viewport")!;
		const layers = Array.from(viewport.children).map((el) => el.className.baseVal ?? (el as Element).getAttribute("class"));
		expect(layers.indexOf("mm-edges")).toBeLessThan(layers.indexOf("mm-relations"));
		expect(layers.indexOf("mm-relations")).toBeLessThan(layers.indexOf("mm-nodes"));

		renderer.destroy();
	});

	it("draws no relation arrow when there are no same-doc relations", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, resolveRelations(model, "fallback"));
		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("showRelations=false (the setting's off position) draws no arrows and does no relation work even when relations are resolved and passed in", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);
		const activeRelations = resolveRelations(model, "fallback");

		const container = makeContainer();
		const renderer = new SvgRenderer(container, undefined, DEFAULT_LAYOUT_CONFIG, false);
		renderer.mount(model, activeRelations);

		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("removes a relation's arrow once it's no longer in the active list (e.g. the link was edited away), on the next update()", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, resolveRelations(model, "fallback"));
		expect(container.querySelectorAll(".mm-relation").length).toBe(1);

		const source = model.root.children[0];
		source.text = "Source";
		computeLayout(model.root);
		renderer.update(model, resolveRelations(model, "fallback"));

		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("skips a relation whose target is currently folded away, without crashing", () => {
		const md = ["# Root", "## Branch", "- Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branch = model.root.children[0];
		branch.folded = true; // hides "Source" (and thus the relation) — Target is a separate, unaffected branch
		computeLayout(model.root);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		expect(() => renderer.mount(model, resolveRelations(model, "fallback"))).not.toThrow();
		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("skips (and does not crash on) a relation pair with a stale/unknown id", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		expect(() => renderer.mount(model, [{ sourceId: "nope", targetId: "also-nope" }])).not.toThrow();
		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("culling: a relation whose source and target are both far outside the viewport is not in the DOM above the culling threshold", () => {
		// Build a wide chain (300+ nodes) with a relation between the two
		// farthest-out nodes so both endpoints land well outside the viewport.
		const lines = ["# Root"];
		for (let i = 1; i <= 350; i++) lines.push(`${"  ".repeat(Math.max(0, i - 2))}${i === 1 ? "##" : "-"} Node ${i}`);
		const md = lines.join("\n");
		const model = parseMindMap(md, "fallback");
		let deepest = model.root;
		while (deepest.children.length) deepest = deepest.children[0];
		const secondDeepest = (() => {
			let n = model.root;
			let prev = n;
			while (n.children.length) {
				prev = n;
				n = n.children[0];
			}
			return prev;
		})();
		deepest.text = `${deepest.text} [[#^far1]]`;
		secondDeepest.id = "far1";
		model.byId.set("far1", secondDeepest);

		computeLayout(model.root, WIDE_CFG);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		const active = resolveRelations(model, "fallback");
		expect(active.length).toBe(1);
		renderer.mount(model, active);

		// Both endpoints are far outside the 800x600 (+margin) viewport at mount time.
		expect(container.querySelectorAll(".mm-relation").length).toBe(0);
		renderer.destroy();
	});

	it("panning a relation's endpoints into view brings its arrow back into the DOM", async () => {
		// Relation between the two farthest-out nodes (not root, which sits at
		// the pan pivot and is always near-center regardless of chain depth) —
		// both endpoints start off-screen, then pan together into view.
		const lines = ["# Root"];
		for (let i = 1; i <= 350; i++) lines.push(`${"  ".repeat(Math.max(0, i - 2))}${i === 1 ? "##" : "-"} Node ${i}`);
		const model = parseMindMap(lines.join("\n"), "fallback");
		let deepest = model.root;
		let secondDeepest = model.root;
		while (deepest.children.length) {
			secondDeepest = deepest;
			deepest = deepest.children[0];
		}
		deepest.text = `${deepest.text} [[#^far1]]`;
		secondDeepest.id = "far1";
		model.byId.set("far1", secondDeepest);

		computeLayout(model.root, WIDE_CFG);
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		const active = resolveRelations(model, "fallback");
		expect(active.length).toBe(1);
		renderer.mount(model, active);
		await nextFrame();
		expect(container.querySelectorAll(".mm-relation").length).toBe(0);

		const deepestX = deepest.layout!.x;
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: -deepestX, clientY: 0, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: -deepestX, clientY: 0, pointerId: 1 }));
		await nextFrame();

		expect(container.querySelectorAll(".mm-relation").length).toBe(1);
		renderer.destroy();
	});
});

describe("SvgRenderer: R2 cross-document relation badge", () => {
	it("a node linking to a different document gets the cross-doc badge", () => {
		const model = parseMindMap(["# Root", "## Source [[Other Note]]"].join("\n"), "fallback");
		computeLayout(model.root);
		resolveRelations(model, "fallback");
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, []);

		const branch = model.root.children[0];
		expect(container.querySelector(`[data-node-id="${branch.id}"] .mm-cross-doc-badge`)).not.toBeNull();
		renderer.destroy();
	});

	it("a node with a same-map relation gets an arrow, not the cross-doc badge", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);
		const active = resolveRelations(model, "fallback");
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, active);

		const source = model.root.children[0];
		expect(container.querySelector(`[data-node-id="${source.id}"] .mm-cross-doc-badge`)).toBeNull();
		expect(container.querySelectorAll(".mm-relation").length).toBe(1);
		renderer.destroy();
	});

	it("a node with no link gets neither the badge nor an arrow", () => {
		const model = parseMindMap(["# Root", "## Plain"].join("\n"), "fallback");
		computeLayout(model.root);
		resolveRelations(model, "fallback");
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, []);

		const branch = model.root.children[0];
		expect(container.querySelector(`[data-node-id="${branch.id}"] .mm-cross-doc-badge`)).toBeNull();
		renderer.destroy();
	});

	it("clicking the cross-doc badge fires the badge click handler with that node's id, not the node click handler", () => {
		const model = parseMindMap(["# Root", "## Source [[Other Note]]"].join("\n"), "fallback");
		computeLayout(model.root);
		resolveRelations(model, "fallback");
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		let badgeClickedId: string | null = null;
		let nodeClickedId: string | null = null;
		renderer.setCrossDocBadgeClickHandler((id) => (badgeClickedId = id));
		renderer.setNodeClickHandler((id) => (nodeClickedId = id));
		renderer.mount(model, []);

		const branch = model.root.children[0];
		const badge = container.querySelector(`[data-node-id="${branch.id}"] .mm-cross-doc-badge circle`)!;
		badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(badgeClickedId).toBe(branch.id);
		expect(nodeClickedId).toBeNull();
		renderer.destroy();
	});

	it("removing the link from a node's text removes its cross-doc badge on the next update()", () => {
		const model = parseMindMap(["# Root", "## Source [[Other Note]]"].join("\n"), "fallback");
		computeLayout(model.root);
		resolveRelations(model, "fallback");
		const container = makeContainer();
		const renderer = new SvgRenderer(container);
		renderer.mount(model, []);
		const branch = model.root.children[0];
		expect(container.querySelector(`[data-node-id="${branch.id}"] .mm-cross-doc-badge`)).not.toBeNull();

		branch.text = "Source";
		computeLayout(model.root);
		resolveRelations(model, "fallback");
		renderer.update(model, []);

		expect(container.querySelector(`[data-node-id="${branch.id}"] .mm-cross-doc-badge`)).toBeNull();
		renderer.destroy();
	});
});

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
