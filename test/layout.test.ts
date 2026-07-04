import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { computeLayout, computeNodeBox, estimateNodeWidth, DEFAULT_LAYOUT_CONFIG } from "../src/layout/layoutEngine";
import { assignMissingSides } from "../src/layout/sides";

describe("estimateNodeWidth", () => {
	it("clamps to the configured min/max width", () => {
		expect(estimateNodeWidth("", DEFAULT_LAYOUT_CONFIG)).toBe(DEFAULT_LAYOUT_CONFIG.minNodeWidth);
		expect(estimateNodeWidth("x".repeat(200), DEFAULT_LAYOUT_CONFIG)).toBe(DEFAULT_LAYOUT_CONFIG.maxNodeWidth);
	});
});

describe("computeNodeBox (long-text wrapping)", () => {
	it("keeps a short text on one line at the default single-row height", () => {
		const box = computeNodeBox("short title", DEFAULT_LAYOUT_CONFIG);
		expect(box.lines.length).toBe(1);
		expect(box.h).toBe(DEFAULT_LAYOUT_CONFIG.nodeHeight);
	});

	it("wraps text past the default ~60-char width onto additional lines and grows height accordingly", () => {
		const longText = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const box = computeNodeBox(longText, DEFAULT_LAYOUT_CONFIG);
		expect(box.lines.length).toBeGreaterThan(1);
		expect(box.h).toBe(DEFAULT_LAYOUT_CONFIG.nodeHeight + (box.lines.length - 1) * DEFAULT_LAYOUT_CONFIG.lineHeight);
		expect(box.w).toBeLessThanOrEqual(DEFAULT_LAYOUT_CONFIG.maxNodeWidth);
	});

	it("uses manualWidth as the wrap ceiling instead of the config default when set", () => {
		const longText = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const narrow = computeNodeBox(longText, DEFAULT_LAYOUT_CONFIG, 120);
		const wide = computeNodeBox(longText, DEFAULT_LAYOUT_CONFIG, 800);
		expect(narrow.w).toBeLessThanOrEqual(120);
		expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
	});
});

describe("computeLayout with wrapped nodes", () => {
	it("gives a wrapped (multi-line) node a taller layout box than a single-line sibling", () => {
		const longText = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const md = ["# Root", `## ${longText}`, "## short"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		const [wrapped, short] = model.root.children;
		expect(wrapped.layout!.h).toBeGreaterThan(short.layout!.h);
		expect(short.layout!.h).toBe(DEFAULT_LAYOUT_CONFIG.nodeHeight);
	});

	it("respects a node's manualWidth as its wrap ceiling instead of the config default", () => {
		// Fits on one line at the default ~60-char width, but a much
		// narrower manual width should force it to wrap.
		const text = "one two three four five six";
		const md = ["# Root", `## ${text}`].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		expect(model.root.children[0].layout!.h).toBe(DEFAULT_LAYOUT_CONFIG.nodeHeight); // single line by default

		model.root.children[0].manualWidth = 100;
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" });
		expect(model.root.children[0].layout!.w).toBeLessThanOrEqual(100);
		expect(model.root.children[0].layout!.h).toBeGreaterThan(DEFAULT_LAYOUT_CONFIG.nodeHeight); // now wraps
	});
});

describe("computeLayout (right-only)", () => {
	const cfg = { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" as const };

	it("places the root at depth-axis 0 and children strictly increasing in depth-axis x", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, cfg);

		expect(model.root.layout?.x).toBe(0);
		const branch = model.root.children[0];
		const a = branch.children[0];
		const a1 = a.children[0];
		expect(branch.layout!.x).toBeGreaterThan(model.root.layout!.x);
		expect(a.layout!.x).toBeGreaterThan(branch.layout!.x);
		expect(a1.layout!.x).toBeGreaterThan(a.layout!.x);
		expect(branch.layout!.side).toBe("R");
	});

	it("excludes folded subtrees from layout entirely (no stale/undefined layout leaks visibility)", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1", "## Branch B", "- b"].join("\n");
		const model = parseMindMap(md, "fallback");
		const branchA = model.root.children[0];
		branchA.folded = true;
		computeLayout(model.root, cfg);

		expect(model.root.layout).toBeDefined();
		expect(branchA.layout).toBeDefined(); // the folded node itself is still visible
		expect(branchA.children[0].layout).toBeUndefined(); // its children are not
	});

	it("gives siblings distinct y (breadth-axis) positions", () => {
		const md = ["# Root", "## Branch A", "## Branch B", "## Branch C"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, cfg);
		const ys = model.root.children.map((n) => n.layout!.y);
		expect(new Set(ys).size).toBe(3);
	});
});

describe("computeLayout (left-only)", () => {
	it("mirrors children to negative depth-axis x", () => {
		const md = ["# Root", "## Branch A", "- a"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, { ...DEFAULT_LAYOUT_CONFIG, mode: "left-only" });
		const branch = model.root.children[0];
		expect(branch.layout!.x).toBeLessThan(0);
		expect(branch.layout!.side).toBe("L");
		expect(branch.children[0].layout!.x).toBeLessThan(branch.layout!.x);
	});

	it("grows a long-text box further left (outer edge), keeping its inner edge next to the parent fixed", () => {
		// Regression: the box's edge nearest the parent (the one the
		// connector anchors to) must stay put as text length changes — only
		// the far/outer edge should move. A left-side node's box spans
		// [x, x+w], so the inner (right) edge is x+w; growing the box must
		// decrease x, not increase it.
		const shortMd = ["# Root", "## a"].join("\n");
		const longMd = ["# Root", "## " + "a".repeat(100)].join("\n");
		const cfg = { ...DEFAULT_LAYOUT_CONFIG, mode: "left-only" as const };

		const shortModel = parseMindMap(shortMd, "fallback");
		computeLayout(shortModel.root, cfg);
		const shortBranch = shortModel.root.children[0];

		const longModel = parseMindMap(longMd, "fallback");
		computeLayout(longModel.root, cfg);
		const longBranch = longModel.root.children[0];

		// Inner edge (closest to root) unchanged regardless of text length.
		expect(longBranch.layout!.x + longBranch.layout!.w).toBeCloseTo(shortBranch.layout!.x + shortBranch.layout!.w);
		// Outer edge moved further left/away from the root as text grew.
		expect(longBranch.layout!.x).toBeLessThan(shortBranch.layout!.x);
	});
});

describe("computeLayout (balanced, the default)", () => {
	it("splits first-level branches across both sides of the root", () => {
		const md = ["# Root", "## A", "## B", "## C", "## D"].join("\n");
		const model = parseMindMap(md, "fallback");
		assignMissingSides(model.root);
		computeLayout(model.root);
		const sides = new Set(model.root.children.map((c) => c.layout!.side));
		expect(sides.has("L")).toBe(true);
		expect(sides.has("R")).toBe(true);
	});

	it("keeps every node in a subtree consistent with its branch's side", () => {
		const md = ["# Root", "## A", "- a1", "  - a2", "## B", "- b1"].join("\n");
		const model = parseMindMap(md, "fallback");
		assignMissingSides(model.root);
		computeLayout(model.root);
		for (const branch of model.root.children) {
			const side = branch.layout!.side;
			const walk = (n: typeof branch) => {
				expect(n.layout!.side).toBe(side);
				n.children.forEach(walk);
			};
			walk(branch);
		}
	});

	it("balances heavier subtrees against lighter ones rather than just alternating", () => {
		// A is much heavier than B, C, D combined; a good balance should not
		// put A alone against all three others without regard to weight.
		const md = [
			"# Root",
			"## A",
			"- a1",
			"  - a2",
			"  - a3",
			"  - a4",
			"## B",
			"## C",
			"## D",
		].join("\n");
		const model = parseMindMap(md, "fallback");
		assignMissingSides(model.root);
		computeLayout(model.root);
		const [a, b, c, d] = model.root.children;
		const leftWeight = [a, b, c, d].filter((n) => n.layout!.side === "L").reduce((sum, n) => sum + 1 + n.subtreeCount, 0);
		const rightWeight = [a, b, c, d].filter((n) => n.layout!.side === "R").reduce((sum, n) => sum + 1 + n.subtreeCount, 0);
		expect(Math.abs(leftWeight - rightWeight)).toBeLessThanOrEqual(Math.max(a.subtreeCount, 1));
	});

	it("root always resolves to depth-axis 0 regardless of side split", () => {
		const md = ["# Root", "## A", "## B"].join("\n");
		const model = parseMindMap(md, "fallback");
		assignMissingSides(model.root);
		computeLayout(model.root);
		expect(model.root.layout!.x).toBe(0);
		expect(model.root.layout!.y).toBe(0);
	});
});
