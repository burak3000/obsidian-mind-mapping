import { MindMapModel, MindNode } from "../model/types";
import { applyMindmapData, nodeHasPersistableMeta, NodeMeta } from "./metadata";

export interface SerializeConfig {
	/** Nodes at depth <= this become headings (H1..H(headingDepth+1)); deeper nodes become list items. */
	headingDepth: number;
}

export const DEFAULT_SERIALIZE_CONFIG: SerializeConfig = { headingDepth: 1 };

/**
 * Serializes a MindMapModel back to markdown — the inverse of `parseMindMap`.
 * Single-pass O(n) string-builder output (addendum §4.2); frontmatter and
 * each node's `attachedContent` are re-emitted verbatim for round-trip
 * fidelity (N2/N3). Nodes with persistable metadata (fold state R13,
 * manual position R12) get a ` ^blockid` suffix and an entry in the
 * frontmatter `mindmap:` block.
 *
 * Precondition: call `ensurePersistentIds(model.root, model.byId)` first —
 * this function does not mint ids itself, so it stays pure/deterministic.
 */
export function serializeMindMap(model: MindMapModel, cfg: SerializeConfig = DEFAULT_SERIALIZE_CONFIG): string {
	const nodesMeta: Record<string, NodeMeta> = {};
	collectMeta(model.root, nodesMeta);
	const frontmatter = applyMindmapData(model.frontmatterRaw, { nodes: nodesMeta });

	const lines: string[] = [];
	if (frontmatter) lines.push(frontmatter);

	lines.push(`# ${model.root.text}`);
	if (model.root.attachedContent) lines.push(...model.root.attachedContent);

	for (const child of model.root.children) {
		serializeNode(child, cfg, lines);
	}

	return lines.join("\n") + "\n";
}

function collectMeta(node: MindNode, out: Record<string, NodeMeta>): void {
	if (nodeHasPersistableMeta(node)) {
		out[node.id] = {
			folded: node.folded || undefined,
			pos: node.manualPos ? [node.manualPos.x, node.manualPos.y] : undefined,
			width: node.manualWidth,
		};
	}
	for (const child of node.children) collectMeta(child, out);
}

function serializeNode(node: MindNode, cfg: SerializeConfig, lines: string[]): void {
	const suffix = nodeHasPersistableMeta(node) ? ` ^${node.id}` : "";
	if (node.depth <= cfg.headingDepth) {
		const headingLevel = node.depth + 1; // root is depth 0 -> H1, so depth d -> H(d+1)
		lines.push(`${"#".repeat(headingLevel)} ${node.text}${suffix}`);
	} else {
		const indent = "  ".repeat(node.depth - cfg.headingDepth - 1);
		lines.push(`${indent}- ${node.text}${suffix}`);
	}
	if (node.attachedContent) lines.push(...node.attachedContent);

	for (const child of node.children) {
		serializeNode(child, cfg, lines);
	}
}
