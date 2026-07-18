# Architectural Decision Records

## 2026-07-18 — Feature (M-R1a/M-R2): same-document relation arrows + cross-document badges

**Scope:** `plans/PLAN-relations-and-ux-fixes.md`'s R1 ("same-document
relations as a toggleable arrow") and R2 ("cross-document relation
indicator"), milestones M-R1a then M-R2. Resolved decisions honored as
given (not re-litigated): D1 storage = inline markdown same-file block
links (`[[#^id]]`); D2 authoring = existing Ctrl/Cmd+K editor only, no
drag-to-connect; D3 cross-doc display = badge + click (minimum); D5 arrow
fidelity = cheap cubic-Bezier + arrowhead, not routed/animated.

**Resolution & caching (new `src/model/relations.ts`):** `resolveRelations
(model, fileBasename)` walks the tree, classifying each link a node's text
already has (via `parseTextSegments`, reused from `model/links.ts`) into
`"same-doc"` (a same-file block ref `[[#^id]]`/`[[<basename>#^id]]` whose
id is in `model.byId`), `"cross-doc"` (any other wikilink or mdlink — a
different note, a URL, a vault path), or dropped entirely (same-file but
not a resolvable block ref: a dangling id, a plain heading link, or a
self-link). The expensive part (`parseTextSegments`'s regex) is cached per
node (`relationLinksCache`/`relationLinksCacheText`), invalidated by
comparing against the node's current `text` — mirrors `getDisplayText`'s
already-established fast path (skip entirely when there's no `[` at all).
Classification against `model.byId` is *not* cached (a cheap Map lookup,
and it must reflect the current tree, which can change independent of any
one node's own text). Wired into `MindMapView.onChange`/`buildFromScratch`/
external-reparse — i.e. mutation-commit granularity, never per keystroke
(keystrokes inside the inline editor never touch the model at all, per
`InlineEditor`'s existing design) — so this is an O(n) walk per edit, same
class as `assignMissingColors`/`assignMissingSides`/`computeLayout`, which
already run there every time.

**Block-id forcing for round-trip (R1a item 2):** a same-doc relation
target must keep a persistent (non-synthetic) `^id` across serialize even
if it has no fold/pos/manual-width of its own. `resolveRelations` sets a
new `MindNode.isRelationTarget` flag on every current relation's target
(clearing it from every node first, since a node can stop being a target
when the referencing link is edited/removed); `nodeHasPersistableMeta`
(sync/metadata.ts) now also checks this flag, so `ensurePersistentIds`
mints an id for it and `serializeNode` keeps writing the ` ^id` suffix —
`collectMeta`'s frontmatter entry for such a node ends up all-`undefined`
fields, which `hasMeta` already filters out, so no spurious empty
frontmatter entry is written, only the plain line suffix. Confirmed by a
parse→resolve→ensurePersistentIds→serialize→parse round-trip test
(`test/relations.test.ts`) and, at scale, by `bench-relations.mjs`'s
round-trip check on 200/500 injected relations.

**Authoring-time id minting is a separate concern from the above:** if the
link editor embedded a relation target's *current* (possibly still
synthetic) id into the link text and only relied on the next
`ensurePersistentIds` pass to mint a real one, that pass mints a *new*
random id and repoints `byId` — but has no way to find and rewrite the
link text elsewhere that already embedded the old synthetic id, silently
breaking the just-authored relation. New `sync/metadata.ts`
`forcePersistentId(node, byId, mintBlockId?)` avoids this by minting
*before* the link text is built (`MindMapView.openLinkEditor`'s `onSave`,
when `result.relationTargetNodeId` is set) — a synthetic id is never
written into markdown in the first place, so there's nothing for a later
pass to invalidate. Not routed through the undo/redo command stack (same
as `ensurePersistentIds`'s own minting) — ids are internal identity, not
user-visible state undo needs to restore.

**Authoring UX (D2a, "implement minimally within the existing link-editor
surface, stop and ask if this is a substantial fork"):** judged *not* a
substantial fork — `LinkModal` gained one optional dropdown ("relation to
a node in this map"), built from a document-order walk of `model.byId`
excluding the node being edited (labels: link-stripped node text,
truncated to 48 chars). Picking an option and saving skips the free-text
Target field entirely (`LinkModalResult.relationTargetNodeId` short-
circuits `buildLinkText`); the dropdown is omitted outright on a
single-node map (nothing to relate to). Reopening the editor on a node
whose sole link already resolves as a same-doc relation pre-selects that
target and — since a bare `[[#^id]]` has no alias to show as a label —
prefills the target *node's own text* instead of the raw `#^id` string.
Not unit-tested directly: `LinkModal extends obsidian.Modal`, and the
`obsidian` package is types-only (no runtime implementation, `main: ""`)
— same untestable-without-a-hand-rolled-mock situation `MindMapView`
itself is already in (see `ensureVisible.test.ts`'s own note on this);
verified by code review + the manual dev-vault steps below instead.

**Rendering — new `relationsG` layer + dirty-tracking/culling
(SvgRenderer.ts):** a third `<g>` between `edgesG` and `nodesG` (arrows
read as under node boxes, above branches). `SvgRenderer.update`/`mount`
now take an optional `activeRelations: {sourceId,targetId}[]` — computed
once by the caller (`resolveRelations`'s return value) rather than
re-derived inside the renderer, so `update` stays a pure "draw what I'm
given" step. `updateRelations()` mirrors `upsertEdge`'s exact discipline:
rebuild each relation's path string (cheap — a single cubic Bezier, O(1)
per relation, unlike `edgePath`'s 16-sample tapered-ribbon polygon) and
only write the DOM `d` attribute if it actually changed; skip an endpoint
that's folded away (O(1) lookup against a fold-visible-id snapshot taken
once per `update()`, not a fold-tree re-walk) or fully outside the
viewport + margin above the existing 300-node `CULL_THRESHOLD`. Called
from `recull()` too (pan/zoom), exactly like edges already are — this is
*not* "recomputing all arrows on pan/zoom" in the sense the plan warns
against: it's the same membership-test-and-skip-if-unchanged pattern
edges already pay on every pan/zoom frame above the culling threshold, and
`bench-relations.mjs`'s pan-dispatch numbers (3.0ms/0.2ms at 200/500
relations) confirm it stays cheap. `showRelations` (new setting, default
on) is a constructor param, not a live per-`update()` check — when false,
`activeRelations` is never even stored and `updateRelations` never runs,
so "off" means zero relation work, not a hidden layer (same "baked in at
construction, next reopen" convention `animationNodeThreshold`/
`writeDebounceMs` already use). Visual: dashed, thin, `--text-faint`
stroke — deliberately not branch-palette-colored, so a relation reads as a
cross-link rather than a hierarchy edge (D5-adjacent design constraint the
plan calls out explicitly).

**R2 cross-doc badge:** a small per-node badge (↗ glyph), created lazily
inside the existing per-node dirty-tracked `upsertNode` path (same cost
profile as the R14 fold badge) whenever `node.resolvedRelations` has a
`"cross-doc"` entry — reuses R1a's cached classification exactly as the
plan specifies, no separate resolution pass. Click routes through a new
`SvgRenderer.setCrossDocBadgeClickHandler` to `MindMapView
.openCrossDocRelation`, which reuses the *existing* `openLink` method
(wikilink → `openLinkText`; mdlink external URL → `window.open`; mdlink
vault path → `openLinkText`) rather than reimplementing navigation. Not
gated by `showRelations` (that setting is scoped to "the arrow"/relation
layer per the plan's own wording; R2's badge has no toggle in the plan).
A node with several cross-doc relations only opens the first on click — a
target picker for that case is out of scope for D3's "minimum" design.

**Benchmark checkpoint (mandatory before M-R2, see the dedicated entry in
`benchmarks.md`):** `bench:m1`/`bench:m2` unchanged (no regression);
new `bench:relations` (2,000/5,000-node fixtures, 200/500 relations
injected) shows `resolveRelations` itself costs 1.0–1.4ms even at that
relation count, Tab/rename stay comfortably under the 50ms budget, and
pan-dispatch (culling-only, no re-resolution) is 0.2–3.0ms. No budget
regression — proceeded to M-R2 per the checkpoint's own gate.

**Not built (explicitly out of scope per resolved decisions, not a
silent cut):** M-R1b drag-to-connect authoring gesture (D2, cut by the
user); richer cross-doc display — hover-preview or ghost-stub nodes (D3);
rich/animated/routed relation arrows (D5). All three have a clear
re-open path (the classification/rendering plumbing underneath doesn't
need to change) if requested later.

## 2026-07-18 — Fix (F2 follow-up): keep the completed node in view after commit, not just at create-time

**Bug (reported after the initial F2 fix landed):** centering on a new node
worked at create-time but was lost on completing it — typing text and pressing
Enter made the view appear to "jump back" and lose the node. **Root cause:** it
is *not* a viewport reset (`SvgRenderer.mount`/`update` never touch the pan
transform, which lives on the surviving `viewportG`). It is layout reflow: the
new node is created *empty* (a tiny box), so the create-time minimal-pan brings
that tiny box just inside the viewport margin; typing real, often multi-line
text and committing then reflows the branch and pushes the now-larger node back
out past the edge — and the original F2 fix only panned at create-time, so
nothing followed the node to its final position.
**Fix:** re-run the same minimal-pan `ensureNodeVisibleForEdit(nodeId)` in the
inline editor's `onCommit` handler, after `commitRename` (so layout reflects the
final text). No-op (D4) when the node is still comfortably visible, so an
already-visible F2/dblclick edit still causes no view movement; only a node that
reflow actually pushed off-screen gets re-panned. Verified via the existing
`ensureVisible.test.ts` primitive coverage + manual dev-vault check
(`MindMapView` itself isn't unit-instantiable — needs the Obsidian API).

## 2026-07-18 — Fix (F2): new node brought into view before its editor opens, via minimal-pan (D4)

**Bug (plan item F2, `plans/PLAN-relations-and-ux-fixes.md`):** a newly
created node (Tab/Enter/Shift+Enter) could land outside the current
viewport — or, on a >300-node map, be culled out of the DOM entirely (see
`SvgRenderer`'s `CULL_THRESHOLD`) — with nothing panning to it first, so
the inline editor opened off-screen or (culled case) not at all, since
`getNodeScreenRect` returned `null`.
**Decision D4 (asked, resolved):** minimal-pan / ensure-visible — pan only
when the new node would be off-screen, and only far enough to bring it
comfortably into view; never recenter/re-render when it's already visible.
Chosen over "always `centerOnWorldPoint` the new node" (the more literal
reading of the source note) because it avoids the whole map lurching on
every plain Tab/Enter when the new node is already on screen (the common
case) and skips a re-render entirely then, at zero cost — `focusNode`
(search-jump) keeps using the existing always-center `centerOnWorldPoint`
for its own use case, unchanged.
**Implementation:** new `SvgRenderer.ensureWorldRectVisible(rect)` — pans
`view.tx/ty` by the minimum screen-space delta needed to clear a fixed
60px comfort margin on every side (returns `false`/no-ops if the rect
already clears it), and — unlike `centerOnWorldPoint`/the drag/wheel pan
handlers — applies the transform and re-culls **synchronously**, not via
the rAF-batched `scheduleApplyViewport`. That's required, not just faster:
`MindMapView.onEditRequest` calls it immediately before
`openInlineEditor` reads `getNodeScreenRect`, and a culled-out node has no
DOM element (hence no measurable rect) until a re-cull creates one — the
rAF-batched path would leave that rect `null` for one frame. Wired into
the existing `onEditRequest` funnel (not duplicated per shortcut), so it
covers Tab/Enter/Shift+Enter uniformly; F2/dblclick-on-an-existing-node
also passes through it but is a no-op in the normal case (node already
visible). `pasteImageAsChild` does not currently call `emitEditRequest`
(no editor opens for it today), so this fix doesn't change its behavior —
flagged as an open question below, not decided silently.
**Performance:** a pan is a cheap transform write + re-cull, same
mechanism already used for search-jump; the common case (new node already
visible) does zero extra work (early-return before any DOM write). Well
under the Tab/Enter → editable budget (<50ms target / 100ms ceiling).
**Tests:** `test/ensureVisible.test.ts` — an off-screen/culled node's
screen rect lands fully within the viewport after the call, synchronously
(no rAF wait); a freshly `addChild()`-ed off-screen node likewise; a node
already comfortably visible leaves the viewport `transform` attribute
unchanged (`changed === false`).

## 2026-07-18 — Fix (F1): colorKey-only-on-first-level-child invariant (paste/move color bug)

**Bug (plan item F1):** a first-level branch's `colorKey` is only
meaningful on a direct child of root — `resolveNodeColorKey` walks up to
the nearest ancestor carrying one. `cloneSubtree` copied `colorKey`
verbatim, so copy/pasting a colored first-level branch *inside* another
branch left the pasted subtree's root node carrying its old, now-stale
`colorKey`, shadowing the target branch's color instead of inheriting it.
The identical bug existed on the drag-reorder path (`moveNode` never
touched `colorKey` at all).
**Choice (design B from the plan, the recommended one over a
paste-only fix):** enforce "`colorKey` lives only on a direct child of
root" as an invariant inside `assignMissingColors`
([colors.ts](../src/render/colors.ts)) — before assigning missing
first-level colors, clear `colorKey` on every node whose parent isn't
root. This runs every `onChange`, so it self-heals paste, drag-reorder,
and any future mutation path in one place, instead of requiring a
`colorKey`-drop fix in every mutation that can reparent a node. Paired
with also dropping `colorKey` in `cloneSubtree`
([mutations.ts](../src/model/mutations.ts)), matching how it already
drops `manualPos`/`branchSide`, so a clone is clean the instant it's
created rather than relying solely on the next `assignMissingColors` pass.
**Alternative considered (design A, rejected as incomplete):** drop
`colorKey` in `cloneSubtree` only — fixes paste but not drag-reorder
(`moveNode`), so the identical bug would still reproduce via drag.
**Cost:** O(nodes) clear folded into the existing per-`onChange`
`assignMissingColors` walk — no new pass, nothing added to the keystroke
hot path.
**Tests:** `test/colors.test.ts` — a stale `colorKey` on a non-first-level
node is cleared and the node re-resolves to its actual ancestor branch's
color; a first-level branch's own `colorKey` survives repeated calls.
`test/controller.test.ts` — paste a colored first-level branch inside a
differently-colored branch → resolves to the target's color, not the
original's; paste at root level → gets a fresh, distinct color; drag
(`moveNode`) a first-level branch inside another branch → adopts the
target's color the same way. No existing test asserted `cloneSubtree`
preserves `colorKey`, so nothing needed updating there.

## 2026-07-07 — Fix: Rebalance hotkey moved to a real Obsidian command (Ctrl/Cmd+Shift+B)

**Choice:** the Rebalance shortcut is now registered via `addCommand({hotkeys: [...]})`
in [main.ts](../src/main.ts) as **Ctrl/Cmd+Shift+B**, not the raw
`MindMapView.onKeyDown` listener described in the 2026-07-03 entry below.
**Why:** that in-view Ctrl/Cmd+B handler never actually fired — Obsidian's
own global hotkey manager resolves its default "Toggle bold" binding for
plain Ctrl/Cmd+B via a capture-phase listener before the event ever bubbles
to a view-level `keydown` listener, so the "avoid a double-fire/precedence
conflict" reasoning in the earlier entry was backwards: registering through
`addCommand` is what actually reaches the view, not what conflicts with it.
Shifted to Ctrl/Cmd+**Shift**+B (rather than keeping plain Ctrl/Cmd+B on
`addCommand`, which Obsidian's `checkCallback` context-disambiguation would
have made work too) specifically so Settings → Hotkeys doesn't show it as a
conflicting binding against Obsidian's own default at all, per the user's
request not to shadow an existing Obsidian shortcut.
**Regression test:** none added — `MindMapView` isn't unit-testable against
real Obsidian hotkey resolution; verified manually in the dev vault.

## 2026-07-06 — Feature: image display in nodes

**Choice:** nodes whose text contains an image embed (`![[photo.png]]` or
`![alt](path/to.png)`) render a fixed-size thumbnail below the text.
- **Detection (pure, testable):** `parseEmbeds`/`isImageTarget`/
  `getImageEmbed` in [links.ts](../src/model/links.ts) — an embed is any
  `![[target]]`/`![alt](target)`, and `getImageEmbed` returns the first one
  whose target has an image extension (doesn't require the embed to be the
  *whole* node text, unlike `getSoleLink` — a caption alongside an image is
  common). `getImageEmbed`'s own fast path (skip the regex unless the text
  contains `![`) mirrors `getDisplayText`'s existing one for the same
  per-layout-pass-multiple-calls reason.
- **Layout:** `computeNodeBox` ([layoutEngine.ts](../src/layout/layoutEngine.ts))
  now returns an `imageBox` (node-local x/y/w/h) alongside `w`/`h` when
  `getImageEmbed` finds one — a **fixed** depth-scaled thumb size
  (`imageThumbWidth`/`imageThumbHeight`/`imageThumbGap`, new `LayoutConfig`
  fields, decision A's chosen policy), not derived from the image's own
  intrinsic dimensions. This is the crux of decision A: layout can commit
  to a box size before the image has even started loading, so there's
  never a reflow when a load completes. `computeNodeBox`'s parameter type
  narrowed from the full `LayoutConfig` to a new `NodeBoxConfig` (exactly
  the fields it actually uses) so `SvgRenderer` — which re-derives the same
  `imageBox` at render time via the same function, same reasoning as
  `wrapCeilingFor` needing to match the layout pass's wrap math exactly —
  doesn't have to widen its own narrower `TextMetricsConfig` to the full
  `LayoutConfig` just to call it.
- **Rendering:** `SvgRenderer` creates a placeholder rect + `<image>` +
  "missing" glyph group lazily, only for a node whose box has an
  `imageBox`, inside the same text/size/side-changed gate `renderNodeText`
  already uses (recomputing `computeNodeBox` there is real work — a wrap
  pass — so it's not done on every `upsertNode` call the way the cheap
  `upsertBadge` is). `href` is resolved via a new `setImageResolver`
  callback (view-supplied, since resolving needs `app.metadataCache`/
  `app.vault`) — CSS toggles the placeholder/image/missing-glyph via
  `load`/`error` listeners setting `.mm-image-loaded`/`.mm-image-error` on
  the group, not JS-driven style writes.
- **Lazy loading is free, not new machinery:** decision A's "only in/near-
  viewport nodes get a `href`" requirement rides entirely on the *existing*
  viewport-culling mechanism (`applyVisibleSet`) — above the 300-node
  culling threshold, an off-screen node's whole DOM (image included)
  doesn't exist until `upsertNode` creates it on scrolling into view, so
  no separate lazy-load bookkeeping was needed at all.
- **Click behavior:** a new `setImageClickHandler` (separate from
  `setLinkClickHandler`, even though the embed's kind/target shape is
  identical to a link's) — clicking a thumbnail opens the image in a
  **new tab** (`openLinkText(..., true)`), unlike a regular link click
  (current tab) — decision A's "click opens the image in an Obsidian
  modal/tab" needs the map to stay open, same reasoning as "Go to note
  section" always opening in a new tab.
- Editing: no change — the inline editor already shows the raw text
  as-is; the image is purely a render-time affordance.
**User decision (perf rule 3 — thumbnail policy):** **A** — small fixed
thumb (~120px), click opens the image, chosen over (B) aspect-ratio-sized
inline images (would need to read intrinsic size on load → one-time
reflow per image, more memory) and (C) icon-only marker (cheapest but
least visual value).
**Cost:** confirmed via new `npm run bench:images` (201-node map, every
node with an image embed — the worst case at that node count): parse+
layout ~4ms, mount ~41-43ms (creates and resolves all 200 image elements —
this is the *unlazy* case since 201 nodes is below the culling threshold),
well inside the 1s/2,000-node open budget; see `benchmarks.md`. Real
decode/paint cost and pan fps with actually-loaded images are unverifiable
in jsdom — flagged there as needing a real Obsidian window check.
**Source:** `plans/07-feature-image-display.md`.

## 2026-07-06 — Feature: tree copy to the OS clipboard

**Choice:** copying/cutting now also mirrors the subtree(s) to the OS
clipboard as plain markdown, and pasting can tell an internal copy/cut
apart from something copied outside the plugin.
- **Copy side:** new `serializeSubtree`/`serializeSubtrees`
  ([serializer.ts](../src/sync/serializer.ts)) emit a node's subtree (or
  several independent ones) as a plain nested markdown list (`- text`,
  2-space indent per level) — no ` ^blockid` suffixes or mindmap
  frontmatter metadata, which are internal identity/persistence details
  that must not leak into (or collide once pasted back into) another
  document. `Controller.getClipboardMarkdown()` exposes this for whatever
  is currently on the internal `MindNode[]` clipboard (the item-05
  change); `MindMapView` calls it right after `copySelected`/`cutSelected`
  and writes the result via `navigator.clipboard.writeText` (fire-and-
  forget — a denied/unavailable permission shouldn't block the
  already-completed internal copy).
- **Paste side:** `MindMapView` reads the OS clipboard
  (`navigator.clipboard.readText()`) and compares it against the text it
  last wrote itself (`lastWrittenClipboardText`, view-local state). If it
  differs, the user copied something from *outside* the plugin, so it's
  parsed via the new `parseExternalPaste`
  ([parseExternalPaste.ts](../src/sync/parseExternalPaste.ts)) — reusing
  the existing heading/list parser rather than a separate one, so anything
  that already round-trips through this plugin (including our own
  `serializeSubtree` output) parses back identically. Three cases: a
  document starting with a real H1 becomes one subtree (headings nest);
  list/heading structure without a leading H1 becomes N top-level
  subtrees; plain text with no markers at all becomes one leaf node per
  non-blank line. Every returned node gets a fresh id top to bottom (never
  reuses the source text's ids — mirrors `cloneSubtree`'s reasoning).
  `Controller.pasteSubtrees(nodes)` inserts them the same way
  `pasteToSelected` does (one undo step, shares a new private
  `bulkInsert` helper with it).
- **Design call — where the raw `navigator.clipboard` I/O lives:** entirely
  in `MindMapView`, not `Controller`. `Controller`'s mutation methods
  (`pasteToSelected`/`pasteSubtrees`) stay fully synchronous and testable
  without stubbing the clipboard API — the subplan's own stated
  preference ("View reads the clipboard and hands text in — prefer the
  latter to keep Controller synchronous and testable"). This needed no
  Controller constructor changes (no injected clipboard adapter), so every
  existing `new Controller(model)` test call site kept working unchanged.
- Context menu (plan item 04) gained "Copy subtree as markdown" (always
  the right-clicked node specifically, regardless of any active multi-
  selection, and doesn't touch the internal clipboard — so it doesn't
  disturb a pending Ctrl+C/X paste target).
**Alternatives:** write both an OS-clipboard adapter and keep Controller's
paste async — rejected per the subplan's explicit guidance above; the
sync-Controller/async-View split is simpler and keeps the existing test
suite's `new Controller(model)` call sites untouched.
**Cost:** serialization/parsing is O(subtree) once per user-paced copy/
paste — irrelevant to the frame/keystroke budgets. Clipboard I/O is async
and entirely off the render path. No new dependency (`navigator.clipboard`
is a standard Electron/browser API already available, not a package).
**Source:** `plans/06-feature-tree-copy-os-clipboard.md`.

## 2026-07-06 — Feature: multiple selection (bulk copy/cut/paste/delete)

**Choice:** `Controller` gains `selectedIds: Set<string>` alongside the
existing `selectedId` (now specifically the *primary*/anchor — keyboard
nav target, inline-editor target, Shift+click range anchor). A private
`setPrimarySelection(id)` keeps every existing single-target flow (Tab,
Enter, delete, cut, reveal-and-select, etc.) maintaining the invariant
`selectedIds` is always exactly `{selectedId}` (or empty) outside an active
multi-selection. Three new public methods add the multi-select surface:
`toggleSelection` (Ctrl/Cmd+click — membership toggle, primary follows the
last node toggled on), `selectRange` (Shift+click — contiguous sibling run
between the anchor and the target; cross-branch falls back to a plain
single selection since the subplan explicitly scoped Shift+click to
siblings only), and `collapseSelection` (Esc). Bulk operations go through
a new private `normalizedSelection()` (drops any selected node whose
ancestor is also selected — prevents double-clone/double-delete — sorted
into document order via a new `compareDocumentOrder` comparator that walks
each node's ancestor path to a shared parent, O(depth) per comparison,
*not* an O(whole-tree) traversal to build a global order index) and a
private `bulkDelete()` (one `stack.execute` per op — do: delete each node;
undo: restore each in reverse deletion order, same reasoning as a single
delete generalized to N nodes — so cut/delete of any selection size is one
undo step, and `emitChange()` fires exactly once regardless of selection
size). `Controller.clipboard` changes from `MindNode | null` to
`MindNode[] | null` (document-ordered clones) — single-selection is just
the length-1 case of the same path; this is the exact change
`MASTER-PLAN.md`'s dependency notes anticipated for plan item 06 (tree
copy) to build on. `SvgRenderer` mirrors this with `setSelection(ids,
primaryId)` (symmetric-diff restyle against the previous set — O(Δ), same
target as `selectNode`'s existing O(1) single-selection case, not
O(visible)); `selectNode(id)` becomes a thin single-selection wrapper
around it so the existing test and call site keep working unchanged.
Multi-selected nodes get the existing `.mm-selected` look; the primary
additionally gets `.mm-selected-primary` (thicker outline) so it stays
visually distinct. `MindMapView`'s node-click handler now reads
`evt.ctrlKey/metaKey`/`evt.shiftKey` to route to `toggleSelection`/
`selectRange`/plain `select`.
**Rubber-band (drag-rectangle) selection:** deferred, per the subplan's own
proposal — adds pointer-mode complexity alongside the existing pan/drag/
resize gestures, and Ctrl+click/Shift+click already cover the bulk-edit use
case the source note asked for. Not a performance-vs-feature trade-off (no
budget is at risk either way), so this was a scope call, not something
requiring a rule-3 stop.
**Cost:** selection changes are O(Δselection); bulk ops are O(affected
subtrees) plus one relayout/render, same order as a single-node op today —
confirmed via `bench-m2` (no regression on the shared relayout/render
path), see `benchmarks.md`.
**Source:** `plans/05-feature-multiple-selection.md`.

## 2026-07-06 — Feature: node context menu + "Go to note section"

**Choice:** `SvgRenderer` gets a `contextmenu` listener (`onContextMenu`,
same `evt.target.closest(".mm-node")` hit-test pattern as `onPointerDown`
— right-click doesn't participate in the drag pointer-capture flow that
forced `onClick`'s more roundabout `elementsFromPoint` resolution, so the
simple version is enough) exposed via `setNodeContextMenuHandler`.
`MindMapView.showNodeMenu` builds an Obsidian-native `Menu` (selects the
node first, so menu actions and the existing keyboard shortcuts share the
same "operates on the selection" semantics) with "Go to note section" plus
the standard actions (Edit/Add child/Add sibling/Edit link/Fold/Copy/Cut/
Paste/Delete) — all thin wrappers around existing `Controller` calls.
"Go to note section" (`goToNoteSection`) resolves a jump target in three
tiers via the new `resolveGoToTarget`/`findNodeLine`
([goToSection.ts](../src/sync/goToSection.ts)):
1. **Block id** — if the node currently has persistable metadata (fold/
   manual position/width — exactly the condition under which
   `serializeMindMap` writes a ` ^blockid` suffix), use Obsidian's native
   block reference (`openLinkText("#^" + id, ...)`).
2. **Heading text** — if the node is a heading (depth <= `headingDepth`)
   with text that's unique among headings in the file, a heading-text link
   (`openLinkText("#" + text, ...)`), same resolution Obsidian uses for
   `[[note#Heading]]`.
3. **Line number fallback** — otherwise (list nodes without a persisted
   id, or duplicate heading text): `findNodeLine` mirrors
   `serializeMindMap`'s exact line-emission order structurally (tree
   position, not text search — so duplicate text elsewhere can't confuse
   it) to compute the 0-based line, then `leaf.openFile(file, { eState: {
   line } })`.
Always opens in a **new tab** (`openLinkText(..., true)` / `getLeaf(true)`)
so the mind map stays open, and flushes the pending debounced write
first (reusing `flushPendingWrite()` from the Ctrl+M toggle entry above)
so the destination shows current, not stale, content.
`MindMapModel` gained a `hasExplicitRootHeading` boolean (set in
`parser.ts`, true only when the file's first heading was a real `# H1`
that became the root) so "Go to note section" can be disabled for a
synthetic root — there's no real H1 line to jump to yet in that case.
**Alternatives:** always use the line-number fallback — rejected: block-id/
heading-text links survive the user reordering/editing other parts of the
file (Obsidian's own link resolution keeps working), where a raw line
number would silently point at the wrong content after any edit above it.
**Cost:** menu building and target resolution are on-demand, user-paced
(one right-click), not per-frame/per-keystroke work; `findNodeLine` is
O(nodes before the target) once per invocation, only when the cheaper
tiers miss. No new dependency (`Menu` is already part of the `obsidian`
package).
**Source:** `plans/04-feature-node-context-menu.md`.

## 2026-07-06 — Feature: Ctrl/Cmd+M toggles markdown <-> mind map on the same leaf

**Choice:** new `toggle-mindmap-view` command (default hotkey `Mod+M`) in
`main.ts`. From a `MarkdownView` on a `.md` file, switches that *same*
leaf to `VIEW_TYPE_MINDMAP` via `leaf.setViewState`. From a `MindMapView`,
flushes the pending debounced write (`MindMapView.flushPendingWrite()`,
a new public wrapper that cancels the debounce timer and calls the
existing `writeNow()` only if there's actually unwritten data) before
switching the leaf back to `"markdown"` — otherwise the markdown editor
could open on stale (pre-last-edit) content, since the write-back is
debounced by up to `writeDebounceMs`. Same-leaf switching (not
`getLeaf("tab")`, which the pre-existing `open-as-mindmap` command still
uses for the file-menu entry) means repeated toggling doesn't pile up
duplicate tabs, and Obsidian's navigation history still records the
view-state change, so back/forward keeps working.
**Alternatives:** always open a new tab (existing `open-as-mindmap`
behavior) — rejected by the source note itself, which asks for a mode
*toggle*, not a new view each time.
**Cost:** toggling adds one `writeNow()` flush (already within the <50ms
write-back budget) on top of the existing view-open cost, which already
meets its own budget. No new dependency.
**Source:** `plans/08-feature-ctrl-m-toggle.md`.

## 2026-07-06 — Anticlockwise document-order branch sides (supersedes part of "sticky left/right sides")

**Choice:** left/right side assignment changed from per-node weight-greedy
(interleaved, no relationship to document order) to a **contiguous
document-order split**: branches `1..K` (document order) go Left, `K+1..N`
go Right, where K is chosen to minimize the weight difference between the
two groups. `sides.ts`'s `assignMissingSides` now has two paths: if *no*
branch has a side yet (first open, or right after Rebalance clears them
all), it computes a fresh contiguous split from scratch
(`assignInitialSplit`); if *some* branches already have sides (the normal
edit-time case — one new first-level branch just appeared), each side-less
branch inherits the side of its nearest already-assigned neighbor in
document order, which extends the existing contiguous run instead of
picking whichever side is currently lighter (the old policy) — weight-
greedy could place a newly-appended branch on the "wrong" side purely by
weight, breaking the document-order contiguity this whole change exists to
guarantee. `layoutEngine.ts`'s `partitionChildren` reverses the right-side
array before `layoutSide` sees it, so the right side reads bottom→top in
document order while the left side keeps reading top→bottom, per the
user's chosen geometry ((c): left top→bottom, then right bottom→top,
i.e. strict anticlockwise starting top-left).
**User decisions (perf rule 3 — see `plans/03-ux-anticlockwise-node-order.md`):**
D1 (when the split may move): **A** — only ever recomputed on an explicit
Rebalance (already-existing `rebalance-mindmap` command / `Controller.
rebalance()`), never as a side effect of an ordinary edit, *plus* a new
Ctrl/Cmd+B in-view shortcut added to `MindMapView.onKeyDown` (same pattern
as the existing local Ctrl+F/Z/Y/K/C/X/V shortcuts — not also registered as
an Obsidian command hotkey, to avoid a double-fire/precedence conflict with
the hardwired handler). D2 (geometry): **(c)**, left top→bottom then right
bottom→top.
**Alternatives:** recompute the split on every first-level add/remove/move
(D1 option B) — rejected by the user; would reintroduce occasional whole-
map reflows (up to full relayout of 2k+ nodes) mid-edit, the same class of
problem the original sticky-sides fix addressed.
**Cost:** split computation is O(first-level branches) — negligible even
at 5,000 nodes; confirmed no regression via `npm run bench:m2` (Tab/rename/
delete/fold/unfold, all of which exercise `assignMissingSides` on every
mutation) — numbers indistinguishable from the pre-change baseline, see
`benchmarks.md`.
**Source:** `plans/03-ux-anticlockwise-node-order.md`.

## 2026-07-06 — Bug fix: inline editor one-letter-per-line typing + click-closes-editor

**Choice:** two independent fixes in the inline-edit path.
(A) `InlineEditor` now grows its overlay's **width** with content (a hidden
`white-space: pre` mirror `<span>` measures the longest line, clamped to
`[minWidth, maxWidth]`), not just height — previously a freshly created
(empty-text, `minNodeWidth`-only) node opened a ~40px-wide textarea, so the
browser soft-wrapped nearly every typed character onto its own line, and the
old height-only growth logic just made the box a one-character-wide column.
`SvgRenderer.getNodeEditMetrics(node)` computes the same wrap ceiling
(`wrapCeilingFor`) and depth-scaled font size the layout engine will use on
commit, at the view's current zoom, so the overlay's growth ceiling and font
metrics agree with what the node actually renders as — `minWidth`/`maxWidth`
default to the old fixed `rect.width` when omitted (only test code omits
them), so no behavior changed for existing callers.
(B) `MindMapView`'s `contentEl` `mousedown` handler unconditionally called
`.focus()`, including for clicks *inside the editor textarea itself* —
focus jumped to `contentEl`, the textarea blurred, and blur commits (closes)
the editor. So clicking mid-word to place the caret while editing yanked the
editor away. Fixed by skipping the refocus when the click target is inside
`.mm-inline-editor` or `.mm-search-panel`. Also gave `LinkModal` an
`onClose` callback (see the arrow-key-navigation entry above) since it's the
same root issue (focus not returning to `contentEl`) in a different spot.
**Alternatives considered for (A):** measure via a `<canvas>` `measureText`
call instead of a mirror DOM element — rejected, needs the exact same font
shorthand string either way and the mirror-span approach reuses
`getComputedStyle` directly with no separate canvas context to keep in
sync.
**Cost:** one DOM measurement (`scrollWidth` read) + one style write per
keystroke on a detached overlay element, same order of magnitude as the
pre-existing height-growth logic — well under the 16ms keystroke budget;
model/layout/render pipeline untouched until commit.
**Source:** `plans/02-ux-inline-editor-fixes.md`.

## 2026-07-06 — Bug fix: structural (tree-aware) arrow-key navigation, geometric scan demoted to fallback

**Choice:** `navigation.ts` adds `navigateFrom(node, direction, visibleNodes)`,
which follows tree relationships first: Left/Right toward the root selects
`node.parent`; away from the root selects the vertically-nearest visible
child (`node.folded` → no target); Up/Down selects the previous/next
sibling by on-screen y among `node.parent.children` (all guaranteed visible
whenever `node` itself is, since a folded ancestor would have hidden `node`
too — so no extra visibility filter is needed there). At the root, Left/Right
picks the geometrically-nearest first-level child *filtered to that side*
(`layout.side`), since the root's own `layout.side` is a meaningless
hardcoded value, not a real side. `findNearestInDirection` (unchanged) is
now only the fallback: root Up/Down, and Up/Down past a sibling group's
first/last edge — the latter pre-filtered to nodes sharing the current
node's side so up/down can walk across branch boundaries without ever
crossing through the root to the opposite side.
**Also:** `MindMapView.navigate()` no longer silently navigates from an
implicit root when nothing is selected — the first arrow press now selects
the root as visible feedback and stops, matching the way every other
direction already requires an explicit prior selection. `LinkModal` gained
an `onClose` callback (fired on save, remove, *and* dismiss/Escape) so
`MindMapView` can restore focus to `contentEl`; previously only the
save/remove paths implicitly worked, and dismissing via Escape left
keyboard focus stranded on the closed modal, so arrow keys did nothing
until the user clicked back into the pane.
**Alternatives:** keep pure geometric scan and just retune the distance
weighting — rejected: a cousin/off-branch node can always score better than
the true sibling/parent/child for some multi-line or manually-positioned
layout, so no weighting fully eliminates the wrong-branch jump; structural-
first is what the tree actually models and matches XMind's arrow behavior.
**Cost:** O(siblings) for the common parent/child/sibling-within-group case
— strictly cheaper than the previous always-O(visible) scan. The two
fallback paths (root Up/Down; Up/Down past a sibling group's edge) are
O(visible), same as before, never worse.
**Source:** `plans/01-bug-arrow-key-navigation.md`.

## 2026-07-04 — Feature: visual hierarchy by size (R15) — font/box scale by depth

**Choice:** every node's box and font size now scale with depth: root
reads largest (18px), each level down shrinks by 2px, floored at 10px so
deep nodes stay legible instead of vanishing. `layoutEngine.ts` adds
`fontSizeForDepth`/`scaleForDepth`/`defaultWrapWidthForDepth`; box
geometry (`computeNodeBox`) multiplies every baseline px constant
(`nodeHeight`, `charWidth`, `lineHeight`, `paddingX`, `minNodeWidth` — all
tuned for a 12px "baseline" font) by that depth's scale ratio, so text
never overflows or rattles around inside its own box regardless of depth.
`SvgRenderer` sets `font-size` as a per-node SVG attribute (not CSS —
removed the old static `.mm-node-text { font-size: 12px }` rule
entirely, since a stylesheet rule would otherwise win the cascade over
the presentation attribute and silently flatten every node back to one
size) and derives text-y/wrap-width/line-height the same depth-scaled
way, reusing the exact same formulas layoutEngine used so wrapped line
counts never disagree between the two.
**Character-count wrap threshold stays depth-invariant on purpose:**
`maxCharsPerLine` (~60) doesn't itself change with depth — only the pixel
width it maps to does (via the scaled `charWidth`). This keeps "how many
characters before a line wraps" a constant, predictable behavior at every
depth, while the *box* still ends up proportionally sized.
**A node's own `manualWidth` (drag-resize) is never scaled** — it's
already a real px value the user chose by looking at the actual box on
screen, not a formula input.
**Cost:** none new — same O(1)-per-node math as before, just parameterized
by a value (`node.depth`) already on the node. Re-verified the box cache
(`nodeBoxFor`, added in the text-wrapping feature to survive flextree's
multiple-calls-per-node gotcha) also invalidates on a depth change, not
just text/manualWidth — depth *can* change via drag-reorder (`moveNode`),
which the original cache key predated. `npm run bench:m2` unchanged
(20–26ms at 5,000 nodes, same as the prior baseline); bundle size 56 KB.
**Regression tests:** `test/layout.test.ts` (`fontSizeForDepth` monotonic
decrease + floor, `computeNodeBox`/`computeLayout` giving identical text a
strictly smaller box the deeper it is), `test/renderer.smoke.test.ts`
(rendered `font-size` attribute matches the formula exactly at each
depth, not just "looks smaller"), `test/manualPosition.test.ts` (updated
hardcoded height expectations to the depth-scaled formula).

## 2026-07-04 — Feature: search with a results list, reveal + focus on click

**Choice:** `src/model/search.ts` (`searchNodes`) does a plain
case-insensitive substring scan of every node's display text (link syntax
stripped), including nodes hidden behind folded ancestors — search should
find anything in the document, not just what's currently visible. Results
are capped at 50 materialized rows but the true total match count is
still reported, so a broad query on a large map doesn't force rendering
thousands of list items. `src/view/SearchPanel.ts` is a small overlay
(same absolute-positioning pattern as `InlineEditor`) with the query input
and results list; arrow keys move a highlighted result, Enter selects it.
Clicking (or Enter-ing) a result calls `Controller.revealAndSelect`  — new
method that unfolds every folded ancestor of the target node in a single
undo step (mirroring `toggleFold`'s use of `setFolded`), then selects it —
followed by `SvgRenderer.centerOnWorldPoint`, a new renderer method that
pans (keeping current zoom) to a raw world-space coordinate rather than a
node id.
**Why raw coordinates, not a node-id-based "center on node":** the
renderer's own `lastLayout` cache is pruned for culled-out nodes (see
`applyVisibleSet`, M6) — a search hit on a large map is exactly the case
most likely to be off-screen/culled. The *model's* `node.layout` has no
such gap (computeLayout always fills it in for every fold-visible node,
regardless of viewport), so the caller (`MindMapView.focusNode`) reads
world position from there and hands the renderer just numbers. Panning
re-triggers `recull()` (already wired into the existing rAF-scheduled
transform write), which brings the target node back into the DOM.
**Cost, measured:** `searchNodes` is a single O(n) string-scan per
keystroke; timed directly against the 5,000-node stress fixture at
0.5–0.8ms per call (broad and narrow queries both) — not remotely close
to any per-keystroke budget, so no debouncing or indexing was added.
Bundle size: 56 KB (`dist/main.js`, production), still well under the
500 KB budget.
**Entry points:** Ctrl/Cmd+F (opens, or refocuses if already open — same
convention as a browser's find bar), a header search icon
(`addAction`), and an Obsidian command ("Search mind map"), matching the
existing "Rebalance mind map" command pattern.
**Regression tests:** `test/search.test.ts` (case-insensitivity, folded
subtrees, link-label matching, result cap vs. true count), `test/searchPanel.test.ts`
(keyboard nav, click-to-select, count display), `test/controller.test.ts`
(`revealAndSelect` unfolds multiple ancestors as one undo step),
`test/culling.test.ts` (`centerOnWorldPoint` brings a culled-out node back
into the DOM using only its model layout, not the renderer's own cache).

## 2026-07-04 — Bug fix: far-edge branch anchor (previous entry) crossed through other nodes' text

**Bug (reported by user with a screenshot):** the very next fix below
("node text floated in a gap instead of sitting on its branch") stretched
each edge across the child's entire box so the branch would visually run
under its text. That worked for short labels, but for a long or wrapped
(now up to ~60 chars/multi-line, per the wrapping feature added the same
day) box, stretching a short hop into a span of several hundred pixels
turned the Bezier into a long diagonal sweep — and at that length, with
siblings stacked at different row heights nearby, the sweep crossed
straight through *other* nodes' text instead of just running under its
own. Net effect: text became harder to read, not easier.
**Root cause:** conflating two different things under one change — "the
branch should visually connect to the text" doesn't require the branch
geometry itself to travel the text's full width; it only requires the
text to sit *at* the branch's tip.
**Fix:** reverted `edgePath`'s child anchor back to the near edge (short,
as it always was pre-taper). Instead, `SvgRenderer.textAnchorFor` aligns
the text itself flush against that near-edge tip (`text-anchor: start` at
a small padding past the tip for a right-side node, `text-anchor: end` a
small padding before it for a left-side node) and lets it grow *away*
from the branch, not centered in the box. The root keeps its old centered
alignment (it has no incoming branch and keeps its own visible box).
**Cost:** none beyond what the wrapping/taper work already cost — this
only changes which two x-coordinates get written (edge endpoint reverted,
text x/anchor added), still O(1) per node/edge. Added a `lastSide` cache
(parallel to `lastLayout`/`lastText`) so the text anchor/x recomputation
is gated by an actual size-or-side change, not written unconditionally
on every visible node on every update.
**Regression tests:** `test/renderer.smoke.test.ts` — edge ends at the
near edge (not far edge) for a right-side node; the same node's text uses
`text-anchor: start` positioned left of box-center; a left-side node uses
`text-anchor: end` positioned right of box-center; the root stays
centered in its own box.

## 2026-07-04 — Bug fix: node text floated in a gap instead of sitting on its branch

**Bug (reported by user with an annotated screenshot):** a node's text
appeared in the empty space between where its incoming branch visually
ended and where its own outgoing branches began, instead of sitting
directly on the branch — most visible on multi-level chains, where each
label looked like it was floating in a gap rather than riding on the
connecting line (XMind's usual "floating topic" look has no such gap).
**Root cause:** `SvgRenderer.edgePath`'s child-side anchor (`x2`) used
the child's *near* edge (the side facing the parent) — e.g. for a
right-side branch, `childLayout.x` (the box's left edge). Since the
child's text is centered within its own box (at `x + w/2`), the branch
stopped half the box's width short of the text, leaving it looking
disconnected. Meanwhile this same node's *own* outgoing edges (to its
children) already start from its *far* edge (`x1` computed the same way,
one level down) — so there was a real gap in the middle of every node's
box that nothing drew into.
**Fix:** changed `x2` to anchor at the child's *far* edge instead
(swapped which side of the existing ternary applies to R vs L) — the
incoming branch now runs across the child's entire box span, passing
underneath its centered text, and lands exactly on the point this same
node uses as `x1` for its own outgoing edges. Two consecutive segments
now connect with zero gap: one visually continuous branch per lineage,
with each node's label sitting on top of it — matching the screenshot's
green annotations exactly.
**Cost:** none — this only changes two constant x-coordinates already
being computed; same O(1) per edge, no new samples, no algorithm change.
Confirmed via `npm test` (161 passing) that the taper-width math (based
on depth, not anchor position) is unaffected.
**Regression test:** `test/renderer.smoke.test.ts` — asserts a
root→child edge's far-end centerline x equals the child's far edge
(`x + w`), and that this exactly matches the next edge's (child→grandchild)
start x.

## 2026-07-04 — Second bug-fix pass: text wrapping, drag-resize, unboxed sub-topics, Shift+Enter newline

**Context:** a second round of user-reported UI test results after
manually trying the first pass's fixes.

**Text wrapping instead of clipping (long texts):** node width previously
clamped at a max px width with no wrap — text past that point just
overflowed/clipped, illegible. Added `src/model/textWrap.ts`: a pure,
link-aware greedy word-wrapper (tokenizes via the existing
`parseTextSegments`, so a link's label stays attached to its target even
when the wrap splits it across lines). `layoutEngine.computeNodeBox` wraps
at ~60 characters/line by default (`cfg.maxNodeWidth` raised from 320px to
436px, i.e. `60 * charWidth + paddingX`, to match the user's stated
default), and grows node height by `cfg.lineHeight` (16px) per extra
wrapped line instead of clipping. A node's own `manualWidth` (see below)
overrides the 60-char default as the wrap ceiling.
**Cost:** wrapping is real per-character work, and flextree's `nodeSize`
accessor calls it several times per node per layout pass (the same
already-documented M5 gotcha for width estimation) — added a `WeakMap`
cache (`nodeBoxFor`) keyed by node identity, invalidated only when a
node's own text/manualWidth actually changes. Re-measured
`npm run bench:m2` after: 20–27ms at the 5,000-node stress fixture,
indistinguishable from the pre-wrapping baseline (22–25ms) — the cache
absorbed the added cost. Not asked to the user: this follows the exact
"cache to avoid O(calls) blowup" pattern already established (and
approved) for the M5 width-estimation fix, not a new trade-off.

**Draggable per-node width (manual width override):** added
`node.manualWidth` (mirrors `manualPos` exactly: mutation functions
`setManualWidth`/`clearManualWidth`, `Controller.setManualWidth` with
undo/redo, frontmatter persistence via a `width: N` entry alongside
`pos`/`folded`). A small resize-handle rect at each node's outer edge
(`SvgRenderer`'s `.mm-resize-handle`, hidden until hover/selection so the
new unboxed look isn't cluttered) drags to resize, following the same
live-preview-only-touches-this-node's-DOM pattern as the existing Alt+drag
manual-position feature — no model mutation or relayout per pointermove,
only on drop.

**Unboxed sub-topics ("do not box any branch other than main topic"):**
`.mm-node-rect` is now invisible by default (`fill:none; stroke:none;`
but `pointer-events: all` so hit-testing/dragging/resizing still work);
only the root gets the visible box (`.mm-node.mm-node-root .mm-node-rect`).
Selection/drop-target still show a stroke outline on any node (now the
*only* time a sub-topic's box becomes visible at all). Since sub-topics
lost their colored box border, branch color now accents the node's own
text fill instead (plan §9.2 already called for "node border/text accents
match branch color" — previously only the border implemented this).

**Shift+Enter for multi-line labels:** `InlineEditor` switched from
`<input>` to `<textarea>` (a plain `<input>` has no concept of a line
break) — Shift+Enter is deliberately left unhandled in the keydown
handler so the textarea's own default newline-insertion behavior applies;
plain Enter still commits+closes (from the first bug-fix pass). Height
auto-grows via `scrollHeight` on the `input` event — a DOM-local style
write on the overlay only, not a tree mutation/relayout, so it stays
within the "no full work per keystroke" rule the rest of the class
already follows.

**Regression tests:** `test/textWrap.test.ts` (wrap algorithm, link-token
attachment across a wrap point), `test/layout.test.ts` (wrap-driven
height growth, manualWidth as wrap ceiling), `test/renderer.smoke.test.ts`
(root-only box class, multi-line tspan rendering, link click survives a
wrap, resize-handle drag), `test/manualWidthPersistence.test.ts`
(serialize → reparse round trip, combined with fold/pos, cleared pin),
`test/moveAndRebalance.test.ts` (`setManualWidth` undo/redo),
`test/inlineEditor.test.ts` (Shift+Enter left unhandled/no commit).

## 2026-07-04 — Bug fix pass: continuous per-edge taper, long-text growth direction, click-to-select, Enter-while-editing, space-to-edit

**Context:** user-reported UI test results (`dev-vault/Mind Mapping Plugin
Test.md`) after first real manual use of the built plugin.

**Tapered lines (R10, pre-flagged trade-off, plan §3.4 item 4 / §9.1):**
the plan explicitly deferred "organic tapered branch visual fidelity vs
path-generation/paint cost" to an ask-the-user decision point before
building it — the only tapering in place was constant-width-per-edge by
depth (`strokeWidthForDepth`, thick near the root, thinner per level, no
taper *within* a single connector). Asked per the mandatory decision
protocol; **user chose the higher-fidelity option**: a single edge now
tapers continuously from the parent depth's branch width down to the
child depth's, rendered as a filled variable-width ribbon polygon
(`SvgRenderer.edgePath` samples the centerline Bezier at 16 points,
offsets each by a linearly-interpolated half-width along its normal, and
closes the two offset rows into one filled `<path>`) instead of a
constant-width stroked line. `.mm-edge` switched from `stroke`-based to
`fill`-based coloring in `styles.css` accordingly.
**Cost, measured (`npm run bench:m2`):** Tab/rename/delete at the
5,000-node stress fixture: 22–25ms — comfortably under the 50ms target
and *below* the M3 baseline (36.2/26.7/35.8ms), so no regression despite
the extra per-edge sampling work; cost stays O(1) per edge (fixed sample
count), so total cost is still O(n) in edge count, same as before.
Bundle size: 44 KB (well under the 500 KB budget).
**Alternative (declined):** keep constant-width-per-edge only — cheaper
(one attribute write, no sampling), visually acceptable but not the
"organic branch" look the user wanted.

**Other fixes in this pass (plain bugs, not trade-offs):**
- **Long text grows the wrong way on left-side branches:** `layoutEngine.ts`'s
  `layoutSide` set a left-side node's box `x` by negating `depthAxis`
  directly, which fixes the box's *inner* edge (nearest the parent) at a
  wrong spot and left the *outer* edge — the one that should move as text
  gets longer — anchored instead, so growing text pushed the box back
  toward the parent rather than away from it. Fixed by computing `x` so the
  inner edge (`x + w`) stays fixed and the outer edge (`x`) is what moves
  as `w` changes.
- **Single click didn't select a node:** pointer capture (`setPointerCapture`,
  needed for drag support) can retarget the `click` event that follows to
  the capturing `<svg>` element instead of whatever was actually clicked —
  same root cause as the earlier double-click bug, but this time hitting
  plain single-click too. Fixed by resolving the real element under the
  cursor via `document.elementsFromPoint(evt.clientX, evt.clientY)` (same
  technique already used for drag hit-testing) instead of trusting
  `evt.target`, with a fallback to `evt.target` where `elementsFromPoint`
  isn't available (jsdom).
- **Enter while editing jumped straight into creating+editing a new sibling:**
  changed so any Enter (with or without Shift) while the inline editor is
  open just commits and closes editing, leaving the node selected — the
  same effect as blur. Creating a sibling now requires a second, separate
  Enter press once nothing is being edited (already-existing behavior in
  `MindMapView.onKeyDown`). `InlineEditor`'s `onCommitAndCreateSibling`
  callback was removed as dead code.
- **Space did nothing on a selected node:** added `Space` (no modifier) as
  an alias for `F2` in `MindMapView.onKeyDown` to open the inline editor
  for the selected node.

**Regression tests:** `test/layout.test.ts` (long-text growth direction),
`test/renderer.smoke.test.ts` (click resolves via coordinates; edge ribbon
width decreases start-to-end and continues across parent/child edges),
`test/inlineEditor.test.ts` (Enter commits without creating a sibling).
Space-to-edit and click-through-real-pointer-capture-retargeting aren't
unit-testable (`MindMapView` needs the `obsidian` runtime, which is
types-only in this project — see M4 note; real pointer-capture retargeting
needs a real browser) — flagged for manual dev-vault verification per
CLAUDE.md.

## 2026-07-03 — M1: node width from character count, not measured text

**Choice:** node box width = `clamp(text.length * charWidth + padding, min, max)`,
a constant-time heuristic.
**Alternatives:** measure actual rendered text width (canvas `measureText`
or an offscreen DOM probe) — more visually accurate (proportional fonts,
wide/narrow glyphs), but costs a measurement call per node per layout pass.
**Cost:** O(1) per node vs. O(1) canvas-API call per node (not free at
5,000 nodes on every relayout, and would need caching/invalidation to stay
cheap on incremental relayout in M3+). Chosen for now since layout is
already the dominant cost at 20ms/5,000 nodes (see `benchmarks.md` M1); a
measurement pass would add to that on every full relayout.
**Revisitable:** if node boxes look visibly mis-sized in the dev vault
(text overflow/excess whitespace), this is the place to swap in measured
widths with a per-node width cache — flag as a fidelity-vs-performance
question at that point rather than deciding silently.

## 2026-07-03 — M2: undo/redo depth capped at 100 edits

**Choice:** operation-log undo/redo (inverse closures, not tree snapshots),
capped at 100 entries.
**Alternatives:** unbounded history (simplest, no cap logic, but grows
indefinitely over a very long session); smaller cap e.g. 25 (tighter memory
bound, less undo reach).
**Cost:** each entry is a small closure over a few node references plus
text/index — negligible even at 5,000-node map scale; the cap exists for
hygiene, not because 100 entries would be measurably heavy.
**Asked the user** (addendum §8 item 7, explicitly flagged as a
performance-vs-memory decision point not pre-specified by the plan) — user
chose the recommended 100-edit default.

## 2026-07-03 — M2: full-tree relayout per mutation, dirty-tracked render

**Choice:** every mutation (Tab/Enter/rename/delete) triggers a full
`computeLayout()` recompute, but the **renderer** stays dirty-tracked
(`SvgRenderer.update()` only creates/updates/removes the DOM nodes whose
data actually changed — see §4.3's mandatory "never re-render the whole
SVG" rule).
**Alternatives:** true incremental/partial layout (recompute only the
changed subtree + shift affected siblings, per plan §4.4) — algorithmically
correct per the tidy-tree spec, but `d3-flextree` has no incremental API;
building one is real work.
**Cost:** measured in `benchmarks.md` M2 — full relayout + dirty render
update stays under the 50ms Tab/Enter target even at the 5,000-node stress
fixture (33.7ms worst case). Since nothing is currently over budget, adding
incremental layout now would be optimizing before there's a measured
problem (addendum rule 6 also warns against premature micro-optimization).
**Revisitable:** if a future milestone's benchmark regresses this — e.g.
once organic Bezier paths (M3) or animations (M4) add per-node cost on top
— partial relayout becomes the next lever to pull. Flagged here, not
decided silently, because it's explicitly named in plan §4.4 as the
intended eventual architecture.

## 2026-07-03 — M2: self-write suppression via content comparison, not a version stamp

**Choice:** on a Vault `modify` event, compare the file's new content
against `this.data` / `this.lastWrittenText`; skip reconciliation if equal.
**Alternatives:** the plan's literal wording is "version-stamped
reconciliation" (e.g. a counter or hash written alongside the file).
**Cost:** content comparison achieves the same goal (ignore our own
write's echo) with no extra state to keep in sync and no risk of a stamp
surviving external edits/copies of the file. Equivalent correctness for
the self-echo case; doesn't by itself solve true concurrent-edit
detection, which the next entry covers.

## 2026-07-03 — M2: external-edit conflict policy is "keep local + notify", not merge

**Choice:** if an external file change is detected while there's an
unwritten local mutation pending (debounce not yet flushed), keep the
in-memory model as-is (it will still flush on the next debounce tick) and
show an Obsidian `Notice`, rather than attempting a merge.
**Alternatives:** plan §7.3 says "prefer non-destructive merge; if a true
conflict remains, ask the user." A real merge (diffing both trees and
combining non-overlapping changes) is a substantially bigger feature.
**Cost:** zero performance cost either way; this is a scope/safety
decision, not a perf trade-off, so it didn't need the rule-3 ask — but it's
logged because it's a deliberate deviation from the plan's literal wording,
and N2 ("never silently corrupt or lose content") is non-negotiable. "Keep
local" satisfies N2 by construction (nothing is dropped, the user is told).
**Revisitable:** true 3-way merge is a reasonable post-M2 follow-up if
external-edit conflicts turn out to be common in practice (e.g. syncing
via git or Obsidian Sync while the map view is open).

## 2026-07-03 — M3: sticky left/right sides for balanced layout

**Problem found:** the initial M3 implementation recomputed the optimal
L/R partition from scratch on every layout call (matching the plan's
literal "balanced" wording). Measured impact: one Tab keypress on the
5,000-node fixture moved 4,999 of 5,000 nodes and flipped 2 of 10
first-level branches to the other side. Tab latency at 5,000 nodes rose
from 33.7ms (M2 baseline) to 54.6ms — a 62% regression, crossing the
addendum §6 "flag before proceeding" threshold (>20%), and defeating the
renderer's dirty-tracking entirely (nearly the whole SVG got touched on
every edit regardless of how local the edit was).
**Choice (per user decision, asked via the mandatory decision protocol):**
sticky sides — `assignMissingSides` (`src/layout/sides.ts`) assigns each
first-level branch a side once, balancing against already-committed
weight, and never reassigns an existing branch. A new branch joins
whichever side is currently lighter. An explicit "Rebalance" command
(clears all pins via `clearAllSides`, M5) is the only way to force a full
recompute.
**Alternatives:** keep always-recomputing global balance (simpler code,
but cost scales with total tree size instead of edit size, and the map
visually reshuffles branches on unrelated edits — user explicitly declined
this after seeing the cost/benefit).
**Cost:** re-measured after the fix — Tab at 5,000 nodes is back to 36.2ms
(within the 50ms target), and the same edit now moves exactly 1 node
instead of 4,999. See `benchmarks.md` M3.
**Also fixed alongside this:** `SvgRenderer.upsertEdge` was writing `d`
and `stroke-width` unconditionally on every edge every update, bypassing
the dirty-tracking pattern already used for nodes — now cached and
diffed the same way (stroke-width is set once at creation since depth
can't change without reparenting, which doesn't exist until M5).

## 2026-07-03 — M4: surgical text patching for frontmatter metadata, not full YAML round-trip

**Choice:** `src/sync/metadata.ts` reads/writes only our own `mindmap:`
subtree within the frontmatter block via targeted line-range
replacement — it never parses or re-serializes the rest of the
frontmatter. `model.frontmatterRaw` (already captured verbatim since M2)
is spliced in place.
**Alternatives:** use Obsidian's real `parseYaml`/`stringifyYaml` (from
the `obsidian` package, zero bundle cost since it's external/runtime-only)
to parse the whole frontmatter, mutate the `mindmap` key, and
re-stringify. Correct, but reformats *every* key in the frontmatter
(quote style, ordering) on every write — a real fidelity cost matching
plan §3.4 item 5 ("full markdown fidelity vs simpler serialization"), and
it would make this module untestable in plain Vitest (the `obsidian`
package ships no runtime, only types — see M0 note on `obsidian` being a
types-only devDependency).
**Cost:** more code than "just call stringifyYaml," but zero risk of
reformatting a user's unrelated frontmatter keys, and fully unit-testable
without mocking Obsidian's runtime (see `test/metadata.test.ts`). Not
asked to the user — it's the same "custom narrow-scope parser over a
general AST library" pattern already established in M0/M1 for the
markdown body itself, applied consistently to frontmatter.
**Revisitable:** if the `mindmap:` schema grows past flat per-node
`{key: value}` pairs (e.g. nested manual-position objects in M5), the
regex-based line matching may need to become a tiny recursive-descent
parser instead of extending the regexes further.

(Update, M5: manual-position `pos: [x, y]` landed as a flat pair inside
the same per-node object — the regex approach held up fine, no
recursive-descent parser needed yet.)

## 2026-07-03 — M5: manual positioning via per-region recursive flextree calls

**Choice:** a manually-positioned node (R12) is excluded from its parent's
flextree `children` accessor entirely (invisible to that layout call, so
it consumes no space and gets no auto position); after that call
positions its region, a second pass over the same already-visited nodes
finds any manually-positioned direct children and recursively re-invokes
the same layout function anchored at the pin. This lets manual positioning
nest to any depth (a pinned node's own children can auto-layout relative
to it, and further pinned descendants recurse again).
**Alternatives:** restrict manual positioning to first-level branches only
(simpler — no recursion needed) — rejected because plan R12 doesn't scope
it that way, and mind-map users commonly want to nest a custom layout a
few levels deep (e.g. dragging a whole sub-cluster).
**Cost, investigated (addendum §6 — regression check before moving on):**
initial version regressed layout time at 5,000 nodes from ~20ms (M4) to
~32ms (60%) even with zero manual positions in the fixture. Two causes
found and fixed: (1) `estimateNodeWidth` started calling the new
link-aware `getDisplayText`, which runs a regex even on plain text, and
`nodeSize` is invoked multiple times per node internally by flextree
(verified empirically in M1) — fixed with a fast path that skips the
regex when the text has no `[` at all. (2) the per-node `children`
filtering for manual descendants always allocated a new array — fixed to
reuse the original array when a node has no manually-positioned children
(the common case). After both fixes, layout at 5,000 nodes is ~26ms
(~30% over M4's baseline, not 60%) — the remaining delta is the
unavoidable second traversal pass needed to find manually-positioned
descendants at any depth. Not flagged further to the user: nothing is
within an order of magnitude of any actual budget (28.8ms open-time vs
2,000ms ceiling; 33.4ms Tab vs 50ms target) — this is a justified,
bounded cost of a real feature, not a regression to fix.

## 2026-07-03 — M6: viewport culling threshold (300 nodes) and margin (400px)

**Choice:** below 300 folding-visible nodes, render everything
unconditionally (no culling bookkeeping at all); above it, only render
nodes within the current pan/zoom viewport plus a 400px world-space
margin, re-culling on every pan/zoom frame (rAF-batched, piggybacking on
the existing transform-write callback).
**Not asked to the user:** unlike the animation-threshold or sticky-sides
decisions, this isn't a trade-off — culling has no user-visible downside
(nothing looks or behaves differently; nodes just don't exist in the DOM
until they'd be visible anyway, within a margin generous enough that
panning shouldn't show visible pop-in) — it's a pure "render less" win,
so it doesn't trigger the rule-3 "ask when performance trades against
something else" protocol.
**Cost/benefit measured** in `benchmarks.md` M6: at 5,000 nodes, actual
DOM element count drops to ~165 total (vs. an un-culled ~20,000+ for
5,000 nodes × 4 elements each) — see the mount-time/element-count table.
**Revisitable:** 400px margin and 300-node threshold are both untuned
guesses reproduced from typical viewport/interaction sizes, not measured
against a specific pop-in complaint. If real-world use in the dev vault
shows nodes popping in visibly during fast pans, widen the margin; if
culling bookkeeping itself shows up in a profile for maps just above 300
nodes, raise the threshold.

## 2026-07-03 — M6: incremental parse (external-edit re-parse) not implemented

**Choice:** external file changes still trigger a full re-parse of the
whole file (`parseMindMap` on the complete text), not an incremental
re-parse of just the changed region — even though the plan names
"incremental parsing" as a target (addendum §4.2) and explicitly frames
full re-parse as "the fallback."
**Why this is fine for now:** measured parse time (see `benchmarks.md`,
every milestone) is 0.4–2.4ms even at the 5,000-node stress fixture —
nowhere near a cost worth optimizing. Building incremental/region-diffing
parsing is real engineering (tracking which lines changed, mapping them
back to tree positions, handling structural shifts) for a cost that
doesn't show up in any measurement. Implementing it now would be
optimizing before there's a problem (addendum rule 6 warns against this
directly).
**Revisitable:** if a future real-world file turns out to be enormous
(tens of thousands of lines) such that parse time becomes noticeable, or
if external-edit reconciliation frequency becomes a real UX complaint
(e.g. heavy use of Obsidian Sync/git triggering frequent re-parses),
incremental parsing is the documented next lever — not built speculatively
ahead of that.

## 2026-07-03 — Bug fix: inline editor positioned via viewport-fixed coordinates

**Bug (reported by user after first real manual use):** the text input
for editing a node appeared in the wrong place on screen instead of over
the active branch.
**Root cause:** `SvgRenderer.getNodeScreenRect` computed absolute
viewport coordinates (`svg.getBoundingClientRect()` + view transform),
and `InlineEditor` used `position: fixed` to place itself at that
coordinate. `position: fixed` is normally viewport-relative, but silently
becomes relative to the nearest ancestor with a CSS `transform` (or
`filter`/`contain`/`perspective`) if one exists anywhere up the DOM tree
— which Obsidian's workspace panes commonly have (pane
animations/dragging, mobile). This is exactly the kind of thing that
can't be caught by jsdom (no real layout) or by unit tests that don't
model page-offset geometry — it only showed up on first real use, which
is why the transcript's earlier "verify manually in the dev vault"
caveats were flagged rather than skipped.
**Fix:** stopped depending on the viewport at all. `getNodeScreenRect`
now returns coordinates relative to the renderer's own `container`
element (the offset between the container's and svg's bounding rects,
plus the view transform); `InlineEditor` uses `position: absolute` inside
that same container, which now has `position: relative` in `styles.css`
so it's an explicit containing block we control — no dependency on
whatever transforms exist further up Obsidian's DOM tree.
**Regression test:** `test/renderer.smoke.test.ts` mocks the container's
`getBoundingClientRect()` to a page position far from the origin (300,
500) and asserts the returned rect does *not* include that offset — this
test fails against the old (buggy) implementation and passes against the
fix.

## 2026-07-04 — Bug fix: double-click didn't open the inline editor

**Bug (reported by user):** double-clicking a node did nothing instead of
opening the inline text editor.
**Root cause:** double-click detection relied on the browser's native
`dblclick` event. `onPointerDown` calls `setPointerCapture` on every node
click (needed so drag tracking keeps receiving `pointermove` even if the
cursor leaves the node mid-drag). While an element holds pointer capture,
some browsers retarget the mouse-derived events that follow (`click`,
`dblclick`) to the *capturing* element (`this.svg`) instead of whatever
was actually under the cursor — so `evt.target.closest(".mm-node")`
inside `onDblClick` resolved to nothing, since `this.svg` is an ancestor
of `.mm-node`, not a match itself.
**Fix, two parts:**
1. `onPointerUp` now explicitly calls `releasePointerCapture` instead of
   relying on the spec's implicit release, so capture doesn't outlive the
   gesture it was needed for.
2. More robustly, double-click detection no longer depends on the native
   `dblclick` event at all — `onClick` now tracks the last-clicked node id
   and timestamp itself, and promotes a second same-node click within
   400ms to a "double-click" call. This sidesteps the capture/retargeting
   interaction entirely rather than depending on getting the timing of
   part 1 exactly right across browsers.
**Regression tests:** `test/renderer.smoke.test.ts` — two `click` events
(not `dblclick`) on the same node fire the dblclick handler once; two
clicks on *different* nodes don't; a third click after a double-click
doesn't re-fire it.

Each entry: choice made, alternatives considered, measured/estimated
performance cost. Newest first.

## 2026-07-03 — Rendering: hand-rolled SVG renderer

**Choice:** SVG, hand-rolled (no charting/diagram library).
**Alternatives:** Canvas/WebGL (raw scalability, less styling/accessibility
convenience); a full graph/mind-map library (faster to start, bundle bloat +
per-frame overhead outside our control).
**Cost:** SVG scales to the 2-3k visible node budget with dirty tracking +
viewport culling; beyond that, Canvas/WebGL is a pre-identified fallback
(see plan §3.4.1) — revisit if the 5k stress-test fixture shows frame drops.
**Source:** plan §5 Technology Stack, addendum §8.1.

## 2026-07-03 — Layout: d3-flextree only (not full D3)

**Choice:** `d3-flextree` module only.
**Alternatives:** full D3 (unneeded bundle weight), hand-rolled tidy-tree
(more dev time, same asymptotics).
**Cost:** ~ single-digit KB min+gzip, O(n) layout, well under the 50 KB
approval threshold in CLAUDE.md rule 4. To be installed when M1 needs it.
**Source:** plan §5 Technology Stack.

## 2026-07-03 — Md parsing: custom line-based parser (not an AST library)

**Choice:** hand-rolled line-based markdown parser scoped to the
heading/list subset we need.
**Alternatives:** `remark`/`unified` (full CommonMark AST, heavier, harder
to do incremental/partial re-parse on top of).
**Cost:** zero added dependency weight; full control over incremental
parsing and round-trip fidelity, at the cost of more parser code to
maintain ourselves.
**Source:** plan §5 Technology Stack, addendum §4.2.
