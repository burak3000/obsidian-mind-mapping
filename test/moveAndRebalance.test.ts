import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { moveNode, rebalanceAll, setManualPosition } from "../src/model/mutations";
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

	it("is a no-op when moving a node under itself", () => {
		const model = makeModel();
		const a = model.root.children[0];
		moveNode(model, a.id, a.id);
		expect(a.parent).toBe(model.root);
	});

	it("is a no-op when moving a node under its own descendant (would create a cycle)", () => {
		const model = makeModel();
		const a = model.root.children[0];
		const a1 = a.children[0];
		moveNode(model, a.id, a1.id);
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

describe("rebalanceAll", () => {
	it("clears manual positions and branch sides on every node", () => {
		const model = makeModel();
		const a = model.root.children[0];
		const a1 = a.children[0];
		a.branchSide = "L";
		a1.manualPos = { x: 10, y: 10 };

		rebalanceAll(model);
		expect(a.branchSide).toBeUndefined();
		expect(a1.manualPos).toBeUndefined();
	});
});

describe("Controller manual position / move / rebalance", () => {
	it("setManualPosition is undoable, restoring 'no pin' if there wasn't one before", () => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		controller.setManualPosition(a.id, { x: 100, y: 200 });
		expect(a.manualPos).toEqual({ x: 100, y: 200 });
		controller.undo();
		expect(a.manualPos).toBeUndefined();
		controller.redo();
		expect(a.manualPos).toEqual({ x: 100, y: 200 });
	});

	it("setManualPosition undo restores the previous pin, not just clears it", () => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		controller.setManualPosition(a.id, { x: 1, y: 1 });
		controller.setManualPosition(a.id, { x: 2, y: 2 });
		controller.undo();
		expect(a.manualPos).toEqual({ x: 1, y: 1 });
	});

	it("setManualWidth is undoable, restoring 'no pin' if there wasn't one before", () => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		controller.setManualWidth(a.id, 250);
		expect(a.manualWidth).toBe(250);
		controller.undo();
		expect(a.manualWidth).toBeUndefined();
		controller.redo();
		expect(a.manualWidth).toBe(250);
	});

	it("setManualWidth undo restores the previous width, not just clears it", () => {
		const controller = new Controller(makeModel());
		const a = controller.model.root.children[0];
		controller.setManualWidth(a.id, 200);
		controller.setManualWidth(a.id, 300);
		controller.undo();
		expect(a.manualWidth).toBe(200);
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
