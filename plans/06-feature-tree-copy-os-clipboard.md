# 06 — Feature: tree copy to OS clipboard

**Source note:** "tree copy — copy all the things under a tree into OS'
memory, to paste into another thing"

**Status:** done

## Goal

Copying a node puts its whole subtree on the **system clipboard as markdown
text**, so it can be pasted into any other app (or another vault/map). Today
Ctrl+C only fills the in-memory `Controller.clipboard`
([Controller.ts:38](../src/controller/Controller.ts)) — nothing leaves the
plugin.

## Design

### Copy side

1. New pure helper `serializeSubtree(node): string` (next to
   [serializer.ts](../src/sync/serializer.ts)): emits the subtree as a
   markdown **nested list** (`- text` with 2-space indents), the node itself
   as the top item. Lists are the right target format — they paste cleanly
   into other Obsidian notes, XMind, and plain-text editors, and they
   round-trip through our own parser. **Strip ` ^blockid` suffixes and
   mindmap metadata** — ids must not leak/duplicate.
2. `copySelected` / `cutSelected` additionally write that text via
   `navigator.clipboard.writeText(...)` (fire-and-forget promise; available
   in Electron). Internal `MindNode[]` clipboard stays the fidelity source
   (keeps colors, fold state, manual sizes, attached content).

### Paste side (makes the feature symmetric)

`pasteToSelected` decides between the two clipboards:

- Remember the text we last wrote to the OS clipboard. On paste, read the OS
  clipboard (`navigator.clipboard.readText()`); if it **differs** from what
  we wrote, the user copied something *outside* → parse it with the existing
  list/heading parser ([parser.ts](../src/sync/parser.ts)) into subtrees and
  insert those. Multi-line plain text (no list markers) becomes one node per
  line; single-line text becomes one node.
- Otherwise use the internal clipboard as today (higher fidelity).

Paste becomes async (clipboard read); Controller gets an async path or the
View reads the clipboard and hands text in — prefer the latter to keep
Controller synchronous and testable.

## Interaction with plan 05 (multi-select)

If 05 lands first, clipboard is `MindNode[]` — `serializeSubtree` maps over
the array joined by newlines. No design conflict; build order free.

## Implementation steps

1. `serializeSubtree` + tests (pure function).
2. Hook into `copySelected`/`cutSelected`.
3. External-text detection + parse-on-paste in `MindMapView` →
   `controller.pasteSubtrees(nodes)`.
4. Context-menu entry "Copy subtree as markdown" (plan 04) reuses the same
   helper.

## Tests

- Round-trip: subtree → markdown → `parseMindMap` → equal structure/text.
- Block ids and metadata stripped.
- Paste of external markdown list / plain lines / single line.
- (jsdom lacks `navigator.clipboard` — inject a clipboard adapter so tests
  can stub it.)

## Performance

Serialization is O(subtree) once per user-paced copy — irrelevant to
budgets. Clipboard I/O is async and off the render path. No dependencies.

## Open questions

- Should paste of a *heading-structured* external markdown (`#`/`##`) also be
  supported, or lists + plain lines only? (Parser already handles headings —
  proposal: support it for free, headings become nested levels.)
  (Implemented as proposed — reusing the existing parser made this free;
  not a performance trade-off, so no rule-3 stop needed.)

## Implementation notes

Implemented as planned: `serializeSubtree`/`serializeSubtrees`
([serializer.ts](../src/sync/serializer.ts)), `Controller.getClipboardMarkdown()`/
`pasteSubtrees()` ([Controller.ts](../src/controller/Controller.ts)), and
`parseExternalPaste` ([parseExternalPaste.ts](../src/sync/parseExternalPaste.ts))
with all three cases from the open-question proposal (H1-rooted, list/
heading structure, plain lines). All raw `navigator.clipboard` I/O lives in
[MindMapView.ts](../src/view/MindMapView.ts) (`writeClipboardText`/
`handlePaste`), keeping Controller synchronous per the design note. Context
menu (item 04) gained "Copy subtree as markdown". Tests added: 4 new cases
in [test/serializer.test.ts](../test/serializer.test.ts) (nested-list
output, block-id/metadata stripping, round-trip, multi-subtree join), 9 in
[test/parseExternalPaste.test.ts](../test/parseExternalPaste.test.ts) (all
three cases, round-trip, fresh-id minting, detached parent), and 3 in
[test/controller.test.ts](../test/controller.test.ts)
(`getClipboardMarkdown`/`pasteSubtrees`). Full decision writeup in
[DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test` (248/248)
and `npm run build` both pass. Manual verification in the dev vault still
pending — see workflow step 5: copy a subtree, paste it into a plain-text
app to confirm it's a readable markdown list; copy some unrelated text from
outside Obsidian and paste it into the map to confirm it becomes new
node(s); try "Copy subtree as markdown" from the context menu.
