import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { Controller } from "../src/controller/Controller";

function makeController(md = "# Root\n## Branch A\n- a\n## Branch B\n") {
	const model = parseMindMap(md, "fallback");
	return new Controller(model);
}

describe("Controller", () => {
	it("Tab creates a child of the selected node, selects it, and requests an edit", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		controller.select(branchA.id);

		let editRequested: string | null = null;
		controller.addListener({ onChange() {}, onEditRequest: (id) => (editRequested = id) });

		controller.addChildToSelected();

		expect(branchA.children.length).toBe(2); // "a" plus the new child
		const created = branchA.children[1];
		expect(controller.selectedId).toBe(created.id);
		expect(editRequested).toBe(created.id);
	});

	it("Tab with nothing selected adds a child of the root", () => {
		const controller = makeController();
		controller.addChildToSelected();
		expect(controller.model.root.children.length).toBe(3);
	});

	it("Enter adds a sibling after the selected node; Shift+Enter adds one before", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		controller.select(branchA.id);

		controller.addSiblingToSelected("after");
		expect(controller.model.root.children.map((n) => n.id)).toEqual([branchA.id, controller.selectedId, controller.model.root.children[2].id]);

		const afterId = controller.selectedId;
		controller.select(branchA.id);
		controller.addSiblingToSelected("before");
		const ids = controller.model.root.children.map((n) => n.id);
		expect(ids.indexOf(controller.selectedId!)).toBe(0);
		expect(ids.indexOf(branchA.id)).toBe(1);
		expect(ids.indexOf(afterId!)).toBe(2);
	});

	it("addSiblingToSelected is a no-op on the root (no siblings)", () => {
		const controller = makeController();
		controller.select(controller.model.root.id);
		const before = controller.model.root.subtreeCount;
		controller.addSiblingToSelected("after");
		expect(controller.model.root.subtreeCount).toBe(before);
	});

	it("commitRename changes text and is undoable/redoable", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		controller.commitRename(branchA.id, "Renamed");
		expect(branchA.text).toBe("Renamed");

		controller.undo();
		expect(branchA.text).toBe("Branch A");

		controller.redo();
		expect(branchA.text).toBe("Renamed");
	});

	it("deleteSelected removes the node+subtree, selects the parent, and is undoable", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const childA = branchA.children[0];
		controller.select(childA.id);

		controller.deleteSelected();
		expect(branchA.children.length).toBe(0);
		expect(controller.model.byId.has(childA.id)).toBe(false);
		expect(controller.selectedId).toBe(branchA.id);

		controller.undo();
		expect(branchA.children.length).toBe(1);
		expect(branchA.children[0]).toBe(childA);
		expect(controller.model.byId.get(childA.id)).toBe(childA);
	});

	it("deleteSelected cannot delete the root", () => {
		const controller = makeController();
		controller.select(controller.model.root.id);
		controller.deleteSelected();
		expect(controller.model.byId.has(controller.model.root.id)).toBe(true);
	});

	it("delete + undo restores correct subtreeCount along the ancestor chain", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const childA = branchA.children[0];
		const rootCountBefore = controller.model.root.subtreeCount;

		controller.select(childA.id);
		controller.deleteSelected();
		expect(controller.model.root.subtreeCount).toBe(rootCountBefore - 1);

		controller.undo();
		expect(controller.model.root.subtreeCount).toBe(rootCountBefore);
		expect(branchA.subtreeCount).toBe(1);
	});

	it("toggleFold flips folded state and is undoable/redoable", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		expect(branchA.folded).toBe(false);

		controller.toggleFold(branchA.id);
		expect(branchA.folded).toBe(true);

		controller.undo();
		expect(branchA.folded).toBe(false);

		controller.redo();
		expect(branchA.folded).toBe(true);
	});

	it("toggleFold is a no-op on a childless node", () => {
		const controller = makeController();
		const leaf = controller.model.root.children[0].children[0]; // "a", childless
		controller.toggleFold(leaf.id);
		expect(leaf.folded).toBe(false);
	});
});
