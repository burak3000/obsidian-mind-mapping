import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import {
	applyMindmapData,
	applyMindmapDataToTree,
	extractMindmapData,
	ensurePersistentIds,
	forcePersistentId,
	isSyntheticId,
	nodeHasPersistableMeta,
} from "../src/sync/metadata";

describe("extractMindmapData", () => {
	it("returns empty nodes when there is no frontmatter", () => {
		expect(extractMindmapData(null)).toEqual({ nodes: {} });
	});

	it("returns empty nodes when frontmatter has no mindmap key", () => {
		const fm = ["---", "tags: [a, b]", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: {} });
	});

	it("parses folded node entries", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "    ^def456: { folded: true }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: { abc123: { folded: true }, def456: { folded: true } } });
	});

	it("ignores entries without folded:true", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: {} });
	});

	it("stops at the next top-level key (doesn't swallow unrelated frontmatter)", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "tags: [x]", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: { abc123: { folded: true } } });
	});

	it("parses externalRef:true node entries (R4 durability fix)", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { externalRef: true }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: { abc123: { externalRef: true } } });
	});

	it("ignores entries without externalRef:true", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: {} });
	});

	it("parses badge node entries (plans/09)", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { badge: done }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: { abc123: { badge: "done" } } });
	});

	it("captures an unrecognized badge value instead of dropping it (forward-compat with a newer plugin version)", () => {
		const fm = ["---", "mindmap:", "  nodes:", "    ^abc123: { badge: from-the-future }", "---"].join("\n");
		expect(extractMindmapData(fm)).toEqual({ nodes: { abc123: { badge: "from-the-future" } } });
	});
});

describe("applyMindmapDataToTree", () => {
	it("sets folded=true on matching nodes by block id", () => {
		const model = parseMindMap(["# Root", "## Branch A ^abc123"].join("\n"), "fallback");
		applyMindmapDataToTree(model.byId, { nodes: { abc123: { folded: true } } });
		expect(model.root.children[0].folded).toBe(true);
	});

	it("ignores ids that don't match any node", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		expect(() => applyMindmapDataToTree(model.byId, { nodes: { nonexistent: { folded: true } } })).not.toThrow();
	});

	it("sets externalRelationTarget=true on matching nodes by block id (R4 durability fix)", () => {
		const model = parseMindMap(["# Root", "## Branch A ^abc123"].join("\n"), "fallback");
		applyMindmapDataToTree(model.byId, { nodes: { abc123: { externalRef: true } } });
		expect(model.root.children[0].externalRelationTarget).toBe(true);
	});

	it("sets statusBadge on matching nodes by block id (plans/09)", () => {
		const model = parseMindMap(["# Root", "## Branch A ^abc123"].join("\n"), "fallback");
		applyMindmapDataToTree(model.byId, { nodes: { abc123: { badge: "blocked" } } });
		expect(model.root.children[0].statusBadge).toBe("blocked");
	});
});

describe("applyMindmapData (round-trip on frontmatter text)", () => {
	it("returns null when there is nothing to persist and no existing frontmatter", () => {
		expect(applyMindmapData(null, { nodes: {} })).toBeNull();
	});

	it("creates a new frontmatter block when there is metadata but no existing frontmatter", () => {
		const result = applyMindmapData(null, { nodes: { abc123: { folded: true } } });
		expect(result).toBe(["---", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "---"].join("\n"));
	});

	it("inserts the mindmap key into existing frontmatter without disturbing other keys", () => {
		const existing = ["---", "tags: [foo]", "aliases:", "  - Bar", "---"].join("\n");
		const result = applyMindmapData(existing, { nodes: { abc123: { folded: true } } });
		expect(result).toBe(["---", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "tags: [foo]", "aliases:", "  - Bar", "---"].join("\n"));
	});

	it("replaces an existing mindmap block in place, leaving surrounding keys untouched", () => {
		const existing = ["---", "tags: [foo]", "mindmap:", "  nodes:", "    ^old111: { folded: true }", "aliases:", "  - Bar", "---"].join("\n");
		const result = applyMindmapData(existing, { nodes: { new222: { folded: true } } });
		expect(result).toBe(["---", "tags: [foo]", "mindmap:", "  nodes:", "    ^new222: { folded: true }", "aliases:", "  - Bar", "---"].join("\n"));
	});

	it("removes the mindmap block entirely when metadata becomes empty, preserving other keys", () => {
		const existing = ["---", "tags: [foo]", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "---"].join("\n");
		const result = applyMindmapData(existing, { nodes: {} });
		expect(result).toBe(["---", "tags: [foo]", "---"].join("\n"));
	});

	it("drops the whole frontmatter block if nothing remains after removing our subtree", () => {
		const existing = ["---", "mindmap:", "  nodes:", "    ^abc123: { folded: true }", "---"].join("\n");
		const result = applyMindmapData(existing, { nodes: {} });
		expect(result).toBeNull();
	});

	it("round-trips through extract -> apply -> extract without drift", () => {
		const original = { nodes: { a1: { folded: true }, b2: { folded: true } } };
		const text = applyMindmapData(null, original);
		expect(extractMindmapData(text)).toEqual(original);
	});
});

describe("externalRelationTarget durability (R4 fix, sync/foreignRelation.ts's commitForeignRelationTarget)", () => {
	it("nodeHasPersistableMeta is true purely from externalRelationTarget, independent of fold/pos/width", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(nodeHasPersistableMeta(branch)).toBe(false);
		branch.externalRelationTarget = true;
		expect(nodeHasPersistableMeta(branch)).toBe(true);
		expect(branch.folded).toBe(false);
		expect(branch.manualPos).toBeUndefined();
		expect(branch.manualWidth).toBeUndefined();
	});

	it("a node with only externalRelationTarget=true round-trips through collectMeta -> applyMindmapData -> extractMindmapData -> applyMindmapDataToTree on a fresh parse", () => {
		// Simulate the actual bug scenario: parse, mark external (as
		// commitForeignRelationTarget does), serialize, then parse the
		// serialized output *again* as if it were a brand-new session with no
		// memory of the original in-session state.
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(isSyntheticId(branch.id)).toBe(true);
		branch.externalRelationTarget = true;

		ensurePersistentIds(model.root, model.byId, () => "extref1");
		expect(branch.id).toBe("extref1");

		const meta: Record<string, { folded?: boolean; pos?: [number, number]; width?: number; externalRef?: boolean }> = {};
		meta[branch.id] = { externalRef: branch.externalRelationTarget || undefined };
		const frontmatter = applyMindmapData(null, { nodes: meta });
		expect(frontmatter).toContain("externalRef: true");

		// Fresh, independent parse of the serialized text (no shared state
		// with `model`/`branch` above).
		const serializedText = [frontmatter, "# Root", "## Branch A ^extref1"].join("\n");
		const reparsed = parseMindMap(serializedText, "fallback");
		const reparsedBranch = reparsed.root.children[0];

		expect(reparsedBranch.id).toBe("extref1");
		expect(reparsedBranch.externalRelationTarget).toBe(true);
		// isRelationTarget was never set in this file's own content, so it's
		// correctly absent — externalRelationTarget is the field carrying the
		// durable fact, exactly as designed.
		expect(reparsedBranch.isRelationTarget).toBeUndefined();
	});
});

describe("ensurePersistentIds", () => {
	it("mints a persistent id for a folded node with a synthetic id", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(isSyntheticId(branch.id)).toBe(true);
		branch.folded = true;
		branch.children.push({ id: "child-synthetic", text: "x", children: [], parent: branch, depth: 2, folded: false, subtreeCount: 0 });

		ensurePersistentIds(model.root, model.byId, () => "fixedid1");
		expect(branch.id).toBe("fixedid1");
		expect(model.byId.get("fixedid1")).toBe(branch);
	});

	it("does not touch a node that already has a non-synthetic id", () => {
		const model = parseMindMap(["# Root", "## Branch A ^already1"].join("\n"), "fallback");
		const branch = model.root.children[0];
		branch.folded = true;
		ensurePersistentIds(model.root, model.byId, () => "shouldnotuse");
		expect(branch.id).toBe("already1");
	});

	it("leaves nodes without metadata alone", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		const originalId = branch.id;
		ensurePersistentIds(model.root, model.byId, () => "shouldnotuse");
		expect(branch.id).toBe(originalId);
	});

	it("avoids id collisions by retrying the generator", () => {
		const model = parseMindMap(["# Root", "## Branch A", "## Branch B"].join("\n"), "fallback");
		model.root.children[0].folded = true;
		model.root.children[1].folded = true;
		let call = 0;
		const ids = ["dup", "dup", "unique2"];
		ensurePersistentIds(model.root, model.byId, () => ids[call++]);
		const [a, b] = model.root.children;
		expect(new Set([a.id, b.id]).size).toBe(2);
	});

	it("mints a persistent id for a node whose only persistable metadata is being a relation target (R1a item 2)", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(isSyntheticId(branch.id)).toBe(true);
		branch.isRelationTarget = true;

		ensurePersistentIds(model.root, model.byId, () => "reltarget1");
		expect(branch.id).toBe("reltarget1");
		expect(model.byId.get("reltarget1")).toBe(branch);
	});
});

describe("nodeHasPersistableMeta (R1a item 2: relation-target extension)", () => {
	it("is true for a node with no fold/pos/width but isRelationTarget set", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(nodeHasPersistableMeta(branch)).toBe(false);
		branch.isRelationTarget = true;
		expect(nodeHasPersistableMeta(branch)).toBe(true);
	});

	it("is true purely from statusBadge, independent of fold/pos/width (plans/09)", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		expect(nodeHasPersistableMeta(branch)).toBe(false);
		branch.statusBadge = "ready";
		expect(nodeHasPersistableMeta(branch)).toBe(true);
	});
});

describe("forcePersistentId (R1a item 6: relation authoring)", () => {
	it("mints and returns a fresh persistent id for a node with a synthetic id, updating byId", () => {
		const model = parseMindMap(["# Root", "## Branch A"].join("\n"), "fallback");
		const branch = model.root.children[0];
		const oldId = branch.id;
		expect(isSyntheticId(oldId)).toBe(true);

		const newId = forcePersistentId(branch, model.byId, () => "forcedid1");

		expect(newId).toBe("forcedid1");
		expect(branch.id).toBe("forcedid1");
		expect(model.byId.get("forcedid1")).toBe(branch);
		expect(model.byId.has(oldId)).toBe(false);
	});

	it("is a no-op returning the existing id when the node already has a non-synthetic id", () => {
		const model = parseMindMap(["# Root", "## Branch A ^already1"].join("\n"), "fallback");
		const branch = model.root.children[0];
		const id = forcePersistentId(branch, model.byId, () => "shouldnotuse");
		expect(id).toBe("already1");
		expect(branch.id).toBe("already1");
	});

	it("retries on a minted id collision, same as ensurePersistentIds", () => {
		const model = parseMindMap(["# Root", "## Branch A", "## Branch B ^taken"].join("\n"), "fallback");
		const branch = model.root.children[0];
		let call = 0;
		const ids = ["taken", "unique2"];
		const id = forcePersistentId(branch, model.byId, () => ids[call++]);
		expect(id).toBe("unique2");
	});
});
