import { describe, expect, it } from "vitest";
import { attachmentFolderPath, buildAttachmentEmbed, dedupeAttachmentName, ensureFolder, sanitizedAttachmentFolderName } from "../src/sync/attachments";

describe("ensureFolder", () => {
	it("uses the created folder when the path lookup has not updated yet", async () => {
		const created = { kind: "folder" };
		const getFolder = (file: unknown): file is typeof created =>
			typeof file === "object" && file !== null && "kind" in file && file.kind === "folder";
		const getAbstractFileByPath = () => null;
		const createFolder = async () => created;

		await expect(ensureFolder("Map_attachments", getAbstractFileByPath, createFolder, getFolder)).resolves.toBe(created);
	});

	it("re-checks the path when creation fails because another caller created it", async () => {
		const created = { kind: "folder" };
		const getFolder = (file: unknown): file is typeof created =>
			typeof file === "object" && file !== null && "kind" in file && file.kind === "folder";
		let lookups = 0;
		const getAbstractFileByPath = () => (++lookups === 1 ? null : created);
		const createFolder = async () => {
			throw new Error("already exists");
		};

		await expect(ensureFolder("Map_attachments", getAbstractFileByPath, createFolder, getFolder)).resolves.toBe(created);
	});
});

describe("attachmentFolderPath", () => {
	it("root-level map (mapParentPath === \"\") returns just the attachments folder name", () => {
		expect(attachmentFolderPath("", "MyMap")).toBe("MyMap_attachments");
	});

	it("nested map returns the sibling folder under the map's own parent path", () => {
		expect(attachmentFolderPath("notes/maps", "MyMap")).toBe("notes/maps/MyMap_attachments");
	});

	it("treats Obsidian's vault-root parent path \"/\" as the root (no leading slash)", () => {
		expect(attachmentFolderPath("/", "MyMap")).toBe("MyMap_attachments");
	});

	it("never doubles up slashes even if mapParentPath has a trailing slash", () => {
		expect(attachmentFolderPath("notes/maps/", "MyMap")).toBe("notes/maps/MyMap_attachments");
	});

	it("sanitizes spaces out of the basename before appending _attachments (D1 extended to folder names — see DECISIONS.md)", () => {
		const path = attachmentFolderPath("", "Project Plan");
		expect(path).toBe("Project-Plan_attachments");
		expect(path.endsWith("_attachments")).toBe(true);
	});

	it("never leaves a space or other CommonMark-destination-unsafe character in the result, whatever the map is named", () => {
		expect(attachmentFolderPath("", "Notes (Draft)")).toBe("Notes-Draft_attachments");
		expect(attachmentFolderPath("", "Q&A / Ideas")).toMatch(/^[A-Za-z0-9._-]+_attachments$/);
	});
});

describe("sanitizedAttachmentFolderName", () => {
	it("passes a space-free basename through unchanged", () => {
		expect(sanitizedAttachmentFolderName("MyMap")).toBe("MyMap_attachments");
	});

	it("collapses a run of unsafe characters to a single hyphen and trims stray edges", () => {
		expect(sanitizedAttachmentFolderName("Project Plan")).toBe("Project-Plan_attachments");
		expect(sanitizedAttachmentFolderName(" Draft ")).toBe("Draft_attachments");
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

	it("regression: a space-containing map name no longer produces an embed with an unescaped space in the destination", () => {
		// Previously `attachmentFolderPath` preserved the raw basename, so this
		// combination produced `![](Project Plan_attachments/....png)` — an
		// unbracketed CommonMark destination containing a literal space, which
		// strict/external markdown renderers refuse to parse as a link. That
		// was exactly the "broken outside Obsidian" bug this feature exists to
		// fix, just relocated from the pasted-image filename to the folder name.
		const folderName = attachmentFolderPath("", "Project Plan");
		const embed = buildAttachmentEmbed(folderName, "pasted-image-20260101120000.png");
		expect(embed).toBe("![](Project-Plan_attachments/pasted-image-20260101120000.png)");
		expect(embed).not.toMatch(/\s/);
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
