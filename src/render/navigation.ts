import { MindNode } from "../model/types";

export type Direction = "up" | "down" | "left" | "right";

/**
 * Arrow-key navigation (R4): nearest node in a screen direction, using
 * cached layout positions — no tree walk, just a scan over the already-
 * computed visible list.
 */
export function findNearestInDirection(nodes: MindNode[], from: MindNode, direction: Direction): MindNode | null {
	if (!from.layout) return null;
	const fx = from.layout.x + from.layout.w / 2;
	const fy = from.layout.y + from.layout.h / 2;

	let best: MindNode | null = null;
	let bestScore = Infinity;

	for (const node of nodes) {
		if (node === from || !node.layout) continue;
		const nx = node.layout.x + node.layout.w / 2;
		const ny = node.layout.y + node.layout.h / 2;
		const dx = nx - fx;
		const dy = ny - fy;

		let primary: number;
		let secondary: number;
		if (direction === "right") {
			if (dx <= 0) continue;
			primary = dx;
			secondary = Math.abs(dy);
		} else if (direction === "left") {
			if (dx >= 0) continue;
			primary = -dx;
			secondary = Math.abs(dy);
		} else if (direction === "down") {
			if (dy <= 0) continue;
			primary = dy;
			secondary = Math.abs(dx);
		} else {
			if (dy >= 0) continue;
			primary = -dy;
			secondary = Math.abs(dx);
		}

		// Weight off-axis distance more heavily so a roughly-straight move
		// wins over a diagonal one that happens to be slightly closer.
		const score = primary + secondary * 2;
		if (score < bestScore) {
			bestScore = score;
			best = node;
		}
	}

	return best;
}
