import { LinkKind } from "./links";

/** Where a plain drag-drop lands relative to its drop target: nested as its last child, or reordered as a sibling immediately before/after it (same-level reorder). */
export type DropPosition = "before" | "after" | "inside";

/** R1a/R2: a link in a node's text classifies as either a same-document relation (arrow to another node in this map) or a cross-document relation (badge, opens elsewhere) — see model/relations.ts. */
export type RelationKind = "same-doc" | "cross-doc";

export interface ResolvedRelation {
	kind: RelationKind;
	linkKind: LinkKind;
	/** Raw target text exactly as written in the link syntax (e.g. `"#^abc123"`, `"Other Note"`, `"https://example.com"`). */
	rawTarget: string;
	/** Same-doc only: the node this relation resolves to within this map. */
	targetId?: string;
}

export interface NodeLayout {
	x: number;
	y: number;
	w: number;
	h: number;
	side: "L" | "R";
}

export interface MindNode {
	id: string;
	text: string;
	children: MindNode[];
	parent: MindNode | null;
	depth: number;
	folded: boolean;
	colorKey?: string;
	/** Sticky left/right assignment for a first-level branch (R11) — set once, never auto-reassigned; see DECISIONS.md "sticky sides". */
	branchSide?: "L" | "R";
	manualPos?: { x: number; y: number };
	/** Drag-resized wrap width override (px) — takes over from the default character-count wrap width until cleared. */
	manualWidth?: number;
	/** Descendant count, maintained incrementally on mutation — O(1) read for the fold badge (R14). */
	subtreeCount: number;
	layout?: NodeLayout;
	/**
	 * Relation-links cache (R1a): the link runs `parseTextSegments` found in
	 * this node's `text`, cached and invalidated by comparing
	 * `relationLinksCacheText` to the current `text` — keeps relation
	 * resolution off the hot path (mirrors `getDisplayText`'s fast path in
	 * links.ts: most node text has no `[` at all and never touches the
	 * regex). See `model/relations.ts`'s `resolveRelations`.
	 */
	relationLinksCacheText?: string;
	relationLinksCache?: { kind: LinkKind; target: string }[];
	/**
	 * This node's relations, resolved against the current tree by
	 * `resolveRelations` (R1a same-doc arrows, R2 cross-doc badges) —
	 * recomputed every `onChange`/mount, but cheap: only nodes whose text
	 * has link syntax do real work (see `relationLinksCache` above).
	 */
	resolvedRelations?: ResolvedRelation[];
	/**
	 * True while some other node's text has a resolved same-doc relation
	 * pointing here. Set by `resolveRelations`; read by
	 * `nodeHasPersistableMeta` (sync/metadata.ts) so this node's block-id
	 * suffix keeps getting written on serialize even if it has no
	 * fold/pos/width of its own — otherwise the id (and the relation
	 * referencing it) would be dropped on the next round-trip (R1a item 2).
	 */
	isRelationTarget?: boolean;
	/**
	 * Non-heading/non-list lines (paragraphs, code fences, blank lines) that
	 * followed this node's own line in the source, preserved verbatim for
	 * round-trip fidelity (N2/N3) and re-emitted right after this node on
	 * serialize.
	 */
	attachedContent?: string[];
}

export interface MindMapModel {
	root: MindNode;
	/** O(1) node lookup by id. */
	byId: Map<string, MindNode>;
	/** Monotonic version, bumped on every mutation — used for sync reconciliation (M2). */
	version: number;
	/** YAML frontmatter block (including `---` delimiters), preserved verbatim if present. */
	frontmatterRaw: string | null;
	/** True only if the source file's very first heading was an actual `# H1` line that became the root — false when the root is a synthetic stand-in (`fallbackTitle`) because the file had no H1 (yet). Used to disable "Go to note section" for the root in that case (there's no real heading line to jump to). */
	hasExplicitRootHeading: boolean;
}
