import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { moveNode, rebalanceAll } from "../src/model/mutations";
import { Controller } from "../src/controller/Controller";

function makeModel(md = "# Root\n## A\n- a1\n## B\n- b1\n") {
	return parseMindMap(md, "fallback");
}

describe("moveNode", () => {
	it("reparents a node, updating both old and new parent's subtreeCount", () => {
		const model = makeModel();
		const a = model.root.children[0];
		const b = model.root.children[1];
		const a1 = a.children[0];

		moveNode(model, a1.id, b.id);
		expect(a.children).toHaveLength(0);
		expect(b.children.map((n) => n.id)).toContain(a1.id);
		expect(a.subtreeCount).toBe(0);
		expect(b.subtreeCount).toBe(2); // b1, a1
		expect(a1.parent).toBe(b);
	});

	it("updates depth for the moved node and its descendants", () => {
		const model = makeModel(["# Root", "## A", "- a1", "  - a2", "## B"].join("\n"));
		const a = model.root.children[0];
		const b = model.root.children[1];
		const a1 = a.children[0];
		const a2 = a1.children[0];

		moveNode(model, a1.id, b.id);
		expect(a1.depth).toBe(2); // still one below its new parent B (depth 1)
		expect(a2.depth).toBe(3);
	});

	it.each([
		["itself", (a: { id: string }) => a.id],
		["its own descendant (would create a cycle)", (_a: { id: string }, a1: { id: string }) => a1.id],
	])("is a no-op when moving a node under %s", (_label, getTargetId) => {
		const model = makeModel();
		const a = model.root.children[0];
		const a1 = a.children[0];
		moveNode(model, a.id, getTargetId(a, a1));
		expect(a.parent).toBe(model.root);
		expect(a1.parent).toBe(a);
	});

	it("inserts at a specific index when given one", () => {
		const model = makeModel(["# Root", "## A", "- a1", "- a2", "- a3"].join("\n"));
		const a = model.root.children[0];
		const [a1, a2, a3] = a.children;
		moveNode(model, a3.id, a.id, 0);
		expect(a.children.map((n) => n.id)).toEqual([a3.id, a1.id, a2.id]);
	});
});

it("rebalanceAll clears manual positions and branch sides on every node", () => {
	const model = makeModel();
	const a = model.root.children[0];
	const a1 = a.children[0];
	a.branchSide = "L";
	a1.manualPos = { x: 10, y: 10 };

	rebalanceAll(model);
	expect(a.branchSide).toBeUndefined();
	expect(a1.manualPos).toBeUndefined();
});

describe("Controller manual position / move / rebalance", () => {
	it.each([
		["setManualPosition", "manualPos", { x: 100, y: 200 }],
		["setManualWidth", "manualWidth", 250],
	] as const)("%s is undoable, restoring 'no pin' if there wasn't one before", (method, prop, value) => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		(controller[method] as (id: string, v: unknown) => void).call(controller, a.id, value);
		expect(a[prop]).toEqual(value);
		controller.undo();
		expect(a[prop]).toBeUndefined();
		controller.redo();
		expect(a[prop]).toEqual(value);
	});

	it.each([
		["setManualPosition", "manualPos", { x: 1, y: 1 }, { x: 2, y: 2 }],
		["setManualWidth", "manualWidth", 200, 300],
	] as const)("%s undo restores the previous value, not just clears it", (method, prop, first, second) => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		const call = (id: string, v: unknown) => (controller[method] as (id: string, v: unknown) => void).call(controller, id, v);
		call(a.id, first);
		call(a.id, second);
		controller.undo();
		expect(a[prop]).toEqual(first);
	});

	it("moveNode is undoable back to the exact original index", () => {
		const controller = new Controller(makeModel(["# Root", "## A", "- a1", "- a2", "## B"].join("\n")));
		const a = controller.model.root.children[0];
		const b = controller.model.root.children[1];
		const a2 = a.children[1];

		controller.moveNode(a2.id, b.id);
		expect(a2.parent).toBe(b);

		controller.undo();
		expect(a2.parent).toBe(a);
		expect(a.children.map((n) => n.id)).toEqual([a.children[0].id, a2.id]);
	});

	describe("same-level reorder (before/after)", () => {
		it.each([
			["before an earlier sibling", 2, 0, "before", [2, 0, 1]],
			["after a later sibling", 0, 1, "after", [1, 0, 2]],
			["after an earlier sibling", 2, 0, "after", [0, 2, 1]],
		] as const)("moves a node %s within the same parent", (_label, fromIdx, toIdx, position, order) => {
			const controller = new Controller(makeModel(["# Root", "## A", "- a1", "- a2", "- a3"].join("\n")));
			const a = controller.model.root.children[0];
			const ids = a.children.map((n) => n.id);

			controller.moveNode(ids[fromIdx], ids[toIdx], position);
			expect(a.children.map((n) => n.id)).toEqual(order.map((i) => ids[i]));
		});

		it("reorders across different parents by dropping before/after a node in another branch", () => {
			const controller = new Controller(makeModel(["# Root", "## A", "- a1", "## B", "- b1", "- b2"].join("\n")));
			const a = controller.model.root.children[0];
			const b = controller.model.root.children[1];
			const a1 = a.children[0];
			const [b1, b2] = b.children;

			controller.moveNode(a1.id, b1.id, "before");
			expect(a.children).toHaveLength(0);
			expect(b.children.map((n) => n.id)).toEqual([a1.id, b1.id, b2.id]);
			expect(a1.parent).toBe(b);
		});

		it("is undoable back to the exact original index", () => {
			const controller = new Controller(makeModel(["# Root", "## A", "- a1", "- a2", "- a3"].join("\n")));
			const a = controller.model.root.children[0];
			const [a1, a2, a3] = a.children;

			controller.moveNode(a3.id, a1.id, "before");
			controller.undo();
			expect(a.children.map((n) => n.id)).toEqual([a1.id, a2.id, a3.id]);
		});

		it("falls back to nesting as a child when the target is the root (no parent to become a sibling of)", () => {
			const controller = new Controller(makeModel(["# Root", "## A", "- a1", "## B"].join("\n")));
			const a = controller.model.root.children[0];
			const a1 = a.children[0];
			const root = controller.model.root;

			controller.moveNode(a1.id, root.id, "before");
			expect(a1.parent).toBe(root);
		});
	});

	it("rebalance clears pins/sides and is undoable", () => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		const a1 = a.children[0];
		a.branchSide = "R";
		a1.manualPos = { x: 5, y: 5 };

		controller.rebalance();
		expect(a.branchSide).toBeUndefined();
		expect(a1.manualPos).toBeUndefined();

		controller.undo();
		expect(a.branchSide).toBe("R");
		expect(a1.manualPos).toEqual({ x: 5, y: 5 });
	});
});
