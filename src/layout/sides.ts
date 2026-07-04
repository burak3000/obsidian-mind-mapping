import { MindNode } from "../model/types";

/**
 * Assigns a stable side to any first-level branch that doesn't have one yet,
 * balancing against the weight already committed to each side — but never
 * reassigns a branch that's already pinned (R11, "sticky sides").
 *
 * This is the balanced-layout analogue of `assignMissingColors`: without
 * it, every edit anywhere in the tree would trigger a from-scratch global
 * rebalance, touching nearly every node's position on every keystroke-
 * adjacent edit (measured: one Tab on a 5,000-node map moved 4,999 of them
 * and flipped 2 of 10 branches to the other side — see DECISIONS.md).
 */
export function assignMissingSides(root: MindNode): void {
	let leftWeight = 0;
	let rightWeight = 0;
	for (const child of root.children) {
		const weight = 1 + child.subtreeCount;
		if (child.branchSide === "L") leftWeight += weight;
		else if (child.branchSide === "R") rightWeight += weight;
	}
	for (const child of root.children) {
		if (child.branchSide) continue;
		const weight = 1 + child.subtreeCount;
		if (leftWeight <= rightWeight) {
			child.branchSide = "L";
			leftWeight += weight;
		} else {
			child.branchSide = "R";
			rightWeight += weight;
		}
	}
}

/** Clears all side pins so the next layout recomputes a fresh, currently-optimal balance. The user-facing "Rebalance" command wires this up in M5. */
export function clearAllSides(root: MindNode): void {
	for (const child of root.children) child.branchSide = undefined;
}
