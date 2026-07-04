export type LinkKind = "wikilink" | "mdlink";

export interface TextSegment {
	text: string;
	link: { kind: LinkKind; target: string } | null;
}

// [[target]] or [[target|alias]], and [label](target) — the two link forms
// callable from the Ctrl/Cmd+K editor (R5).
const LINK_RE = /\[\[([^\]]+)\]\]|\[([^\]]*)\]\(([^)]+)\)/g;

/** Splits node text into plain-text and link runs for rendering as clickable spans. */
export function parseTextSegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let lastIndex = 0;
	LINK_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = LINK_RE.exec(text))) {
		if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), link: null });
		if (match[1] !== undefined) {
			const [target, alias] = match[1].split("|");
			segments.push({ text: alias ?? target, link: { kind: "wikilink", target } });
		} else {
			segments.push({ text: match[2] || match[3], link: { kind: "mdlink", target: match[3] } });
		}
		lastIndex = LINK_RE.lastIndex;
	}
	if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), link: null });
	if (segments.length === 0) segments.push({ text: "", link: null });
	return segments;
}

/**
 * The text as it should actually be displayed/measured (link syntax
 * replaced by its label) — used for both rendering and node-width
 * estimation. Width estimation runs on every layout pass and flextree
 * invokes it multiple times per node internally, so the fast path here
 * (skip the regex entirely when there's no `[` at all — the vast majority
 * of node text) matters: it's what keeps layout time from regressing
 * once link-aware width estimation was added (see DECISIONS.md).
 */
export function getDisplayText(text: string): string {
	if (!text.includes("[")) return text;
	return parseTextSegments(text)
		.map((s) => s.text)
		.join("");
}

/** True if node text has exactly one link occupying the whole label (the common case the Ctrl/Cmd+K editor produces) — used to prefill the link editor. */
export function getSoleLink(text: string): { kind: LinkKind; target: string; label: string } | null {
	const segments = parseTextSegments(text).filter((s) => s.text.length > 0);
	if (segments.length === 1 && segments[0].link) {
		return { ...segments[0].link, label: segments[0].text };
	}
	return null;
}

/** Builds node-text for a link (Ctrl/Cmd+K editor), matching the syntax `parseTextSegments` understands. */
export function buildLinkText(result: { label: string; kind: LinkKind; target: string }): string {
	if (result.kind === "wikilink") {
		return result.label === result.target ? `[[${result.target}]]` : `[[${result.target}|${result.label}]]`;
	}
	return `[${result.label}](${result.target})`;
}
