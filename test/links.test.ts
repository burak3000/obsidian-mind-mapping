import { describe, expect, it } from "vitest";
import {
	parseTextSegments,
	getDisplayText,
	getSoleLink,
	parseEmbeds,
	getImageEmbed,
	isImageTarget,
	isUrlTarget,
	normalizeUrlTarget,
	isAbsoluteFilesystemPath,
	expandHomePath,
	appendLinkText,
	removeLinkOccurrence,
} from "../src/model/links";

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

describe("parseEmbeds (plan item 07: image display)", () => {
	it("parses a wikilink embed", () => {
		expect(parseEmbeds("![[photo.png]]")).toEqual([{ kind: "wikilink", target: "photo.png", alt: "photo.png" }]);
	});

	it("parses a wikilink embed with an alias as alt text", () => {
		expect(parseEmbeds("![[photo.png|My photo]]")).toEqual([{ kind: "wikilink", target: "photo.png", alt: "My photo" }]);
	});

	it("parses a markdown-form embed", () => {
		expect(parseEmbeds("![alt text](path/to.png)")).toEqual([{ kind: "mdlink", target: "path/to.png", alt: "alt text" }]);
	});

	it("does not confuse a regular (non-embed) link with an embed", () => {
		expect(parseEmbeds("[[Some Note]]")).toEqual([]);
		expect(parseEmbeds("[label](url)")).toEqual([]);
	});

	it("finds multiple embeds in one string", () => {
		const embeds = parseEmbeds("![[a.png]] and ![[b.png]]");
		expect(embeds.map((e) => e.target)).toEqual(["a.png", "b.png"]);
	});
});

describe("appendLinkText (R3/R5, D7 visible append)", () => {
	it("appends to non-empty text with a plain arrow separator", () => {
		expect(appendLinkText("Kickoff", "[[#^tgt1]]")).toBe("Kickoff → [[#^tgt1]]");
	});

	it("appends to empty text by returning just the new link (no leading separator)", () => {
		expect(appendLinkText("", "[[#^tgt1]]")).toBe("[[#^tgt1]]");
	});

	it("treats whitespace-only existing text as empty", () => {
		expect(appendLinkText("   ", "[[#^tgt1]]")).toBe("[[#^tgt1]]");
	});

	it("appending twice produces two relations separated by two arrows", () => {
		const once = appendLinkText("Kickoff", "[[#^a]]");
		const twice = appendLinkText(once, "[[#^b]]");
		expect(twice).toBe("Kickoff → [[#^a]] → [[#^b]]");
	});
});

describe("removeLinkOccurrence (R3/R5, D7 visible append)", () => {
	it("removes the sole link, leaving the preceding text with no dangling separator", () => {
		const text = appendLinkText("Kickoff", "[[#^a]]");
		expect(removeLinkOccurrence(text, 0)).toBe("Kickoff");
	});

	it("removing one of two appended relations leaves the other's text and separator intact", () => {
		const text = "Kickoff → [[#^a]] → [[#^b]]";
		expect(removeLinkOccurrence(text, 0)).toBe("Kickoff → [[#^b]]");
		expect(removeLinkOccurrence(text, 1)).toBe("Kickoff → [[#^a]]");
	});

	it("removing the first of two links when there's no leading plain text still leaves no dangling separator", () => {
		const text = "[[#^a]] → [[#^b]]";
		expect(removeLinkOccurrence(text, 0)).toBe("[[#^b]]");
		expect(removeLinkOccurrence(text, 1)).toBe("[[#^a]]");
	});

	it("removing the only remaining link from a fully-link-only text yields an empty string", () => {
		expect(removeLinkOccurrence("[[#^a]]", 0)).toBe("");
	});

	it("is a no-op for an out-of-range occurrence index", () => {
		const text = "Kickoff → [[#^a]]";
		expect(removeLinkOccurrence(text, 5)).toBe(text);
		expect(removeLinkOccurrence(text, -1)).toBe(text);
	});
});

describe("isImageTarget", () => {
	it("recognizes common image extensions, case-insensitively", () => {
		for (const ext of ["png", "PNG", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"]) {
			expect(isImageTarget(`photo.${ext}`)).toBe(true);
		}
	});

	it("ignores a query string/fragment when checking the extension", () => {
		expect(isImageTarget("https://example.com/photo.png?w=200")).toBe(true);
		expect(isImageTarget("photo.png#fragment")).toBe(true);
	});

	it("rejects non-image targets", () => {
		expect(isImageTarget("note.pdf")).toBe(false);
		expect(isImageTarget("Some Note")).toBe(false);
	});
});

describe("isUrlTarget", () => {
	it("recognizes common URL schemes", () => {
		for (const target of ["https://example.com", "http://example.com", "ftp://example.com/file"]) {
			expect(isUrlTarget(target)).toBe(true);
		}
	});

	it("recognizes a bare domain typed without a scheme", () => {
		for (const target of ["www.youtube.com", "youtube.com", "example.co.uk", "sub.example.com/path?q=1"]) {
			expect(isUrlTarget(target)).toBe(true);
		}
	});

	it("rejects bare vault-relative note titles/paths, including ones that look dotted", () => {
		expect(isUrlTarget("Some Note")).toBe(false);
		expect(isUrlTarget("folder/Some Note")).toBe(false);
		expect(isUrlTarget("Meeting notes v1.2")).toBe(false); // spaces -> never a URL
		expect(isUrlTarget("config.json")).toBe(false); // dotted, but not a recognized TLD
		expect(isUrlTarget("Some Note.md")).toBe(false); // .md deliberately excluded (see COMMON_BARE_TLDS doc comment)
	});
});

describe("normalizeUrlTarget", () => {
	it("leaves a target with an explicit scheme untouched", () => {
		expect(normalizeUrlTarget("https://example.com")).toBe("https://example.com");
	});

	it("adds https:// to a bare domain with no scheme", () => {
		expect(normalizeUrlTarget("www.youtube.com")).toBe("https://www.youtube.com");
	});
});

describe("isAbsoluteFilesystemPath", () => {
	it("recognizes POSIX absolute, home-relative, and Windows-style paths", () => {
		for (const target of ["/Users/me/file.pdf", "~", "~/Documents", "C:\\Users\\me\\file.txt", "D:/data"]) {
			expect(isAbsoluteFilesystemPath(target)).toBe(true);
		}
	});

	it("rejects vault-relative paths and note titles", () => {
		expect(isAbsoluteFilesystemPath("Some Note")).toBe(false);
		expect(isAbsoluteFilesystemPath("attachments/file.pdf")).toBe(false);
	});
});

describe("expandHomePath", () => {
	it("expands a bare ~ and a ~/ prefix", () => {
		expect(expandHomePath("~", "/Users/me")).toBe("/Users/me");
		expect(expandHomePath("~/Documents/file.pdf", "/Users/me")).toBe("/Users/me/Documents/file.pdf");
	});

	it("leaves a non-~ path unchanged", () => {
		expect(expandHomePath("/Users/me/file.pdf", "/Users/me")).toBe("/Users/me/file.pdf");
	});
});

describe("getImageEmbed (plan item 07: image display)", () => {
	it("returns the embed when the target is an image", () => {
		expect(getImageEmbed("![[photo.png]]")).toEqual({ kind: "wikilink", target: "photo.png", alt: "photo.png" });
	});

	it("returns the embed even alongside surrounding caption text (unlike getSoleLink, doesn't require the whole text to be just the embed)", () => {
		expect(getImageEmbed("Photo: ![[photo.png]]")).toEqual({ kind: "wikilink", target: "photo.png", alt: "photo.png" });
	});

	it("returns null when the embed's target isn't an image (e.g. a PDF)", () => {
		expect(getImageEmbed("![[note.pdf]]")).toBeNull();
	});

	it("returns null when there's no embed at all", () => {
		expect(getImageEmbed("plain text")).toBeNull();
		expect(getImageEmbed("[[Some Note]]")).toBeNull(); // a regular link, not an embed
	});

	it("returns the first image embed when there are several", () => {
		const embed = getImageEmbed("![[a.png]] ![[b.png]]");
		expect(embed?.target).toBe("a.png");
	});
});
