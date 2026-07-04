import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { computeLayout, DEFAULT_LAYOUT_CONFIG } from "../src/layout/layoutEngine";
import { collectVisibleNodes } from "../src/model/visibility";
import { findNearestInDirection } from "../src/render/navigation";

// right-only for most cases below: these tests are about direction-scan
// logic itself, not left/right balancing (covered in layout.test.ts), and
// balanced mode can put siblings on independently-centered sides, which
// would make a single global up/down/left/right ordering ambiguous.
const RIGHT_ONLY = { ...DEFAULT_LAYOUT_CONFIG, mode: "right-only" as const };

describe("findNearestInDirection", () => {
	it("moves right from root to the nearest first-level branch", () => {
		const md = ["# Root", "## Branch A", "## Branch B", "## Branch C"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, RIGHT_ONLY);
		const visible = collectVisibleNodes(model.root);

		const next = findNearestInDirection(visible, model.root, "right");
		expect(next).not.toBeNull();
		expect(next!.depth).toBe(1);
	});

	it("moves down/up between siblings ordered by their breadth-axis position", () => {
		const md = ["# Root", "## Branch A", "## Branch B", "## Branch C"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, RIGHT_ONLY);
		const visible = collectVisibleNodes(model.root);
		const [a, b, c] = model.root.children;
		const sortedByY = [a, b, c].slice().sort((x, y) => x.layout!.y - y.layout!.y);

		const down = findNearestInDirection(visible, sortedByY[0], "down");
		expect(down!.id).toBe(sortedByY[1].id);
		const up = findNearestInDirection(visible, sortedByY[1], "up");
		expect(up!.id).toBe(sortedByY[0].id);
	});

	it("returns null when there is nothing further in that direction", () => {
		const md = ["# Root", "## Branch A"].join("\n");
		const model = parseMindMap(md, "fallback");
		computeLayout(model.root, RIGHT_ONLY);
		const visible = collectVisibleNodes(model.root);
		const branch = model.root.children[0];
		expect(findNearestInDirection(visible, branch, "right")).toBeNull();
		expect(findNearestInDirection(visible, model.root, "left")).toBeNull();
	});

	it("excludes nodes hidden behind a folded ancestor", () => {
		const md = ["# Root", "## Branch A", "- a", "## Branch B"].join("\n");
		const model = parseMindMap(md, "fallback");
		model.root.children[0].folded = true;
		computeLayout(model.root, RIGHT_ONLY);
		const visible = collectVisibleNodes(model.root);
		expect(visible.some((n) => n.text === "a")).toBe(false);
	});
});
