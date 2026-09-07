/**
 * Pure, vault-free helpers for routing plugin-created attachments (pasted
 * images, initially) into a `${mapBasename}_attachments` folder that sits as
 * a SIBLING of the map's own `.md` file — rather than wherever Obsidian's
 * global "attachment folder" setting happens to point — and for producing a
 * standard (non-wikilink) markdown embed for the result (decision D1).
 *
 * No `app.vault`/`app.fileManager` calls live here: the actual folder
 * creation, directory listing, and binary write are the caller's job
 * (`MindMapView.pasteClipboardImage`, phases B2/B3). This module only does
 * the string/Set arithmetic, so it's unit-testable without any Obsidian
 * runtime.
 *
 * Note on `normalizePath`: the `"obsidian"` npm package ships TYPES ONLY
 * (its `package.json` has `"main": ""` and no runtime `.js` is published) —
 * importing anything from `"obsidian"` here would make Vitest fail to
 * resolve the module for every test in this file (confirmed experimentally:
 * "Failed to resolve entry for package \"obsidian\""). Every other
 * currently-tested pure module (`sync/`, `model/`) avoids importing from
 * `"obsidian"` for the same reason. So slash-joining below is done with a
 * small local helper instead of Obsidian's `normalizePath`.
 */

/** Joins path segments with `/`, dropping empty segments and collapsing any accidental repeated slashes — a tiny stand-in for Obsidian's `normalizePath` that stays resolvable under plain Node/Vitest (see module doc). */
function joinVaultPath(...segments: string[]): string {
	return segments
		.filter((segment) => segment.length > 0)
		.join("/")
		.replace(/\/+/g, "/");
}

/**
 * The sibling attachment folder's vault-relative path for a given map file.
 *
 * - `mapParentPath`: vault-relative path of the folder containing the map's
 *   `.md` file, using Obsidian's `TFile.parent?.path` convention — `""` when
 *   the map lives at the vault root.
 * - `basename`: the map file's basename (no extension).
 *
 * Root-level map (`mapParentPath === ""`) → `"${basename}_attachments"`.
 * Nested map (`mapParentPath === "notes/maps"`) →
 * `"notes/maps/${basename}_attachments"`. Never doubles up slashes.
 */
export function attachmentFolderPath(mapParentPath: string, basename: string): string {
	return joinVaultPath(mapParentPath, `${basename}_attachments`);
}

/**
 * The standard-markdown image embed string for an attachment, e.g.
 * `![](MyMap_attachments/pasted-image-20260101120000.png)` — deliberately
 * NOT the Obsidian-only `![[...]]` wikilink-embed syntax, so the map still
 * renders correctly in any plain markdown previewer (part of D1).
 *
 * - `relativePrefix`: the attachment folder name/path relative to the map
 *   note, e.g. `"MyMap_attachments"`.
 * - `filename`: the attachment's bare filename, e.g.
 *   `"pasted-image-20260101120000.png"`.
 */
export function buildAttachmentEmbed(relativePrefix: string, filename: string): string {
	return `![](${relativePrefix}/${filename})`;
}

/**
 * Returns a filename guaranteed not to collide with anything already in
 * `existing`, appending a numeric `-N` suffix as needed.
 *
 * - `existing`: bare filenames (no folder prefix, no path) already present
 *   in the target attachment folder.
 * - `base`: filename base WITHOUT extension and WITHOUT any numeric suffix,
 *   e.g. `"pasted-image-20260101120000"`.
 * - `ext`: extension without the leading dot, e.g. `"png"`.
 *
 * Tries `${base}.${ext}` first, then `${base}-1.${ext}`, `${base}-2.${ext}`,
 * … incrementing until a free name is found. Pure Set-membership check —
 * populating `existing` from the real vault folder listing is the caller's
 * job (B2).
 */
export function dedupeAttachmentName(existing: Set<string>, base: string, ext: string): string {
	const candidate = `${base}.${ext}`;
	if (!existing.has(candidate)) return candidate;

	let n = 1;
	while (existing.has(`${base}-${n}.${ext}`)) {
		n++;
	}
	return `${base}-${n}.${ext}`;
}
