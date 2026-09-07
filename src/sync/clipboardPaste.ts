/**
 * Pure paste-source decision logic for `MindMapView.handlePaste` — factored
 * out so the internal-vs-external choice can be unit-tested without
 * stubbing `navigator.clipboard`.
 *
 * Three inputs, all snapshotted fresh at paste time:
 * - `internalMd`: `Controller.getClipboardMarkdown()` — the current internal
 *   (Ctrl/Cmd+C/X) clipboard, serialized, or `null` if nothing's copied.
 * - `lastWrittenClipboardText`: what `MindMapView.writeClipboardText()` last
 *   *confirmed* writing to the OS clipboard (`null` if that write never
 *   happened, failed, or the Clipboard API is unavailable).
 * - `osText`: a fresh read of the real OS clipboard right now (`null` if the
 *   read failed or the API is unavailable).
 *
 * Value-comparing `osText` against `lastWrittenClipboardText` alone can't
 * distinguish "OS clipboard is merely stale/failed relative to our own
 * write" from "genuine external content arrived after" — so the decision
 * instead keys off whether our last write to the OS clipboard is positively
 * confirmed to match the *current* internal clipboard:
 *
 * 1. No internal clipboard (`internalMd === null`) — there's nothing to
 *    fall back to, so go external whenever a read succeeded at all.
 * 2. Our last confirmed OS write matches the current internal clipboard
 *    (`lastWrittenClipboardText === internalMd`) — the OS clipboard is
 *    known to hold *our* content unless `osText` demonstrably differs.
 *    - `osText` equal to it, or unreadable (`null`): internal.
 *    - `osText` different: genuinely external content landed since.
 * 3. Otherwise (last write unconfirmed/failed/stale relative to a newer
 *    internal copy): trust the internal buffer unconditionally — the OS
 *    clipboard's contents can't be attributed either way, so `osText` isn't
 *    even consulted.
 */
export type PasteSourceDecision = { path: "internal" } | { path: "external"; text: string } | { path: "none" };

export interface PasteSourceInput {
	internalMd: string | null;
	lastWrittenClipboardText: string | null;
	osText: string | null;
}

export function decidePasteSource({ internalMd, lastWrittenClipboardText, osText }: PasteSourceInput): PasteSourceDecision {
	if (internalMd === null) {
		return osText !== null ? { path: "external", text: osText } : { path: "none" };
	}

	if (lastWrittenClipboardText === internalMd) {
		if (osText === internalMd || osText === null) {
			return { path: "internal" };
		}
		return { path: "external", text: osText };
	}

	return { path: "internal" };
}
