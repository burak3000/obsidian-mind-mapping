import { MindMapModel, MindNode } from "../model/types";
import {
	addChild,
	addSibling,
	deleteNode,
	renameNode,
	restoreNode,
	setFolded,
	setManualPosition,
	clearManualPosition,
	setManualWidth,
	clearManualWidth,
	moveNode,
	rebalanceAll,
	RemovedNodeRecord,
} from "../model/mutations";
import { CommandStack } from "../model/commandStack";

export interface ControllerListener {
	/** Model and/or selection changed — relayout, re-render, schedule debounced save. */
	onChange(): void;
	/** A node was just created (or F2/dblclick fired) and should open the inline editor. */
	onEditRequest(nodeId: string): void;
}

/**
 * Mediates all model mutations through the undo/redo command stack and
 * fans out change notifications. Keyboard handlers (View) stay thin:
 * translate a keypress into one Controller call.
 */
export class Controller {
	private readonly stack = new CommandStack(100);
	private listeners: ControllerListener[] = [];
	selectedId: string | null = null;

	constructor(public model: MindMapModel) {}

	addListener(listener: ControllerListener): void {
		this.listeners.push(listener);
	}

	removeListener(listener: ControllerListener): void {
		this.listeners = this.listeners.filter((l) => l !== listener);
	}

	private emitChange(): void {
		for (const l of this.listeners) l.onChange();
	}

	private emitEditRequest(nodeId: string): void {
		for (const l of this.listeners) l.onEditRequest(nodeId);
	}

	select(id: string | null): void {
		if (this.selectedId === id) return;
		this.selectedId = id;
		this.emitChange();
	}

	/** Tab (R2): new child of the selected node (or root if nothing selected), immediately editable. */
	addChildToSelected(): void {
		const parentId = this.selectedId ?? this.model.root.id;
		let createdId = "";
		this.stack.execute({
			do: () => {
				createdId = addChild(this.model, parentId, "").id;
			},
			undo: () => {
				if (createdId) deleteNode(this.model, createdId);
			},
		});
		this.selectedId = createdId;
		this.emitChange();
		this.emitEditRequest(createdId);
	}

	/** Enter / Shift+Enter (R3/R4): new sibling after/before the selected node. No-op on the root (it has no siblings). */
	addSiblingToSelected(position: "before" | "after"): void {
		if (!this.selectedId) return;
		const node = this.model.byId.get(this.selectedId);
		if (!node || !node.parent) return;
		const anchorId = this.selectedId;
		let createdId = "";
		this.stack.execute({
			do: () => {
				createdId = addSibling(this.model, anchorId, "", position).id;
			},
			undo: () => {
				if (createdId) deleteNode(this.model, createdId);
			},
		});
		this.selectedId = createdId;
		this.emitChange();
		this.emitEditRequest(createdId);
	}

	requestEdit(nodeId: string): void {
		this.emitEditRequest(nodeId);
	}

	/** Commit text from the inline editor (blur / Esc / Enter-while-editing). */
	commitRename(nodeId: string, text: string): void {
		const node = this.model.byId.get(nodeId);
		if (!node) return;
		const before = node.text;
		if (before === text) return;
		this.stack.execute({
			do: () => renameNode(this.model, nodeId, text),
			undo: () => renameNode(this.model, nodeId, before),
		});
		this.emitChange();
	}

	/** Delete/Backspace (R4): remove the selected node + subtree, select its parent. No-op on the root. */
	deleteSelected(): void {
		if (!this.selectedId) return;
		const node = this.model.byId.get(this.selectedId);
		if (!node || !node.parent) return;
		const nodeId = this.selectedId;
		const parentId = node.parent.id;
		let record: RemovedNodeRecord | null = null;
		this.stack.execute({
			do: () => {
				record = deleteNode(this.model, nodeId);
			},
			undo: () => {
				if (record) restoreNode(this.model, record);
			},
		});
		this.selectedId = parentId;
		this.emitChange();
	}

	/** Ctrl/Cmd+/ (R13): fold/unfold — wired up starting M4, but the primitive lives here since it's a plain mutation. */
	toggleFold(nodeId: string): void {
		const node = this.model.byId.get(nodeId);
		if (!node || node.children.length === 0) return;
		const before = node.folded;
		this.stack.execute({
			do: () => setFolded(this.model, nodeId, !before),
			undo: () => setFolded(this.model, nodeId, before),
		});
		this.emitChange();
	}

	/** Alt+drag (R12): pins a node to an absolute position, excluding it from auto-balance. */
	setManualPosition(nodeId: string, pos: { x: number; y: number }): void {
		const node = this.model.byId.get(nodeId);
		if (!node) return;
		const before = node.manualPos;
		this.stack.execute({
			do: () => setManualPosition(this.model, nodeId, pos),
			undo: () => {
				if (before) setManualPosition(this.model, nodeId, before);
				else clearManualPosition(this.model, nodeId);
			},
		});
		this.emitChange();
	}

	/** Drag-resize: pins a node's wrap width, overriding the default character-count wrap width. */
	setManualWidth(nodeId: string, width: number): void {
		const node = this.model.byId.get(nodeId);
		if (!node) return;
		const before = node.manualWidth;
		this.stack.execute({
			do: () => setManualWidth(this.model, nodeId, width),
			undo: () => {
				if (before !== undefined) setManualWidth(this.model, nodeId, before);
				else clearManualWidth(this.model, nodeId);
			},
		});
		this.emitChange();
	}

	/** Plain drag (R4 drag-reorder): reparents a node as the last child of `newParentId`. Silently no-ops on an invalid target (self/descendant) — see mutations.moveNode. */
	moveNode(nodeId: string, newParentId: string): void {
		const node = this.model.byId.get(nodeId);
		if (!node || !node.parent) return;
		const oldParentId = node.parent.id;
		const oldIndex = node.parent.children.indexOf(node);
		this.stack.execute({
			do: () => moveNode(this.model, nodeId, newParentId),
			undo: () => moveNode(this.model, nodeId, oldParentId, oldIndex),
		});
		this.emitChange();
	}

	/** "Rebalance" command (plan §9.3): clears every manual-position pin and sticky side assignment, undoably. */
	rebalance(): void {
		interface Snapshot {
			manualPos?: { x: number; y: number };
			branchSide?: "L" | "R";
		}
		const before = new Map<string, Snapshot>();
		const snapshot = (node: MindNode) => {
			before.set(node.id, { manualPos: node.manualPos, branchSide: node.branchSide });
			node.children.forEach(snapshot);
		};
		snapshot(this.model.root);

		this.stack.execute({
			do: () => rebalanceAll(this.model),
			undo: () => {
				const restore = (node: MindNode) => {
					const snap = before.get(node.id);
					if (snap) {
						node.manualPos = snap.manualPos;
						node.branchSide = snap.branchSide;
					}
					node.children.forEach(restore);
				};
				restore(this.model.root);
				this.model.version += 1;
			},
		});
		this.emitChange();
	}

	undo(): void {
		if (this.stack.undo()) this.emitChange();
	}

	redo(): void {
		if (this.stack.redo()) this.emitChange();
	}

	canUndo(): boolean {
		return this.stack.canUndo();
	}

	canRedo(): boolean {
		return this.stack.canRedo();
	}
}
