// @vitest-environment jsdom
//
// Smoke test only: catches crashes/structural regressions in the renderer.
// This is NOT visual verification — jsdom doesn't paint or lay out pixels,
// so colors/sizes/positions on screen must still be checked manually in
// the dev vault (see CLAUDE.md).
import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { computeLayout, DEFAULT_LAYOUT_CONFIG, fontSizeForDepth, scaleForDepth } from "../src/layout/layoutEngine";
import { SvgRenderer } from "../src/render/SvgRenderer";

describe("SvgRenderer", () => {
	it("mount() creates one .mm-node per visible node and one .mm-edge per parent-child edge", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1", "## Branch B", "- b"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		// 6 nodes total: Root, Branch A, a, a1, Branch B, b
		expect(container.querySelectorAll(".mm-node").length).toBe(6);
		// 5 edges: one per non-root node
		expect(container.querySelectorAll(".mm-edge").length).toBe(5);

		renderer.destroy();
		expect(container.childElementCount).toBe(0);
	});

	it("marks only the root node with mm-node-root (sub-topics render unboxed per CSS)", () => {
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const rootG = container.querySelector(`[data-node-id="${model.root.id}"]`)!;
		const branchG = container.querySelector(`[data-node-id="${model.root.children[0].id}"]`)!;
		expect(rootG.classList.contains("mm-node-root")).toBe(true);
		expect(branchG.classList.contains("mm-node-root")).toBe(false);

		renderer.destroy();
	});

	it("renders each node's font-size strictly decreasing with depth, root largest (R15: visual hierarchy by size)", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const fontSizeOf = (id: string) => Number(container.querySelector(`[data-node-id="${id}"] .mm-node-text`)!.getAttribute("font-size"));

		const branch = model.root.children[0];
		const a = branch.children[0];
		const a1 = a.children[0];
		const sizes = [model.root, branch, a, a1].map((n) => fontSizeOf(n.id));

		expect(sizes[0]).toBe(DEFAULT_LAYOUT_CONFIG.rootFontSize);
		for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
		// And matches the exact depth-based formula, not just "smaller".
		[model.root, branch, a, a1].forEach((n, i) => expect(sizes[i]).toBe(fontSizeForDepth(n.depth, DEFAULT_LAYOUT_CONFIG)));

		renderer.destroy();
	});

	it("wraps long text into multiple tspan lines and grows the rect height to match the layout box", () => {
		const longText = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const md = ["# Root", `## ${longText}`].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0];
		expect(branch.layout!.h).toBeGreaterThan(DEFAULT_LAYOUT_CONFIG.nodeHeight); // sanity: this node actually wrapped

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const textEl = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-text`)!;
		const lineTspans = textEl.querySelectorAll(":scope > tspan");
		expect(lineTspans.length).toBeGreaterThan(1);
		expect(lineTspans[0].getAttribute("dy")).toBeNull(); // first line has no offset
		// depth 1, so scaled by that depth's font size (R15), not the raw baseline lineHeight.
		expect(lineTspans[1].getAttribute("dy")).toBe(String(DEFAULT_LAYOUT_CONFIG.lineHeight * scaleForDepth(1, DEFAULT_LAYOUT_CONFIG)));

		const rect = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-rect`)!;
		expect(rect.getAttribute("height")).toBe(String(branch.layout!.h));

		renderer.destroy();
	});

	it("keeps a link clickable even when its label is split across two wrapped lines", () => {
		const md = ["# Root", "## start of a long line [[Some Note]] and then it keeps going past the wrap point for sure"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let linkClicked: [string, string] | null = null;
		renderer.setLinkClickHandler((kind, target) => (linkClicked = [kind, target]));
		renderer.mount(model);

		const linkSpans = container.querySelectorAll(`[data-node-id="${branch.id}"] .mm-node-link`);
		expect(linkSpans.length).toBeGreaterThan(0);
		linkSpans[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(linkClicked).toEqual(["wikilink", "Some Note"]);

		renderer.destroy();
	});

	it("renders each edge as a filled ribbon that tapers continuously from the parent's branch width to the child's, not a constant-width stroke", () => {
		// Regression: R10 originally only varied stroke-width per edge as a
		// whole (constant width along its own length, thinner level to
		// level). The user asked for the higher-fidelity version: a single
		// connector should itself narrow from thick (parent end) to thin
		// (child end).
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0]; // depth 1, parent = root (depth 0)
		const a = branch.children[0]; // depth 2, parent = branch (depth 1)

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		// No stroke is used at all — width comes entirely from fill geometry.
		expect(container.querySelectorAll(".mm-edge")[0].getAttribute("stroke-width")).toBeNull();

		const widthsOf = (d: string): { start: number; end: number } => {
			const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
			const points: [number, number][] = [];
			for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
			const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
			const n = (points.length - 2) / 2; // top row length - 1 (== TAPER_SAMPLES)
			return { start: dist(points[0], points[points.length - 1]), end: dist(points[n], points[n + 1]) };
		};

		const branchEdge = container.querySelector(`[data-child-id="${branch.id}"]`)!.getAttribute("d")!;
		const aEdge = container.querySelector(`[data-child-id="${a.id}"]`)!.getAttribute("d")!;

		const branchWidths = widthsOf(branchEdge);
		const aWidths = widthsOf(aEdge);

		// Root -> Branch A: narrows from root's (depth 0) width to Branch A's (depth 1) width.
		expect(branchWidths.start).toBeGreaterThan(branchWidths.end);
		// Branch A -> a: continues narrowing, starting where the previous edge left off.
		expect(aWidths.start).toBeCloseTo(branchWidths.end, 1);
		expect(aWidths.end).toBeLessThan(aWidths.start);

		renderer.destroy();
	});

	it("ends an edge at the child's near edge (short hop, not stretched across its whole box) and anchors the child's text right next to that tip", () => {
		// Regression: an earlier attempt stretched the edge across the
		// child's *entire* box (far edge) so text would visually sit "on"
		// the branch — but for a wide (long/wrapped-text) box that turned a
		// short hop into a long diagonal sweep that crossed straight
		// through *other* nodes' text nearby. The fix keeps the edge short
		// (near edge, as always) and instead aligns the text itself flush
		// against that tip, growing away from it — see DECISIONS.md.
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const midpointX = (d: string): number => {
			const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
			const points: [number, number][] = [];
			for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
			const n = (points.length - 2) / 2; // index of the last centerline sample (top row)
			return (points[n][0] + points[n + 1][0]) / 2; // average of the two far-end offset points = the centerline's endpoint x
		};

		const branchEdgeD = container.querySelector(`[data-child-id="${branch.id}"]`)!.getAttribute("d")!;
		// Edge ends at Branch A's *near* edge (x), not its far edge (x + w).
		expect(midpointX(branchEdgeD)).toBeCloseTo(branch.layout!.x, 1);

		const textEl = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-text`)!;
		// Right-side node: text starts (text-anchor: start) right next to
		// that same near-edge tip, not centered in the middle of the box.
		expect(textEl.getAttribute("text-anchor")).toBe("start");
		expect(Number(textEl.getAttribute("x"))).toBeLessThan(branch.layout!.w / 2);

		renderer.destroy();
	});

	it("anchors a left-side node's text at its near (right) edge, growing leftward away from it", () => {
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "left-only" });
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const textEl = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-text`)!;
		expect(textEl.getAttribute("text-anchor")).toBe("end");
		expect(Number(textEl.getAttribute("x"))).toBeGreaterThan(branch.layout!.w / 2);

		renderer.destroy();
	});

	it("keeps the root's text centered in its own (visible) box, unlike sub-topics", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const rootText = container.querySelector(`[data-node-id="${model.root.id}"] .mm-node-text`)!;
		expect(rootText.getAttribute("text-anchor")).toBe("middle");
		expect(Number(rootText.getAttribute("x"))).toBeCloseTo(model.root.layout!.w / 2, 1);

		renderer.destroy();
	});

	it("excludes folded subtrees from the rendered DOM", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1"].join("\n");
		const model = parseMindMap(md, "fallback");
		model.root.children[0].folded = true;
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		// Root + Branch A only; "a" and "a1" are hidden by folding.
		expect(container.querySelectorAll(".mm-node").length).toBe(2);
		renderer.destroy();
	});

	it("selectNode toggles the mm-selected class without touching other nodes", () => {
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		const branchId = model.root.children[0].id;

		renderer.selectNode(branchId);
		expect(container.querySelector(`[data-node-id="${branchId}"]`)?.classList.contains("mm-selected")).toBe(true);

		renderer.selectNode(null);
		expect(container.querySelector(`[data-node-id="${branchId}"]`)?.classList.contains("mm-selected")).toBe(false);

		renderer.destroy();
	});

	it("update() adds new nodes and edges without recreating unchanged ones", () => {
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const branchGBefore = container.querySelector(`[data-node-id="${model.root.children[0].id}"]`);

		// Simulate a Tab: add a new child under Branch A, relayout, update.
		const branch = model.root.children[0];
		branch.children.push({
			id: "new1",
			text: "New child",
			children: [],
			parent: branch,
			depth: 2,
			folded: false,
			subtreeCount: 0,
		});
		model.byId.set("new1", branch.children[0]);
		branch.subtreeCount += 1;
		model.root.subtreeCount += 1;
		computeLayout(model.root);
		renderer.update(model);

		expect(container.querySelectorAll(".mm-node").length).toBe(3);
		expect(container.querySelectorAll(".mm-edge").length).toBe(2);
		// Branch A's own DOM element identity is preserved across the update.
		const branchGAfter = container.querySelector(`[data-node-id="${model.root.children[0].id}"]`);
		expect(branchGAfter).toBe(branchGBefore);

		renderer.destroy();
	});

	it("update() removes DOM for nodes that are deleted from the model", () => {
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		expect(container.querySelectorAll(".mm-node").length).toBe(3);

		const branch = model.root.children[0];
		branch.children = [];
		model.byId.delete(branch.children[0]?.id ?? "");
		branch.subtreeCount = 0;
		model.root.subtreeCount = 1;
		computeLayout(model.root);
		renderer.update(model);

		expect(container.querySelectorAll(".mm-node").length).toBe(2);
		expect(container.querySelectorAll(".mm-edge").length).toBe(1);
		renderer.destroy();
	});

	it("shows a fold-count badge with the cached subtreeCount when a node is folded, and switches to a plain collapse dot on unfold", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1", "  - a2"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branch = model.root.children[0];
		branch.folded = true;
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const branchG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		const badge = branchG.querySelector(".mm-fold-badge");
		expect(badge).not.toBeNull();
		expect(badge!.classList.contains("mm-fold-badge-folded")).toBe(true);
		expect(badge!.querySelector("text")!.textContent).toBe(String(branch.subtreeCount)); // 3: a, a1, a2

		branch.folded = false;
		computeLayout(model.root);
		renderer.update(model);
		// Branch still has children, so the collapse affordance stays — just no longer showing a count.
		const collapseDot = branchG.querySelector(".mm-fold-badge");
		expect(collapseDot).not.toBeNull();
		expect(collapseDot!.classList.contains("mm-fold-badge-folded")).toBe(false);
		expect(collapseDot!.querySelector("text")!.textContent).toBe("–");

		renderer.destroy();
	});

	it("shows a plain collapse dot (no count) on an unfolded node with children", () => {
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branch = model.root.children[0];
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);

		const badge = container.querySelector(`[data-node-id="${branch.id}"] .mm-fold-badge`);
		expect(badge).not.toBeNull();
		expect(badge!.classList.contains("mm-fold-badge-folded")).toBe(false);
		expect(badge!.querySelector("text")!.textContent).toBe("–");
		renderer.destroy();
	});

	it("does not show a fold affordance on a childless node, folded or not", () => {
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branch = model.root.children[0];
		branch.folded = true; // folded but childless — nothing to hide, nothing to badge
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		expect(container.querySelector(`[data-node-id="${branch.id}"] .mm-fold-badge`)).toBeNull();
		renderer.destroy();
	});

	it("clicking a fold badge invokes the badge click handler with that node's id, not the node click handler", () => {
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branch = model.root.children[0];
		branch.folded = true;
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let badgeClickedId: string | null = null;
		let nodeClickedId: string | null = null;
		renderer.setBadgeClickHandler((id) => (badgeClickedId = id));
		renderer.setNodeClickHandler((id) => (nodeClickedId = id));
		renderer.mount(model);

		const badge = container.querySelector(`[data-node-id="${branch.id}"] .mm-fold-badge circle`)!;
		badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(badgeClickedId).toBe(branch.id);
		expect(nodeClickedId).toBeNull();
		renderer.destroy();
	});

	it("two quick clicks on the same node trigger the dblclick handler, not a second single-click", () => {
		// Regression: dblclick used to rely on the native browser event, which
		// can get retargeted to the capturing <svg> element (not the node)
		// while pointer capture is active for drag support — breaking
		// closest(".mm-node"). Double-click is now detected from plain
		// `click` events instead, so this only needs the native `click`
		// event, never `dblclick`, to work correctly.
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		const clickIds: string[] = [];
		const dblClickIds: string[] = [];
		renderer.setNodeClickHandler((id) => clickIds.push(id));
		renderer.setNodeDblClickHandler((id) => dblClickIds.push(id));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		nodeG.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		nodeG.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(clickIds).toEqual([branch.id]); // first click only
		expect(dblClickIds).toEqual([branch.id]); // second click promoted to dblclick

		renderer.destroy();
	});

	it("two clicks on different nodes do not trigger dblclick", () => {
		const model = parseMindMap(["# Root", "## Branch A", "## Branch B"].join("\n"), "fallback");
		computeLayout(model.root);
		const [a, b] = model.root.children;

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		const dblClickIds: string[] = [];
		renderer.setNodeClickHandler(() => {});
		renderer.setNodeDblClickHandler((id) => dblClickIds.push(id));
		renderer.mount(model);

		container.querySelector(`[data-node-id="${a.id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		container.querySelector(`[data-node-id="${b.id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(dblClickIds).toEqual([]);
		renderer.destroy();
	});

	it("a third click after a double-click starts fresh instead of firing dblclick again", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		const dblClickIds: string[] = [];
		renderer.setNodeClickHandler(() => {});
		renderer.setNodeDblClickHandler((id) => dblClickIds.push(id));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		nodeG.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		nodeG.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		nodeG.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(dblClickIds).toEqual([branch.id]); // only once, not on every subsequent click
		renderer.destroy();
	});

	it("toggles the mm-animated class based on the visible-node-count threshold", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		expect(container.querySelector(".mm-svg")!.classList.contains("mm-animated")).toBe(true);
		renderer.destroy();
	});

	it("renders a link inside node text as a separate clickable tspan and routes its click to the link handler, not node select", () => {
		const model = parseMindMap(["# Root", "## Check [[Some Note]] please"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let linkClicked: [string, string] | null = null;
		let nodeClicked: string | null = null;
		renderer.setLinkClickHandler((kind, target) => (linkClicked = [kind, target]));
		renderer.setNodeClickHandler((id) => (nodeClicked = id));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		const linkSpan = nodeG.querySelector(".mm-node-link")!;
		expect(linkSpan.textContent).toBe("Some Note");

		linkSpan.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(linkClicked).toEqual(["wikilink", "Some Note"]);
		expect(nodeClicked).toBeNull();

		renderer.destroy();
	});

	it("renders plain node text without any tspan wrapper when there is no link", () => {
		const model = parseMindMap(["# Root", "## Plain branch"].join("\n"), "fallback");
		computeLayout(model.root);
		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		const branch = model.root.children[0];
		const textEl = container.querySelector(`[data-node-id="${branch.id}"] .mm-node-text`)!;
		expect(textEl.querySelector("tspan")).toBeNull();
		expect(textEl.textContent).toBe("Plain branch");
		renderer.destroy();
	});

	it("Alt+drag reports a manual-move with the position offset by the drag delta (scaled)", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];
		const startX = branch.layout!.x;
		const startY = branch.layout!.y;

		const container = document.createElement("div");
		Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
		const renderer = new SvgRenderer(container);
		let moved: { nodeId: string; pos: { x: number; y: number } } | null = null;
		renderer.setManualMoveHandler((nodeId, pos) => (moved = { nodeId, pos }));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		nodeG.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, altKey: true, clientX: 100, clientY: 100, pointerId: 1 }));
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, altKey: true, clientX: 140, clientY: 130, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, altKey: true, clientX: 140, clientY: 130, pointerId: 1 }));

		expect(moved).not.toBeNull();
		// scale is 1 at mount time, so the offset is the raw client delta.
		expect(moved!.nodeId).toBe(branch.id);
		expect(moved!.pos.x).toBeCloseTo(startX + 40);
		expect(moved!.pos.y).toBeCloseTo(startY + 30);

		renderer.destroy();
	});

	it("dragging a node's resize handle reports the final width, growing outward from the parent (right side)", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0];
		const startWidth = branch.layout!.w;

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let resized: { nodeId: string; width: number } | null = null;
		renderer.setManualWidthHandler((nodeId, width) => (resized = { nodeId, width }));
		renderer.mount(model);

		const handle = container.querySelector(`[data-node-id="${branch.id}"] .mm-resize-handle`)!;
		handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 140, clientY: 100, pointerId: 1 }));
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 140, clientY: 100, pointerId: 1 }));

		expect(resized).not.toBeNull();
		expect(resized!.nodeId).toBe(branch.id);
		expect(resized!.width).toBeCloseTo(startWidth + 40);

		renderer.destroy();
	});

	it("a resize-handle drag below the movement threshold does not report a width change", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let resized = false;
		renderer.setManualWidthHandler(() => (resized = true));
		renderer.mount(model);

		const handle = container.querySelector(`[data-node-id="${branch.id}"] .mm-resize-handle`)!;
		handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 101, clientY: 100, pointerId: 1 }));

		expect(resized).toBe(false);
		renderer.destroy();
	});

	it("a small pointer movement below the drag threshold does not trigger a manual move", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let moved = false;
		renderer.setManualMoveHandler(() => (moved = true));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		nodeG.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, altKey: true, clientX: 100, clientY: 100, pointerId: 1 }));
		const svg = container.querySelector(".mm-svg")!;
		svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, altKey: true, clientX: 101, clientY: 101, pointerId: 1 }));

		expect(moved).toBe(false);
		renderer.destroy();
	});

	it("a plain (non-Alt) drag that ends over no hit-testable target does not throw or call the reorder handler", () => {
		// jsdom has no real layout, so document.elementsFromPoint can't resolve
		// a drop target here — this only confirms the code path is safe when
		// hit-testing is unavailable; real drop behavior needs a manual check
		// in the dev vault (see CLAUDE.md).
		const model = parseMindMap(["# Root", "## Branch A", "## Branch B"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		let reordered = false;
		renderer.setReorderHandler(() => (reordered = true));
		renderer.mount(model);

		const nodeG = container.querySelector(`[data-node-id="${branch.id}"]`)!;
		expect(() => {
			nodeG.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }));
			const svg = container.querySelector(".mm-svg")!;
			svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 150, clientY: 150, pointerId: 1 }));
			svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 150, clientY: 150, pointerId: 1 }));
		}).not.toThrow();
		expect(reordered).toBe(false);

		renderer.destroy();
	});

	it("getNodeScreenRect is relative to the container, not the viewport (regression: inline editor landed in the wrong place when the container wasn't at the page origin)", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);
		const branch = model.root.children[0];

		const container = document.createElement("div");
		// Simulate the container sitting far from the page/viewport origin —
		// e.g. inside an Obsidian workspace pane that isn't flush with (0,0),
		// or any ancestor establishing its own containing block.
		container.getBoundingClientRect = () => ({ left: 300, top: 500, right: 1100, bottom: 1100, width: 800, height: 600, x: 300, y: 500, toJSON() {} });
		const renderer = new SvgRenderer(container);
		const svg = container.querySelector(".mm-svg") as SVGSVGElement;
		// The svg fills the container exactly, so it reports the same rect.
		svg.getBoundingClientRect = () => container.getBoundingClientRect();
		renderer.mount(model);

		const rect = renderer.getNodeScreenRect(branch.id)!;
		expect(rect).not.toBeNull();
		// Must NOT include the container's page offset (300, 500) — the
		// value is meant to be used with `position: absolute` inside the
		// container, not `position: fixed` against the viewport.
		expect(rect.left).toBeLessThan(300);
		expect(rect.top).toBeLessThan(500);

		renderer.destroy();
	});

	it("wheel with ctrlKey (trackpad pinch) zooms around the cursor instead of panning", async () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		const svg = container.querySelector(".mm-svg")!;
		const viewport = container.querySelector(".mm-viewport")!;

		svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 50, clientY: 50, bubbles: true, cancelable: true }));
		await new Promise((r) => requestAnimationFrame(r));

		// deltaY < 0 zooms in: scale grows from the initial 1.
		expect(viewport.getAttribute("transform")).toContain("scale(1.1");

		renderer.destroy();
	});

	it("wheel without ctrlKey (two-finger trackpad swipe) pans and never changes scale", async () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		computeLayout(model.root);

		const container = document.createElement("div");
		const renderer = new SvgRenderer(container);
		renderer.mount(model);
		const svg = container.querySelector(".mm-svg")!;
		const viewport = container.querySelector(".mm-viewport")!;
		const before = viewport.getAttribute("transform")!;

		svg.dispatchEvent(new WheelEvent("wheel", { deltaX: 30, deltaY: 40, ctrlKey: false, clientX: 50, clientY: 50, bubbles: true, cancelable: true }));
		await new Promise((r) => requestAnimationFrame(r));

		const after = viewport.getAttribute("transform")!;
		expect(after).not.toBe(before);
		expect(after).toContain("scale(1)"); // unchanged — panned, not zoomed
		// tx/ty shift by -deltaX/-deltaY: container defaults to 0-width in jsdom, so tx/ty start at 0.
		expect(after).toContain("translate(-30, -40)");

		renderer.destroy();
	});
});
