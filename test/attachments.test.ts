import { describe, expect, it } from "vitest";
import { attachmentFolderPath, buildAttachmentEmbed, dedupeAttachmentName } from "../src/sync/attachments";

describe("attachmentFolderPath", () => {
	it("root-level map (mapParentPath === \"\") returns just the attachments folder name", () => {
		expect(attachmentFolderPath("", "MyMap")).toBe("MyMap_attachments");
	});

	it("nested map returns the sibling folder under the map's own parent path", () => {
		expect(attachmentFolderPath("notes/maps", "MyMap")).toBe("notes/maps/MyMap_attachments");
	});

	it("never doubles up slashes even if mapParentPath has a trailing slash", () => {
		expect(attachmentFolderPath("notes/maps/", "MyMap")).toBe("notes/maps/MyMap_attachments");
	});

	it("derives the folder name from basename + literal _attachments suffix", () => {
		const path = attachmentFolderPath("", "Project Plan");
		expect(path).toBe("Project Plan_attachments");
		expect(path.endsWith("_attachments")).toBe(true);
	});
});

describe("buildAttachmentEmbed", () => {
	it("produces a standard markdown embed (not a wikilink) in the exact Folder/file shape", () => {
		expect(buildAttachmentEmbed("MyMap_attachments", "pasted-image-20260101120000.png")).toBe("![](MyMap_attachments/pasted-image-20260101120000.png)");
	});

	it("has no spaces and no %20 for a space-free filename (D1)", () => {
		const embed = buildAttachmentEmbed("MyMap_attachments", "pasted-image-20260101120000.png");
		expect(embed).not.toContain(" ");
		expect(embed).not.toContain("%20");
	});
});

describe("dedupeAttachmentName", () => {
	it("no collision: returns base.ext unchanged", () => {
		const existing = new Set<string>();
		expect(dedupeAttachmentName(existing, "pasted-image-20260101120000", "png")).toBe("pasted-image-20260101120000.png");
	});

	it("empty existing set: returns base.ext unchanged", () => {
		expect(dedupeAttachmentName(new Set(), "img", "jpg")).toBe("img.jpg");
	});

	it("one collision: returns base-1.ext", () => {
		const existing = new Set(["pasted-image-20260101120000.png"]);
		expect(dedupeAttachmentName(existing, "pasted-image-20260101120000", "png")).toBe("pasted-image-20260101120000-1.png");
	});

	it("multiple collisions: returns the first free -N suffix", () => {
		const existing = new Set(["img.png", "img-1.png", "img-2.png"]);
		expect(dedupeAttachmentName(existing, "img", "png")).toBe("img-3.png");
	});

	it("does not get confused by an unrelated file sharing only the extension", () => {
		const existing = new Set(["other.png"]);
		expect(dedupeAttachmentName(existing, "img", "png")).toBe("img.png");
	});
});
