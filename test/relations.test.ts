import { describe, expect, it } from "vitest";
import { parseMindMap } from "../src/sync/parser";
import { serializeMindMap } from "../src/sync/serializer";
import { ensurePersistentIds, nodeHasPersistableMeta } from "../src/sync/metadata";
import { resolveRelations } from "../src/model/relations";
import { MindNode } from "../src/model/types";

function findByTextOrNull(root: MindNode, text: string): MindNode | null {
	if (root.text === text) return root;
	for (const child of root.children) {
		const found = findByTextOrNull(child, text);
		if (found) return found;
	}
	return null;
}

function findByText(root: MindNode, text: string): MindNode {
	const found = findByTextOrNull(root, text);
	if (!found) throw new Error(`node not found: ${text}`);
	return found;
}

describe("resolveRelations: classification", () => {
	it("resolves a bare same-file block ref [[#^id]] to the matching node as a same-doc relation", () => {
		const md = ["# Root", "## Source [[#^tgt1]]", "## Target ^tgt1"].join("\n");
		const model = parseMindMap(md, "fallback");
		const active = resolveRelations(model, "fallback");

		const source = findByText(model.root, "Source [[#^tgt1]]");
		const target = findByText(model.root, "Target");
		expect(source.resolvedRelations).toEqual([{ kind: "same-doc", linkKind: "wikilink", rawTarget: "#^tgt1", targetId: target.id }]);
		expect(active).toEqual([{ sourceId: source.id, targetId: target.id }]);
	});

	it("resolves [[<basename>#^id]] (case-insensitive) to the matching node when it names the current file", () => {
		const md = ["# Root", "## Source [[MyFile#^tgt1]]", "## Target ^tgt1"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "myfile");

		const source = findByText(model.root, "Source [[MyFile#^tgt1]]");
		expect(source.resolvedRelations?.[0].kind).toBe("same-doc");
	});

	it("does not resolve [[<basename>#^id]] when the basename doesn't match the current file", () => {
		const md = ["# Root", "## Source [[OtherFile#^tgt1]]", "## Target ^tgt1"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "myfile");

		const source = findByText(model.root, "Source [[OtherFile#^tgt1]]");
		expect(source.resolvedRelations).toEqual([{ kind: "cross-doc", linkKind: "wikilink", rawTarget: "OtherFile#^tgt1" }]);
	});

	it("ignores a dangling same-file block ref instead of treating it as cross-doc or crashing", () => {
		const md = ["# Root", "## Source [[#^nonexistent]]"].join("\n");
		const model = parseMindMap(md, "fallback");
		expect(() => resolveRelations(model, "fallback")).not.toThrow();

		const source = findByText(model.root, "Source [[#^nonexistent]]");
		expect(source.resolvedRelations).toEqual([]);
	});

	it("ignores a same-file non-block link (plain heading link) — not a relation, not a cross-doc badge", () => {
		const md = ["# Root", "## Source [[#Some Heading]]"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");

		const source = findByText(model.root, "Source [[#Some Heading]]");
		expect(source.resolvedRelations).toEqual([]);
	});

	it("ignores a self-referencing block link rather than drawing a self-loop", () => {
		const md = ["# Root", "## Self ^selfid"].join("\n");
		const model = parseMindMap(md, "fallback");
		const node = findByText(model.root, "Self");
		node.text = `Self [[#^${node.id}]]`;
		resolveRelations(model, "fallback");
		expect(node.resolvedRelations).toEqual([]);
	});

	it("classifies a wikilink to a different note as cross-doc", () => {
		const md = ["# Root", "## Source [[Other Note]]"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		const source = findByText(model.root, "Source [[Other Note]]");
		expect(source.resolvedRelations).toEqual([{ kind: "cross-doc", linkKind: "wikilink", rawTarget: "Other Note" }]);
	});

	it("classifies an mdlink (URL or vault path) as cross-doc", () => {
		const md = ["# Root", "## Source [ref](https://example.com)"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		const source = findByText(model.root, "Source [ref](https://example.com)");
		expect(source.resolvedRelations).toEqual([{ kind: "cross-doc", linkKind: "mdlink", rawTarget: "https://example.com" }]);
	});

	it("a node with no link at all gets an empty relation list", () => {
		const md = ["# Root", "## Plain node"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		expect(findByText(model.root, "Plain node").resolvedRelations).toEqual([]);
	});

	it("re-resolving after a target's block id changes correctly drops the stale relation and marks the new target instead", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		const target = findByText(model.root, "Target");
		expect(target.isRelationTarget).toBe(true);

		const source = findByText(model.root, "Source [[#^t1]]");
		source.text = "Source, no relation anymore";
		resolveRelations(model, "fallback");
		expect(target.isRelationTarget).toBe(false);
	});
});

describe("resolveRelations: block-id forcing for round-trip (R1a item 2)", () => {
	it("marks a relation's target as needing a persistent id even though it has no fold/pos/width of its own", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		const target = findByText(model.root, "Target");
		expect(nodeHasPersistableMeta(target)).toBe(true);
	});

	it("a plain node with no relation pointing at it is not considered to have persistable meta", () => {
		const md = ["# Root", "## Plain"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		expect(nodeHasPersistableMeta(findByText(model.root, "Plain"))).toBe(false);
	});

	it("round-trips a relation through parse -> resolve -> ensurePersistentIds -> serialize -> parse without losing it", () => {
		// Author a relation the way the link editor would: target gets a
		// forced persistent id (simulated with a real, deterministic mint), and
		// the source's text embeds it directly rather than a synthetic id.
		let counter = 0;
		const mint = () => `mint${counter++}`;

		const md = ["# Root", "## Source", "## Target"].join("\n");
		const model = parseMindMap(md, "fallback");
		const target = findByText(model.root, "Target");
		const source = findByText(model.root, "Source");

		// Simulate authoring: force the target's id, then write the relation link.
		target.id = mint();
		model.byId.set(target.id, target);
		source.text = `Source [[#^${target.id}]]`;

		resolveRelations(model, "fallback");
		ensurePersistentIds(model.root, model.byId, mint);
		const serialized = serializeMindMap(model);

		// The target's line must carry the block-id suffix so the reference
		// resolves again on the next parse.
		expect(serialized).toContain(`^${target.id}`);
		expect(serialized).toContain(`[[#^${target.id}]]`);

		const reparsed = parseMindMap(serialized, "fallback");
		resolveRelations(reparsed, "fallback");
		const reSource = findByText(reparsed.root, `Source [[#^${target.id}]]`);
		expect(reSource.resolvedRelations).toEqual([{ kind: "same-doc", linkKind: "wikilink", rawTarget: `#^${target.id}`, targetId: target.id }]);
	});

	it("a relation's target does NOT get a spurious empty frontmatter entry (only the block-id line suffix)", () => {
		const md = ["# Root", "## Source [[#^t1]]", "## Target ^t1"].join("\n");
		const model = parseMindMap(md, "fallback");
		resolveRelations(model, "fallback");
		ensurePersistentIds(model.root, model.byId);
		const serialized = serializeMindMap(model);

		expect(serialized).toContain("^t1");
		expect(serialized).not.toContain("mindmap:"); // no frontmatter needed for a relation-only target
	});
});
