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

	it("revealAndSelect unfolds every folded ancestor of a hidden node and selects it", () => {
		const controller = makeController(["# Root", "## Branch A", "- a1", "  - a2"].join("\n"));
		const branchA = controller.model.root.children[0];
		const a1 = branchA.children[0];
		const a2 = a1.children[0];
		branchA.folded = true;
		a1.folded = true;

		controller.revealAndSelect(a2.id);

		expect(branchA.folded).toBe(false);
		expect(a1.folded).toBe(false);
		expect(controller.selectedId).toBe(a2.id);
	});

	it("revealAndSelect is a no-op unfold (just selects) when the node is already visible", () => {
		const controller = makeController();
		const leaf = controller.model.root.children[0].children[0];
		controller.revealAndSelect(leaf.id);
		expect(controller.selectedId).toBe(leaf.id);
	});

	it("revealAndSelect's unfold is a single undo step that restores every unfolded ancestor together", () => {
		const controller = makeController(["# Root", "## Branch A", "- a1", "  - a2"].join("\n"));
		const branchA = controller.model.root.children[0];
		const a1 = branchA.children[0];
		const a2 = a1.children[0];
		branchA.folded = true;
		a1.folded = true;

		controller.revealAndSelect(a2.id);
		controller.undo();

		expect(branchA.folded).toBe(true);
		expect(a1.folded).toBe(true);
	});

	it("revealAndSelect does nothing for an unknown node id", () => {
		const controller = makeController();
		controller.select(controller.model.root.id);
		controller.revealAndSelect("does-not-exist");
		expect(controller.selectedId).toBe(controller.model.root.id);
	});

	it("copy then paste inserts a cloned subtree (new ids) as the last child of the selected target, leaving the original in place", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const branchB = controller.model.root.children[1];
		controller.select(branchA.id);

		controller.copySelected();
		expect(branchA.children.length).toBe(1); // copy doesn't touch the model

		controller.select(branchB.id);
		controller.pasteToSelected();

		expect(branchB.children.length).toBe(1);
		const pasted = branchB.children[0];
		expect(pasted.text).toBe(branchA.text);
		expect(pasted.id).not.toBe(branchA.id);
		expect(pasted.children.map((c) => c.text)).toEqual(branchA.children.map((c) => c.text));
		expect(pasted.children[0].id).not.toBe(branchA.children[0].id);
		expect(controller.selectedId).toBe(pasted.id);
		// original untouched
		expect(controller.model.byId.has(branchA.id)).toBe(true);
		expect(branchA.parent).toBe(controller.model.root);
	});

	it("paste can be repeated, cloning fresh ids each time", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const branchB = controller.model.root.children[1];
		controller.select(branchA.id);
		controller.copySelected();

		controller.select(branchB.id);
		controller.pasteToSelected();
		const first = controller.selectedId;
		controller.select(branchB.id);
		controller.pasteToSelected();
		const second = controller.selectedId;

		expect(first).not.toBe(second);
		expect(branchB.children.length).toBe(2);
	});

	it("cut removes the node+subtree (undoably, like delete) and pasting elsewhere re-inserts a clone", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const childA = branchA.children[0];
		const branchB = controller.model.root.children[1];
		controller.select(childA.id);

		controller.cutSelected();
		expect(branchA.children.length).toBe(0);
		expect(controller.model.byId.has(childA.id)).toBe(false);
		expect(controller.selectedId).toBe(branchA.id);

		controller.select(branchB.id);
		controller.pasteToSelected();

		expect(branchB.children.length).toBe(1);
		expect(branchB.children[0].text).toBe(childA.text);
		expect(branchB.children[0].id).not.toBe(childA.id);
	});

	it("cut is undoable independently of paste", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const childA = branchA.children[0];
		controller.select(childA.id);

		controller.cutSelected();
		expect(branchA.children.length).toBe(0);

		controller.undo();
		expect(branchA.children.length).toBe(1);
		expect(branchA.children[0]).toBe(childA);
	});

	it("cutSelected cannot cut the root", () => {
		const controller = makeController();
		controller.select(controller.model.root.id);
		controller.cutSelected();
		expect(controller.model.byId.has(controller.model.root.id)).toBe(true);
	});

	it("pasteToSelected with nothing selected pastes as a child of the root", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		controller.select(branchA.id);
		controller.copySelected();

		controller.select(null);
		controller.pasteToSelected();

		const pasted = controller.model.root.children[controller.model.root.children.length - 1];
		expect(pasted.text).toBe(branchA.text);
	});

	it("pasteToSelected is a no-op when the clipboard is empty", () => {
		const controller = makeController();
		const before = controller.model.root.subtreeCount;
		controller.pasteToSelected();
		expect(controller.model.root.subtreeCount).toBe(before);
	});

	it("paste is undoable", () => {
		const controller = makeController();
		const branchA = controller.model.root.children[0];
		const branchB = controller.model.root.children[1];
		controller.select(branchA.id);
		controller.copySelected();
		controller.select(branchB.id);
		controller.pasteToSelected();
		expect(branchB.children.length).toBe(1);

		controller.undo();
		expect(branchB.children.length).toBe(0);
	});
});
