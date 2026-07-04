import { flextree } from "d3-flextree";
import { MindNode } from "../model/types";
import { wrapText, lineLength } from "../model/textWrap";

export type LayoutMode = "balanced" | "right-only" | "left-only";

export interface LayoutConfig {
	nodeHeight: number; // px, single-line row height
	siblingGap: number; // px, vertical gap between sibling rows
	levelGap: number; // px, horizontal gap between depth levels
	charWidth: number; // px, approx width per character (layout estimate, not measured text)
	minNodeWidth: number;
	maxNodeWidth: number; // default wrap width (~60 chars) before text moves to a new line; a node's own manualWidth overrides this
	lineHeight: number; // px added per extra wrapped line, on top of nodeHeight
	paddingX: number;
	mode: LayoutMode;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
	nodeHeight: 28,
	siblingGap: 10,
	levelGap: 60,
	charWidth: 7,
	minNodeWidth: 40,
	maxNodeWidth: 436, // ~60 characters/line at the default charWidth
	lineHeight: 16,
	paddingX: 16,
	mode: "balanced",
};

export interface NodeBox {
	w: number;
	h: number;
	lines: ReturnType<typeof wrapText>;
}

/**
 * Wraps `text` to fit within `manualWidth` (if the node's been drag-resized)
 * or the config default, and derives the box size from the wrapped lines:
 * width shrinks to the longest actual line (never wider than the wrap
 * ceiling), height grows by `lineHeight` per line beyond the first.
 */
export function computeNodeBox(text: string, cfg: LayoutConfig, manualWidth?: number): NodeBox {
	const maxWidthPx = manualWidth ?? cfg.maxNodeWidth;
	const maxCharsPerLine = Math.max(1, Math.floor((maxWidthPx - cfg.paddingX) / cfg.charWidth));
	const lines = wrapText(text, maxCharsPerLine);
	const longestChars = Math.max(1, ...lines.map(lineLength));
	const w = Math.min(maxWidthPx, Math.max(cfg.minNodeWidth, longestChars * cfg.charWidth + cfg.paddingX));
	const h = lines.length <= 1 ? cfg.nodeHeight : cfg.nodeHeight + (lines.length - 1) * cfg.lineHeight;
	return { w, h, lines };
}

export function estimateNodeWidth(text: string, cfg: LayoutConfig, manualWidth?: number): number {
	return computeNodeBox(text, cfg, manualWidth).w;
}

/**
 * Per-node box cache, keyed by node identity: flextree's internal
 * accessors call `nodeSize` several times per node per layout pass
 * (verified empirically, see DECISIONS.md's M5 entry on the same
 * gotcha for width estimation) — wrapping is real per-character work
 * (tokenize + greedy-pack), so recomputing it on every one of those
 * calls would multiply an already-non-trivial cost. Invalidated
 * whenever the node's own text or manualWidth actually changes;
 * otherwise reused across calls within *and* across layout passes.
 */
const boxCache = new WeakMap<MindNode, { text: string; manualWidth: number | undefined; box: NodeBox }>();

function nodeBoxFor(node: MindNode, cfg: LayoutConfig): NodeBox {
	const cached = boxCache.get(node);
	if (cached && cached.text === node.text && cached.manualWidth === node.manualWidth) return cached.box;
	const box = computeNodeBox(node.text, cfg, node.manualWidth);
	boxCache.set(node, { text: node.text, manualWidth: node.manualWidth, box });
	return box;
}

/** Splits by each branch's already-assigned `branchSide` (sticky — see `assignMissingSides`/DECISIONS.md), preserving document order within each side. */
function partitionChildren(children: MindNode[]): { left: MindNode[]; right: MindNode[] } {
	return {
		left: children.filter((c) => c.branchSide === "L"),
		right: children.filter((c) => c.branchSide !== "L"),
	};
}

/**
 * Lays out a pre-filtered (auto-only, i.e. no `manualPos`) list of siblings
 * by wrapping them under a zero-sized virtual root anchored at
 * (anchorX, anchorY), running flextree once, then writing absolute x/y
 * back onto each real node — mirrored (x negated relative to the anchor)
 * for the left side.
 *
 * Manually-positioned nodes (R12) are invisible to this flextree call
 * (the `children` accessor filters them out at every level, so they don't
 * consume layout space or get an auto position) — after the auto region
 * is positioned, any manually-positioned direct child found on one of
 * *those* nodes gets its own independent recursive sub-layout anchored at
 * its pin (`layoutManualNode`). The anchor node's own direct manual
 * children are the caller's responsibility (see `computeLayout` and
 * `layoutManualNode` for the two anchor cases: root, and a manual node).
 */
function layoutSide(autoChildren: MindNode[], cfg: LayoutConfig, side: "L" | "R", anchorX: number, anchorY: number, anchorDepthExtent: number): void {
	if (autoChildren.length === 0) return;

	const virtualRoot: MindNode = {
		id: "__virtual_root__",
		text: "",
		children: autoChildren,
		parent: null,
		depth: -1,
		folded: false,
		subtreeCount: 0,
	};

	const layoutFn = flextree<MindNode>({
		children: (node) => {
			if (node === virtualRoot) return node.children.length ? node.children : null;
			if (node.folded || node.children.length === 0) return null;
			// flextree's internal accessors get called multiple times per node
			// (verified empirically — see DECISIONS.md), so avoid allocating a
			// filtered array on every call in the common case (no manual
			// children at all): reuse the original array unless it's actually
			// needed.
			const hasManual = node.children.some((c) => c.manualPos);
			if (!hasManual) return node.children;
			const kids = node.children.filter((c) => !c.manualPos);
			return kids.length ? kids : null;
		},
		// The virtual root's breadth extent (first component) must be 0 so it
		// doesn't consume vertical space among the top-level children — but
		// its depth extent (second component) must match what the anchor node
		// itself contributes, or children collapse onto the anchor's own x
		// instead of being pushed out past its box.
		nodeSize: (n) => {
			if (n.data === virtualRoot) return [0, anchorDepthExtent];
			const box = nodeBoxFor(n.data, cfg);
			return [box.h + cfg.siblingGap, box.w + cfg.levelGap];
		},
	});

	const laidOut = layoutFn(layoutFn.hierarchy(virtualRoot));

	laidOut.each((n) => {
		if (n.data === virtualRoot) return;
		const node = n.data;
		const depthAxis = n.y;
		const box = nodeBoxFor(node, cfg);
		const w = box.w;
		// `depthAxis` is the box's *inner* edge (the one facing the anchor/
		// parent) on both sides — flextree derives it from ancestors' own
		// extents only, never this node's own width, so it stays put as
		// text changes length. A box always spans [x, x+w] in local rect
		// space regardless of side, so the outer edge is where growth must
		// go: on the right side that's naturally x+w (box already grows
		// rightward, away from the parent). On the left side the box must
		// grow leftward instead — achieved by anchoring the *right* edge at
		// the mirrored depthAxis and placing x that many pixels further
		// left, rather than negating depthAxis directly as `x` (which used
		// to leave the inner edge fixed and grow the box back toward the
		// parent instead of away from it).
		const x = side === "L" ? anchorX - depthAxis - w : anchorX + depthAxis;
		node.layout = { x, y: n.x + anchorY, w, h: box.h, side };
	});

	// Manually-positioned nodes nested anywhere within this auto-laid-out
	// region: found via each auto node's *raw* children list (the flextree
	// children accessor above already excluded them from positioning).
	laidOut.each((n) => {
		if (n.data === virtualRoot) return;
		const node = n.data;
		if (node.folded) return;
		for (const child of node.children) {
			if (child.manualPos) layoutManualNode(child, cfg, node.layout!.x);
		}
	});
}

/**
 * Positions a manually-pinned node at its stored coordinates (R12), then
 * recursively lays out its own subtree anchored there — auto children via
 * a fresh `layoutSide` call, further manual children via recursion. Side
 * (used only for edge-anchor direction, R11) is inferred from which side
 * of its parent the pin actually landed on, so the branch draws correctly
 * regardless of where the user dropped it.
 */
function layoutManualNode(node: MindNode, cfg: LayoutConfig, parentX: number): void {
	const pos = node.manualPos!;
	const side: "L" | "R" = pos.x < parentX ? "L" : "R";
	const box = nodeBoxFor(node, cfg);
	node.layout = { x: pos.x, y: pos.y, w: box.w, h: box.h, side };

	if (node.folded) return;
	const autoKids = node.children.filter((c) => !c.manualPos);
	layoutSide(autoKids, cfg, side, pos.x, pos.y, box.w + cfg.levelGap);
	for (const child of node.children) {
		if (child.manualPos) layoutManualNode(child, cfg, pos.x);
	}
}

/**
 * Tidy-tree layout via d3-flextree — O(n) per full pass over auto-managed
 * nodes (manually-positioned subtrees are O(their own size), computed
 * independently). Writes x/y/w/h/side onto each visible node's `layout`
 * field. Default mode balances first-level auto branches left/right of the
 * root by subtree weight (R11); `right-only`/`left-only` skip the split.
 *
 * Folded nodes' children are excluded entirely, so layout cost is
 * proportional to *visible* nodes (R13), not the full tree.
 */
export function computeLayout(root: MindNode, cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG): void {
	const rootBox = nodeBoxFor(root, cfg);
	root.layout = { x: 0, y: 0, w: rootBox.w, h: rootBox.h, side: "R" };
	if (root.folded) return;

	const rootDepthExtent = rootBox.w + cfg.levelGap;
	const autoChildren = root.children.filter((c) => !c.manualPos);

	if (cfg.mode === "right-only") {
		layoutSide(autoChildren, cfg, "R", 0, 0, rootDepthExtent);
	} else if (cfg.mode === "left-only") {
		layoutSide(autoChildren, cfg, "L", 0, 0, rootDepthExtent);
	} else {
		const { left, right } = partitionChildren(autoChildren);
		layoutSide(left, cfg, "L", 0, 0, rootDepthExtent);
		layoutSide(right, cfg, "R", 0, 0, rootDepthExtent);
	}

	for (const child of root.children) {
		if (child.manualPos) layoutManualNode(child, cfg, 0);
	}
}
