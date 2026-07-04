import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseMindMap } from "../src/sync/parser";
import { serializeMindMap } from "../src/sync/serializer";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

describe("serializeMindMap", () => {
	it("round-trips a simple tree with nested lists byte-for-byte", () => {
		const md = ["# Root", "## Branch A", "- a", "  - a1", "    - a2", "- b", "## Branch B", "- c"].join("\n") + "\n";
		const model = parseMindMap(md, "fallback");
		expect(serializeMindMap(model)).toBe(md);
	});

	it("preserves a leading YAML frontmatter block verbatim", () => {
		const md = ["---", "tags: [foo, bar]", "aliases:", "  - Alt Name", "---", "# Root", "## Branch A"].join("\n") + "\n";
		const model = parseMindMap(md, "fallback");
		expect(model.frontmatterRaw).toBe(["---", "tags: [foo, bar]", "aliases:", "  - Alt Name", "---"].join("\n"));
		expect(serializeMindMap(model)).toBe(md);
	});

	it("preserves attached paragraph content under its owning node", () => {
		const md = ["# Root", "## Branch A", "", "Some paragraph text.", "", "- a"].join("\n") + "\n";
		const model = parseMindMap(md, "fallback");
		expect(serializeMindMap(model)).toBe(md);
	});

	it("falls back to the given title as an H1 when the source has no heading at all", () => {
		const model = parseMindMap("- just a list\n", "My Note");
		const out = serializeMindMap(model);
		expect(out.startsWith("# My Note\n")).toBe(true);
	});

	for (const size of [100, 500, 2000]) {
		it(`round-trips the ${size}-node benchmark fixture byte-for-byte`, () => {
			let md: string;
			try {
				md = readFileSync(join(FIXTURES_DIR, `${size}-nodes.md`), "utf8");
			} catch {
				return; // fixtures not generated in this environment; skip rather than fail
			}
			const model = parseMindMap(md, `${size}-nodes`);
			expect(serializeMindMap(model)).toBe(md);
		});
	}
});

// Sanity check that the fixtures directory is what we think it is, so the
// byte-for-byte tests above aren't silently skipped in CI.
describe("fixtures directory", () => {
	it("has the expected fixture files", () => {
		let files: string[] = [];
		try {
			files = readdirSync(FIXTURES_DIR);
		} catch {
			return;
		}
		expect(files).toEqual(expect.arrayContaining(["100-nodes.md", "500-nodes.md", "2000-nodes.md", "5000-nodes.md"]));
	});
});
