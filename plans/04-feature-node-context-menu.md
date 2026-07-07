# 04 — Feature: context menu on nodes ("Go to note section" + standard actions)

**Source note:** "add context menu on nodes → go to the note section →
directly navigates to the related section (header / subheader / any note
section)"

**Status:** done

## Goal

Right-clicking a node opens an Obsidian-native `Menu` with:

- **Go to note section** — opens the backing `.md` file in a markdown view
  and scrolls to / highlights the exact heading or list line this node came
  from.
- Standard node actions (cheap wins, all already exist as Controller calls):
  Edit (F2), Add child (Tab), Add sibling (Enter), Delete, Copy/Cut/Paste,
  Fold/Unfold, Edit link (Ctrl+K).

## Design

### Wiring the menu

1. `SvgRenderer`: add a `contextmenu` listener next to the existing `click`
   handler ([SvgRenderer.ts:239](../src/render/SvgRenderer.ts)), resolve the
   node via the same `closest(".mm-node")` hit-testing, and expose
   `setNodeContextMenuHandler(id, evt)`.
2. `MindMapView`: build the `Menu` (Obsidian API, zero bundle cost), select
   the node first (menu actions operate on the selection), then
   `menu.showAtMouseEvent(evt)`.

### "Go to note section" navigation

The plugin already persists node identity as ` ^blockid` suffixes
([parser.ts:17](../src/sync/parser.ts), `ensurePersistentIds` in
[metadata.ts](../src/sync/metadata.ts)), which gives us robust targets:

- **Preferred:** `app.workspace.openLinkText("path#^" + node.id, path)` —
  Obsidian's native block-reference jump; works for both headings and list
  items *if* the node's id is persisted in the file.
- **Headings without a block id:** `openLinkText("path#" + node.text)`
  (heading link — matches how Obsidian resolves `[[note#Heading]]`).
- **Fallback (list nodes without persisted id, duplicate heading text):**
  serialize path-matching — walk the parsed structure to compute the node's
  line number in `this.data`, open the file and
  `leaf.setEphemeralState({ line })`.

Implementation order: try block id → heading text → line-number fallback.

Open in a **new tab / split** (configurable later): jumping to the source
while keeping the map open is the expected workflow; replacing the map view
with the markdown view would lose the user's place.

Note: the map keeps unsaved changes for up to `writeDebounceMs` — flush
(`writeNow()`) before navigating so the markdown view shows current content.

## Implementation steps

1. Renderer `contextmenu` plumbing (hit-test + handler, ~15 lines).
2. `MindMapView.showNodeMenu(nodeId, evt)` with the standard actions.
3. `goToNoteSection(nodeId)` with the three-tier target resolution + write
   flush.
4. Menu item labels/icons; disable "Go to note section" for the synthetic
   root when the file has no H1.

## Tests

- Unit: target-resolution helper (given a model + raw text, produce the
  right link target or line number) — pure function, easily testable.
- Manual dev-vault check for the actual navigation & scroll behavior
  (Electron; no automated visual verification).

## Performance

Menu building is on-demand user-paced work — no per-frame or per-keystroke
cost. Line-number fallback is O(file lines) once per invocation, only when
the cheaper targets miss. No new dependencies.

## Open questions

None blocking. (Future: menu could also host "Copy as markdown" from plan 06
and "Show image" toggles from plan 07.)

## Implementation notes

Implemented as planned: `SvgRenderer.setNodeContextMenuHandler` +
`onContextMenu`, `MindMapView.showNodeMenu`/`goToNoteSection`, and the new
[goToSection.ts](../src/sync/goToSection.ts) module (`resolveGoToTarget` +
`findNodeLine`) with the three-tier target resolution described in the
design section above. `MindMapModel` gained a `hasExplicitRootHeading`
field (set in [parser.ts](../src/sync/parser.ts)) to detect the synthetic-
root-no-H1 case and disable the menu item accordingly. Tests added in
[test/goToSection.test.ts](../test/goToSection.test.ts) (10 tests: line-
finding against real `serializeMindMap` output, frontmatter/attachedContent
line accounting, all three target tiers, duplicate-heading-text fallback,
synthetic-root unavailability). Full decision writeup in
[DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test` (221/221)
and `npm run build` both pass. Manual verification in the dev vault still
pending — see workflow step 5: right-click a node, confirm the menu shows
and each action works; try "Go to note section" on a plain heading, a
folded/manually-positioned node (block-id path), a list item (line-number
path), and two same-named headings (should both fall back to line number
instead of ambiguously jumping to one).
