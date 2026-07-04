import { describe, expect, it } from "vitest";
import { parseTextSegments, getDisplayText, getSoleLink } from "../src/model/links";

describe("parseTextSegments", () => {
	it("returns a single plain segment for text with no links", () => {
		expect(parseTextSegments("just text")).toEqual([{ text: "just text", link: null }]);
	});

	it("parses a bare wikilink", () => {
		expect(parseTextSegments("[[Some Note]]")).toEqual([{ text: "Some Note", link: { kind: "wikilink", target: "Some Note" } }]);
	});

	it("parses an aliased wikilink, showing the alias", () => {
		expect(parseTextSegments("[[Some Note|Display]]")).toEqual([{ text: "Display", link: { kind: "wikilink", target: "Some Note" } }]);
	});

	it("parses a markdown link", () => {
		expect(parseTextSegments("[label](https://example.com)")).toEqual([{ text: "label", link: { kind: "mdlink", target: "https://example.com" } }]);
	});

	it("mixes plain text and a link in one string, preserving order", () => {
		const segments = parseTextSegments("Check [[Note A]] please");
		expect(segments).toEqual([
			{ text: "Check ", link: null },
			{ text: "Note A", link: { kind: "wikilink", target: "Note A" } },
			{ text: " please", link: null },
		]);
	});

	it("handles multiple links in one string", () => {
		const segments = parseTextSegments("[[A]] and [[B]]");
		expect(segments.filter((s) => s.link).map((s) => s.text)).toEqual(["A", "B"]);
	});
});

describe("getDisplayText", () => {
	it("strips link syntax down to the visible label", () => {
		expect(getDisplayText("Check [[Some Note|Display]] please")).toBe("Check Display please");
		expect(getDisplayText("[label](https://example.com)")).toBe("label");
		expect(getDisplayText("no links here")).toBe("no links here");
	});
});

describe("getSoleLink", () => {
	it("returns the link when the whole node text is exactly one link", () => {
		expect(getSoleLink("[[Some Note]]")).toEqual({ kind: "wikilink", target: "Some Note", label: "Some Note" });
		expect(getSoleLink("[label](url)")).toEqual({ kind: "mdlink", target: "url", label: "label" });
	});

	it("returns null when there is surrounding plain text", () => {
		expect(getSoleLink("Check [[Note]] please")).toBeNull();
	});

	it("returns null when there is no link at all", () => {
		expect(getSoleLink("plain text")).toBeNull();
	});
});
