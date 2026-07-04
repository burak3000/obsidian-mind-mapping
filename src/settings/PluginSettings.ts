import { LayoutMode } from "../layout/layoutEngine";

export interface MindMapSettings {
	/** Delay after the last mutation before writing to disk (plan §7.3 default: 400ms). */
	writeDebounceMs: number;
	/** Above this many visible nodes, position-change animations (fold/unfold, etc.) are skipped (addendum §8 item 2; asked the user in M4 — default 500). */
	animationNodeThreshold: number;
	/** Nodes at depth <= this become headings; deeper nodes become list items (plan §7.1). */
	headingDepth: number;
	/** Auto-balance layout mode (plan §9.3). */
	layoutMode: LayoutMode;
}

export const DEFAULT_SETTINGS: MindMapSettings = {
	writeDebounceMs: 400,
	animationNodeThreshold: 500,
	headingDepth: 1,
	layoutMode: "balanced",
};
