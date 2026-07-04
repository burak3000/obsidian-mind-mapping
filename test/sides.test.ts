import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { assignMissingSides, clearAllSides } from "../src/layout/sides";

describe("assignMissingSides", () => {
	it("gives every first-level branch a side", () => {
		const model = parseMindMap(["# Root", "## A", "## B", "## C"].join("\n"), "fallback");
		assignMissingSides(model.root);
		expect(model.root.children.every((c) => c.branchSide === "L" || c.branchSide === "R")).toBe(true);
	});

	it("never reassigns an existing branchSide", () => {
		const model = parseMindMap(["# Root", "## A", "## B"].join("\n"), "fallback");
		model.root.children[0].branchSide = "R";
		assignMissingSides(model.root);
		expect(model.root.children[0].branchSide).toBe("R");
	});

	it("does not move existing branches when a new one is added (the sticky-sides fix)", () => {
		const model = parseMindMap(["# Root", "## A", "## B"].join("\n"), "fallback");
		assignMissingSides(model.root);
		const aSide = model.root.children[0].branchSide;
		const bSide = model.root.children[1].branchSide;

		model.root.children.push({
			id: "new",
			text: "C",
			children: [],
			parent: model.root,
			depth: 1,
			folded: false,
			subtreeCount: 0,
		});
		assignMissingSides(model.root);

		expect(model.root.children[0].branchSide).toBe(aSide);
		expect(model.root.children[1].branchSide).toBe(bSide);
		expect(model.root.children[2].branchSide).toBeDefined();
	});

	it("balances weight across already-pinned sides when assigning a new branch", () => {
		const model = parseMindMap(["# Root", "## Heavy", "- h1", "  - h2", "  - h3", "## Light"].join("\n"), "fallback");
		model.root.children[0].branchSide = "L"; // Heavy (weight 3) pinned left
		model.root.children[1].branchSide = "R"; // Light (weight 0) pinned right
		model.root.children.push({
			id: "new",
			text: "New",
			children: [],
			parent: model.root,
			depth: 1,
			folded: false,
			subtreeCount: 0,
		});
		assignMissingSides(model.root);
		// Left already carries much more weight, so the new branch should join the lighter (right) side.
		expect(model.root.children[2].branchSide).toBe("R");
	});
});

describe("clearAllSides", () => {
	it("removes branchSide from every first-level branch so it can be recomputed", () => {
		const model = parseMindMap(["# Root", "## A", "## B"].join("\n"), "fallback");
		assignMissingSides(model.root);
		clearAllSides(model.root);
		expect(model.root.children.every((c) => c.branchSide === undefined)).toBe(true);
	});
});
