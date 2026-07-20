# 09 — Feature: node status badges (Done / Started / Blocked / Red Flag / Green Flag / Ready to work on)

**Source note:** "I want to add some badges to be available to show the
status of the node. They will be images to show them. Some of the most
required ones are Completed, Started, Blocked, Red Flag, Green Flag, Ready
to work on. Decide to use what is best. use approaches without any licensing
issues. if needed create these yourself. they can be added as a context menu
item or if the CMD+Shift+i is available it can be the shortcut" —
`dev-vault/Tool notes.md`, not originally picked up into Phase 1/2.

**Status:** done

## Goal

Let a node carry one of 6 status markers, shown as a small badge on the
node, settable from the right-click context menu, a `Cmd+Shift+I` quick-pick
menu, or by clicking an existing badge.

## Decisions (CLAUDE.md rule 3 — asked the user before implementing)

- **Rendering:** self-drawn inline SVG glyphs (same technique as the
  existing fold badge / cross-doc relation badge) over bundled raster
  images — free performance cost, no decode/network, crisp at any zoom. See
  DECISIONS.md (2026-07-20 entry) for the full cost comparison.
- **Shortcut UX:** `Cmd+Shift+I` opens a quick-pick menu, not a
  cycle-on-repeat-press.

**Follow-up additions (same day, after initial ship):**
- Context-menu items with a keyboard shortcut now show it as a muted,
  parenthesized hint next to the label (`MindMapView.menuItemTitle`) — the
  shortcuts existed but weren't discoverable anywhere in the UI.
- The "Completed" badge was renamed to "Done" (`BadgeKey`: `"completed"` →
  `"done"`) and given a direct-toggle shortcut, `Cmd+Shift+D`
  (`Controller.toggleStatusBadge`), so applying/clearing the most common
  status doesn't require opening a menu at all. See DECISIONS.md for both.

## Design

### Data model — `src/model/statusBadges.ts`, `src/model/types.ts`

`BadgeKey` + `BADGE_DEFS` (key/label/glyph) is the single source of truth,
consumed by mutations, the renderer, and the context/quick-pick menus:

```ts
export type BadgeKey = "done" | "started" | "blocked" | "red-flag" | "green-flag" | "ready";
```
`BadgeDef` also carries an optional `hotkey` (mac/other display strings) for
the one badge with a direct-toggle shortcut ("done") — used both by
`Controller.toggleStatusBadge`'s caller and by the menu-item hint.
`MindNode.statusBadge?: string` — deliberately `string`, not `BadgeKey`, so
a value written by a future plugin version that this version's
`BADGE_DEFS` doesn't recognize still round-trips through save/load instead
of being silently dropped (`getBadgeDef` just returns `undefined` for it,
so it renders nothing but survives serialize/reparse).

### Mutation + Controller

`mutations.setStatusBadge` mirrors `setFolded`'s shape exactly.
`Controller.setStatusBadge` mirrors `toggleFold` — goes through the
undo/redo `CommandStack`. `cloneSubtree` copies `statusBadge` through (like
`folded`, it's semantic per-node state, not positional state like
`manualPos`/`colorKey`).

### Persistence — `sync/metadata.ts`, `sync/serializer.ts`

Follows the existing `mindmap:` frontmatter convention exactly: `NodeMeta`
gained `badge?: string`; `hasMeta`/`nodeHasPersistableMeta` both check it so
a badge-only node still earns a `^blockid`; `extractMindmapData` captures
`badge: <value>` via regex without validating against `BADGE_DEFS` (forward
compat, see above); `serializer.ts`'s `collectMeta` includes it.

### Rendering — `src/render/SvgRenderer.ts`

`upsertStatusBadge` (called from `upsertNode` right after
`upsertCrossDocBadge`) follows the exact "always call, cheap no-op if
nothing changed" pattern the two existing badges use — a `getBadgeDef`
lookup, then create-if-missing + attribute writes. Positioned at the node's
top corner *opposite* the cross-doc badge (`x = side === "L" ? w : 0, y =
-8` vs. the cross-doc badge's `x = side === "L" ? 0 : w`), so the two never
collide even on a node with both. Color comes from a CSS class per key
(`mm-status-badge-<key>`), not inline styles, matching the `mm-color-cN`
per-node-color pattern — uses Obsidian's built-in theme-aware `--color-*`
variables. Clicking the badge opens the same quick-pick menu as
`Cmd+Shift+I` (`onStatusBadgeClick`/`setStatusBadgeClickHandler`, wired next
to the existing `.mm-fold-badge`/`.mm-cross-doc-badge` branches in
`onClick`).

### Context menu + `Cmd+Shift+I` — `src/view/MindMapView.ts`

Obsidian's `MenuItem` (this project's API version) has no `setSubmenu`, so
the 6 statuses are flat items in `showNodeMenu`, each `.setChecked(...)`
against the node's current `statusBadge`, plus "Clear status" when one is
set. `MindMapView.addStatusBadgeMenuItems(menu, node)` builds that item list
once, shared by `showNodeMenu`, the `Cmd+Shift+I` handler, and the
badge-click handler (`showStatusBadgeMenuForNode`, which positions the menu
via the existing `SvgRenderer.getNodeScreenRect` — the same helper
`openInlineEditor` uses). `Mod+Shift+I` was confirmed free (no existing
binding in `main.ts` or `MindMapView.onKeyDown`; established bindings are
B/Z/C/L/G).

## Implementation steps

1. `src/model/statusBadges.ts` — `BadgeKey`, `BADGE_DEFS`, `getBadgeDef`.
2. `types.ts` (+field), `mutations.ts` (`setStatusBadge`, `cloneSubtree`
   passthrough).
3. `sync/metadata.ts`, `sync/serializer.ts` — frontmatter persistence.
4. `Controller.setStatusBadge`.
5. `SvgRenderer` — `StatusBadgeDom`, `upsertStatusBadge`, click wiring.
6. `styles.css` — `.mm-status-badge*` rules.
7. `MindMapView` — shared menu-item builder, `showNodeMenu` section,
   `Cmd+Shift+I` in `onKeyDown`, badge-click handler wiring.

## Tests

- `test/controller.test.ts` — `setStatusBadge` set/clear + undo/redo, no-op
  on unknown id, badge survives copy/paste clone.
- `test/statusBadgePersistence.test.ts` (new, mirrors
  `foldPersistence.test.ts`) — full serialize→reparse round-trip, block-id
  minting, clearing drops the frontmatter entry, combines with fold state in
  one entry, an unrecognized badge value round-trips instead of being
  dropped, unrelated frontmatter keys survive a set/clear cycle.
- `test/metadata.test.ts` — `extractMindmapData`/`applyMindmapDataToTree`/
  `nodeHasPersistableMeta` unit cases for the new `badge` field, mirroring
  the existing `externalRef` cases.
- `test/serializer.test.ts` — `serializeSubtree` strips `badge:` the same
  way it already strips `^blockid`/`pos:`.
- `test/controller.test.ts` — `toggleStatusBadge` sets/clears/overrides.
- `npm test`: 398/398 passing (was 385 before this item).

## Performance

Rides entirely on already-measured-cheap mechanisms — see DECISIONS.md's
entry for the full cost comparison against the raster-image alternative.
Not perf-relevant enough to warrant a dedicated benchmark run per the
Per-item workflow (only 03/05/07 needed one): `upsertStatusBadge` matches
the existing `upsertBadge`/`upsertCrossDocBadge` cost profile exactly, and
is strictly cheaper than the closest measured precedent (`bench:images`,
~43ms to mount 200 per-node `<image>` elements on a 201-node map). No new
dependencies.

## Open questions

None blocking.

## Implementation notes

Implemented as planned, plus the two follow-up additions above (menu-item
hotkey hints, "Done" rename + `Cmd+Shift+D`). `npm test` (398/398) and
`npm run build` both pass. Manual verification in the dev vault
(`npm run dev`, Obsidian) still pending — see the workflow checklist: set
each of the 6 statuses via right-click menu, `Cmd+Shift+I`, `Cmd+Shift+D`
(Done only), and by clicking an existing badge; confirm glyph/color/tooltip,
"Clear status", the hotkey hints render correctly aligned, survival across a
plugin reload (frontmatter round-trip) and a copy/paste, and no collision
with the fold badge / cross-doc badge / image thumbnail when a node has more
than one.
