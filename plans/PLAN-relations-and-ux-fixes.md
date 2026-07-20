# Plan — Relations feature + copy-color & new-node-centering fixes

Source: [dev-vault/Tool notes.md](../dev-vault/Tool%20notes.md), analyzed 2026-07-18
(Round 1) and again 2026-07-18 (Round 2, after the note was updated with a
fuller relations spec + a new UX bug). Round 3 (2026-07-18) came from the user
directly (not the notes file), reacting to what Round 2's D7 "visible append"
decision actually looks like once written to disk — see Round 3 section below,
which **supersedes D7**.
Companion tracker: [PROGRESS-relations-and-ux-fixes.md](PROGRESS-relations-and-ux-fixes.md).
This plan follows the same discipline as [MASTER-PLAN.md](MASTER-PLAN.md): every
item is grounded in the current code, carries a performance note, and lists its
tests. **Performance rules in [CLAUDE.md](../CLAUDE.md) override anything here;
any performance-vs-anything trade-off must be surfaced to the user, never
decided by the implementer.**

## Scope

| # | Item | Type | Effort | Round |
|---|---|---|---|---|
| R1 | Show relations between nodes **in the same document** as a toggleable arrow | Feature | L | 1 — **Done** |
| R2 | Show relations to a node **in a different document** (detect + badge + click) | Feature | M | 1 — **Done** |
| F1 | Pasted/moved branch must adopt the **target branch's color**, not keep its old one | UX bug | S | 1 — **Done** |
| F2 | A newly created node must be **brought into view** before its editor opens | UX bug | S | 1 — **Done** |
| F3 | Inline text editor must **track the node** if the user pans/zooms while editing | UX bug | S | 2 |
| R3 | Redesign the relation/link modal: **list existing relations/links** (each removable) + **radio-selected add flow** (Document relation, default / Link) | Feature | L | 2 |
| R4 | Document-relation add flow: **two-step autocomplete** (pick a vault file, then a node inside it) — same-doc and cross-doc unified, cross-doc now **authored**, not just detected | Feature | L | 2 |
| R5 | A node can carry **multiple relations** to different targets (not just one whole-text link) | Feature | M | 2 |

R3/R5 are effectively one redesign (the list UI is what makes multiplicity
possible) and are tracked as a single milestone below; R4 is the cross-doc
picker + foreign-file write-back built on top of that same UI.

Round 1 recommended order was **F1 → F2 → R1 → R2** (done). Round 2
recommended order: **F3 → M-R3/R5 → R4** (F3 is small and independent; the
modal redesign is the highest-risk item and gates R4, which reuses its
combobox scaffolding). All three Round-2 open decisions (D6–D8) were put to
the user before this plan was finalized — see the Open Decisions table.

---

## Current-code grounding (read before implementing)

- **Links already exist.** `src/model/links.ts` parses `[[wikilink]]` and
  `[label](target)` runs out of node text (`parseTextSegments`); the
  `Ctrl/Cmd+K` editor (`LinkModal` + `Controller`/`buildLinkText`) writes them.
  A "relation" is, at its core, a link whose target is another node.
- **Node identity via block-ids already exists.** `src/sync/metadata.ts`
  (`ensurePersistentIds`) appends ` ^blockid` to a node's line **only when it
  has persistable metadata**, and `model.byId` is keyed by that id. The
  serializer emits the suffix (`serializeNode`), the parser strips it
  (`BLOCK_ID_RE`). Referencing a node by block-id is therefore already
  round-trip-safe — but a relation *target* must be forced to have a persistent
  id (today a plain node has only a synthetic `n123` id that is never written).
- **Colors.** `src/render/colors.ts`: `assignMissingColors` sets `colorKey`
  **only on direct children of root**; `resolveNodeColorKey` walks up to the
  nearest ancestor with a `colorKey`. `cloneSubtree`
  (`src/model/mutations.ts:183`) copies `colorKey` verbatim — this is the F1
  bug (see below).
- **Renderer layers.** `SvgRenderer` builds `viewportG → { edgesG, nodesG,
  dropIndicator }` (`src/render/SvgRenderer.ts:243`). Pan/zoom is a single
  transform on `viewportG`; edges are dirty-tracked and culled. A relations
  overlay is a new sibling `<g>` in this stack.
- **Centering primitive already exists.** `MindMapView.focusNode`
  (`src/view/MindMapView.ts:509`) already unfolds, selects, and calls
  `renderer.centerOnWorldPoint(...)`. F2 is about reusing this on the
  new-node path.
- **Settings** are a flat interface + `DEFAULT_SETTINGS` + `SettingsTab`
  (`src/settings/`). Adding a `showRelations` toggle is one field + one
  `addToggle` row.

---

## F1 — Pasted/moved branch adopts the target branch's color

### Root cause
`colorKey` is only meaningful on a **direct child of root** (a first-level
branch); every deeper node inherits by walking up (`resolveNodeColorKey`).
`cloneSubtree` copies `colorKey`, so when a first-level branch is copied and
pasted **inside** another branch, the clone still carries e.g. `colorKey:"c3"`.
`resolveNodeColorKey` then returns that stale key for the clone and its whole
subtree, shadowing the target branch's color — exactly the reported symptom.
The identical bug exists on the **drag-reorder path** (`moveNode` never clears
`colorKey`), so a fix limited to paste would be incomplete.

### Design (recommended: enforce the invariant centrally)
Two candidate fixes:

- **A (targeted):** drop `colorKey` in `cloneSubtree` (like it already drops
  `manualPos`/`branchSide`). Fixes paste only.
- **B (invariant, recommended):** make "**`colorKey` lives only on direct
  children of root**" an enforced invariant. In `assignMissingColors` (runs in
  `onChange` before every render), first clear `colorKey` on any node whose
  `parent !== root`, then assign missing colors to first-level branches as
  today. This fixes paste **and** move **and** any future path in one place,
  and a pasted/moved subtree simply re-inherits its new branch's color via the
  existing `resolveNodeColorKey`. A first-level branch pasted **at root level**
  correctly gets a fresh palette slot (no target branch to match).

Recommendation: **B**, plus still dropping `colorKey` in `cloneSubtree` (A) so
the clone is clean the instant it is created, before the next `assignMissingColors`.

### Performance
O(nodes) clear folded into the existing `assignMissingColors` walk, which
already runs each `onChange` — no new pass, no measurable cost. Nothing on the
keystroke hot path.

### Tests
- `test/colors.test.ts`: colorKey on a non-root-child is cleared; first-level
  keys are preserved and gap-filled.
- `test/controller.test.ts`: copy a colored first-level branch, paste inside a
  differently-colored branch → pasted subtree resolves to the **target's**
  color; paste at root → gets a new distinct color.
- Move (drag-reorder) a first-level branch under another branch → adopts target
  color. Check for any existing test asserting `cloneSubtree` preserves
  `colorKey` and update it.

---

## F2 — New node is created off-screen; must be brought into view

### Root cause
`addChildToSelected`/`addSiblingToSelected` → `emitChange()` (relayout+render) →
`emitEditRequest(id)` → `openInlineEditor`, which positions the editor from
`renderer.getNodeScreenRect(id)`. If the new node lands outside the viewport (or
is culled out entirely on a >300-node map), the rect is off-screen or null and
the editor opens where the user can't see it — or not usefully at all. No code
pans to the new node first (unlike `focusNode`, which does exactly that for
search).

### Design
Before opening the editor for a **newly created** node, ensure it is on screen,
reusing the existing `centerOnWorldPoint`. Sequence: create → `onChange`
(layout now has the new node's position) → **ensure-visible** → open editor.
Implementation options for "ensure visible":

- **Center it** (literal reading of the note): always
  `centerOnWorldPoint(newNode)`.
- **Minimal pan (recommended):** pan only if the node is outside a comfortable
  viewport margin, and only far enough to bring it in — avoids the whole map
  lurching on every `Tab`/`Enter` when the new node is already visible, and
  skips a re-render entirely in the common case.

This is **Open Decision D4** — the note says "centralized," best practice is
minimal-pan. Do not decide silently.

Wiring: the view already funnels new-node creation through `onEditRequest`. Add
an "ensure the just-created node is visible" step there (or a dedicated
`onCreateRequest`) so it applies to Tab, Enter, Shift+Enter, and paste-image
alike. Must handle the culling case: centering re-runs cull so the node gets a
DOM element, *then* `getNodeScreenRect` is valid — order matters.

### Performance
A pan is already a cheap transform + re-cull (same as search-jump today). With
the minimal-pan option, the frequent case (new node already visible) does **no**
extra work. Keystroke→node-visible budget (<50 ms) is unaffected.

### Tests
- `test/inlineEditor.test.ts` / a view-level test: after creating a node whose
  layout position is outside the current viewport, the editor's screen rect is
  within the viewport (node was brought into view first).
- Minimal-pan variant: a node already comfortably visible does **not** trigger a
  viewport transform change.

---

## R1 — Same-document relations as toggleable arrows

### Concept
A relation is a directed connection from a source node to a target node **in the
same map**, drawn as a curved arrow on a dedicated overlay layer, on top of the
normal parent-child branches. Global on/off via a `showRelations` setting
("the arrow can be disabled").

### Representation & authoring — **Open Decisions D1, D2**
- **D1 (storage):** (a) store relations as **inline markdown links** in the
  source node's text — an Obsidian same-file block link `[[#^targetblockid]]`
  (recommended: markdown *is* the source of truth per N2/N3, round-trips
  natively, shows in Obsidian's own graph); or (b) store them in the
  `mindmap:` **frontmatter metadata** block as explicit `rel: [^a → ^b]`
  entries (keeps node text clean, but proprietary and duplicates Obsidian's
  link graph). **Must ask the user.**
- **D2 (authoring gesture):** (a) reuse the existing `Ctrl/Cmd+K` link editor
  only (minimal; user types/picks the target); or (b) add a dedicated
  **drag-to-connect** gesture (e.g. modifier-drag from source to target, or a
  "Start relation" context-menu item) that auto-assigns a block-id to the
  target and writes the link. Recommendation: ship rendering first (a), add the
  gesture (b) as a follow-on. **Ask the user before building (b).**

Whichever storage is chosen, creating a relation must **force a persistent
block-id on the target** (extend `ensurePersistentIds`/`nodeHasPersistableMeta`
so being a relation endpoint counts as "needs an id"), otherwise the reference
can't survive a round-trip.

### Rendering
- New `relationsG` layer between `edgesG` and `nodesG` (arrows read as
  underneath node boxes but above branches — confirm visually).
- Endpoints from `sourceNode.layout` / `targetNode.layout` (both present after
  `computeLayout`). A relation whose target is folded/hidden or not yet
  block-id-resolvable is skipped (optionally shown as a stub on the fold badge —
  defer).
- Distinct visual from branches: thinner, dashed or a different curve, with an
  arrowhead marker; **not** colored by branch palette (so it reads as a
  cross-link, not a hierarchy edge).

### Performance (this is the perf-sensitive item — rule 2)
- Relations must be **dirty-tracked and culled** like edges: recompute only the
  arrows whose endpoints moved (relayout/fold), and skip arrows fully outside
  the viewport on large maps. Never recompute all arrows on pan/zoom (the
  single `viewportG` transform already handles pan/zoom for free).
- Resolving relations from links must **not** run on the layout hot path.
  `getDisplayText`'s fast-path lesson applies: only scan a node's text for
  relation links when its text actually changed, and cache the resolved
  endpoint list on the model, invalidated on edit/structure change.
- Rich arrow visuals (variable-width, animated, routed-around-nodes) vs. cheap
  cubic-Bezier-with-arrowhead is a **fidelity-vs-paint-cost trade-off** — start
  cheap; **surface to the user if richer arrows are requested** (rule 3).
- Benchmark impact on a map with, say, 200 relations at the 2,000-node fixture;
  record in `benchmarks.md` against the open/relayout budgets.

### Tests
- Link/relation resolution: a node text with `[[#^id]]` resolves to the right
  target node; unresolved/dangling refs are dropped, not crashing.
- Renderer smoke: N relations produce N arrow paths in `relationsG`; toggling
  `showRelations` off removes them; culling excludes off-screen arrows.
- Round-trip (if D1=inline): relation links survive parse→serialize unchanged.

---

## R2 — Relations to a node in a different document

### Concept
A node's text may link to another **document** (`[[OtherNote]]` or a block
`[[OtherNote#^id]]`). The target isn't on this canvas, so it can't be an arrow —
instead the node shows a **cross-document relation indicator** (a small badge/
icon), and clicking it opens the target (this already works via
`MindMapView.openLink` → `app.workspace.openLinkText`). Builds directly on R1's
link-resolution: same parse, different branch when the target resolves to a
foreign file rather than a same-map node.

### Design — **Open Decision D3**
- Minimum (recommended): badge indicating "has external relation(s)" +
  existing click-to-open, with a tooltip naming the target(s).
- Richer (defer / ask): inline hover preview of the target, or a ghost stub
  node representing the external target on the canvas. **Ask the user before
  building the richer version.**

### Performance
Indicator is one small element per node-that-has-one, created via the existing
per-node dirty-tracked render path; no new global pass. Link classification
(same-map vs foreign) reuses R1's cached resolution.

### Tests
- A node linking to a foreign note gets the indicator; a node linking to a
  same-map block does **not** (that's an R1 arrow instead); a node with no link
  gets neither.
- Click opens the correct target via the (mocked) workspace API.

---

## Round 2 — current-code grounding (read before implementing)

Re-verified 2026-07-18 against the code as it stands after Round 1 (R1/R2/F1/F2
committed, plus several follow-on UX fixes logged in the progress tracker's
log — badge hit-targets, context-menu exclusions, right-click regression,
link-click-vs-select). Nothing below contradicts the Round 1 grounding; it
adds what Round 2 touches.

- **A node holds at most one link today, and it replaces the whole node
  text.** `MindMapView.openLinkEditor` (`src/view/MindMapView.ts:322`) reads
  `getSoleLink(node.text)` — a node's text either *is entirely* one link
  (`[[#^id|label]]`, label shown via `getDisplayText`) or has none; there is
  no concept of "some plain text plus a link" today. Saving always calls
  `this.controller.commitRename(nodeId, buildLinkText(result))` (or the
  relation variant), overwriting the node's full text. This is the R5 gap:
  the *parser* already handles multiple links anywhere in a node's text fine
  (`parseTextSegments`/`getCachedLinks` scan the whole string, not just a
  sole-link fast path), but the *authoring* path never produces that shape.
- **`resolveRelations` (`src/model/relations.ts`) already resolves every
  link in a node's text, not just one** — `getCachedLinks` returns an array,
  `resolveRelations`'s inner loop pushes one `activeRelations` entry per
  same-doc link found. A node with two `[[#^id]]` references today already
  renders two arrows if you hand-edit the markdown — R5 is purely an
  authoring-UI gap, not a rendering or model gap.
- **`classifyLink` already treats any wikilink whose file part isn't the
  current file as cross-doc**, unconditionally (`src/model/relations.ts`,
  the `isSameFileTarget` check inside `classifyLink`) — so once a link like
  `[[OtherNote#^xyz]]` exists in a node's text, R2's existing badge/click
  path picks it up with **no changes needed**. R4 only has to get that link
  *written*, including minting `^xyz` in `OtherNote` if it doesn't have it
  yet.
- **The building blocks for a foreign-file write already exist, just not
  wired together for this purpose:** `parseMindMap(source, fallbackTitle)`
  (`src/sync/parser.ts:65`) turns raw markdown into a `MindMapModel`;
  `forcePersistentId(node, byId)` (`src/sync/metadata.ts:83`) mints a block
  id immediately (used today for same-doc relation targets); `serializeMindMap`
  (`src/sync/serializer.ts:22`) turns a model back into markdown.
  `MindMapView.onVaultModify` already does `app.vault.cachedRead(file as
  TFile)` for the *current* file's external-change path — the same call
  works for reading a **different** file's contents on demand.
- **No vault-wide file list/search exists in this codebase yet** — grepped;
  the only file I/O is the current-file read/write path. R4's "pick a
  document" combobox needs `app.vault.getMarkdownFiles()` plus a client-side
  fuzzy filter, built fresh (mirroring the existing node-combobox's
  filter-as-you-type pattern in `LinkModal.renderRelationCombobox`).
- **The inline editor never re-syncs with pan/zoom.**
  `InlineEditor` (`src/view/InlineEditor.ts`) is positioned `absolute` at a
  `rect.left/top` computed **once**, at construction, from
  `SvgRenderer.getNodeScreenRect(nodeId)` (called once in
  `MindMapView.openInlineEditor`). Panning/zooming is driven by
  `SvgRenderer.onWheel` (`src/render/SvgRenderer.ts:1419`, wheel-without-ctrl
  = two-finger swipe = pan, wheel-with-ctrl = pinch-zoom), which mutates
  `this.view.tx/ty/scale` and applies them via the existing rAF-batched
  `scheduleApplyViewport` — nothing in that path knows or cares that an
  inline editor overlay exists, so the overlay is left stranded at its
  original screen coordinates the instant the transform changes. This is
  exactly the reported bug ("if scrolled horizontally or vertically node
  edit box remains in the beginning position"). Background drag-pan (if the
  renderer supports it independently of wheel) needs the same check before
  implementing F3 — confirm at implementation time whether a second pan
  entry point exists beyond `onWheel`.
- **`SvgRenderer` has no existing "viewport changed" callback/hook** — one
  needs to be added (fired from wherever `scheduleApplyViewport` actually
  applies `tx/ty/scale` to the DOM, i.e. after the rAF, not on every raw
  wheel event) for `MindMapView`/`InlineEditor` to subscribe to.

---

## F3 — Inline editor must track its node during pan/zoom

### Root cause
See grounding above: `InlineEditor`'s `rect` is a one-time snapshot; nothing
re-runs `getNodeScreenRect` or updates the overlay's position when
`SvgRenderer`'s viewport transform changes underneath it.

### Design (resolved: **live-reposition**, per user decision D8)
- `SvgRenderer` exposes a viewport-change hook (e.g.
  `setViewportChangeHandler(cb: () => void)`, fired once per applied frame
  from the same place `scheduleApplyViewport` already applies the transform
  — not per raw wheel event, to stay batched) alongside the existing
  `setCrossDocBadgeClickHandler`-style setter pattern.
- `MindMapView` subscribes once; while `this.inlineEditor` is set, on each
  fired callback it recomputes `renderer.getNodeScreenRect(nodeId)` for the
  node currently being edited and pushes the new `left/top` (and, since
  zoom changes font size too, `fontSize`) into the `InlineEditor` — needs a
  small new method on `InlineEditor` (e.g. `reposition(rect, fontSize)`)
  since today's `rect`/`fontSize` are constructor-only.
- No-op (skip the recompute entirely) whenever no inline editor is open —
  the common case — so this adds zero cost outside an active edit session.

### Performance
New per-frame work only exists during the narrow overlap of "editor open"
AND "actively panning/zooming" — both rare and user-driven, and the
recompute is the same cheap `getNodeScreenRect` call `openInlineEditor`
already does once today. Does not touch the edge/node dirty-tracking or
culling hot paths. This was surfaced to the user as a perf-adjacent
trade-off (CLAUDE.md rule 3) before being decided — see D8.

### Tests
- Simulate opening the inline editor, then firing the viewport-change hook
  with a changed `tx/ty/scale` (mock `getNodeScreenRect` to return a moved
  rect) → assert the overlay's `left`/`top` style updates to the new rect.
- No inline editor open → firing the hook does not call
  `getNodeScreenRect` (cheap guard actually skips work, not just does
  nothing visible).

---

## R3 + R5 — Relation/link modal redesign: list existing items, support multiple relations

### Concept (from the updated note)
Replace today's single-edit "Edit link" modal with one that:
1. **Lists every relation/link already on the node** (parsed from its text),
   each with a **Remove** button.
2. Offers an **add flow** gated by a **radio button**: *Document relation*
   (default) or *Link* (today's free-text wikilink/URL/path editor,
   confirmed correct as-is by the note — unchanged).
3. Under *Document relation*, **two comboboxes**: pick a document, then pick
   a node inside it (R4, below, for the "inside it" part when the document
   isn't the current file).

This is what makes **R5** (multiple relations from one source, to different
targets) possible: today a node's text can be *at most one whole link*
(Round 2 grounding above); the redesign moves authoring from
"replace-the-whole-text" to "append/remove one relation at a time," which
the model/renderer/serializer already tolerate (they were never the
bottleneck — only the modal + `openLinkEditor` were).

### Design
- **Append format (resolved: visible append, per user decision D7):** adding
  a relation appends to the node's existing text rather than replacing it:
  `text.trim() ? \`${text} → ${linkText}\` : linkText` (plain arrow
  separator, not part of the link itself — so `getDisplayText` shows e.g.
  "Kickoff → Design review" once a second relation is added to a node that
  already said "Kickoff"). `linkText` is `buildLinkText(...)` exactly as
  today, just concatenated instead of substituted.
- **Removing one relation** must strip exactly that occurrence (link text
  plus its leading `" → "` separator if it isn't the first/only one) from
  the node's text — needs a small new helper in `src/model/links.ts` (e.g.
  `removeLinkOccurrence(text, targetLinkText)` or index-based) rather than
  hand-rolled string surgery in the view layer, mirroring how
  `buildLinkText`/`parseTextSegments` already own the text format.
- **Listing existing items:** reuse `node.resolvedRelations` (already
  distinguishes same-doc vs cross-doc, already resolved every `onChange` —
  see `model/relations.ts`) for relations, plus `parseTextSegments` for any
  plain (non-relation) links, so the list shows each with a label + a
  same-doc/cross-doc/external-link badge.
- **`LinkModalOptions` callback shape changes** from the current
  one-shot `onSave`/`onRemove` to per-item actions, roughly:
  `onAddRelation(target: {fileId: "current" | vaultPath, nodeId: string}, label: string)`,
  `onAddLink(kind, target, label)`, `onRemoveItem(occurrenceIndex or a
  stable identifier)`. Each commits immediately (`commitRename`) and the
  modal's item list re-renders from the node's *new* text/relations rather
  than waiting for a final "Save" — since there's no longer one edit being
  built up, there's nothing to save at the end; a single "Close" button
  replaces "Save"/"Remove link".
- The existing hand-rolled node-search combobox
  (`renderRelationCombobox`) is the right pattern to extend for the "pick a
  node inside the selected document" combobox (R4) — same reasoning
  (Obsidian's `AbstractInputSuggest` doesn't reliably show inside a
  `Modal`).

### Performance
Modal-local work only (list rendering, text splicing on add/remove) — never
touches the layout/render hot path beyond the existing single
`commitRename` → `onChange` → relayout+re-render+`resolveRelations` cycle
each add/remove already goes through today for any node-text edit. No new
per-keystroke or per-frame cost.

### Tests
- `links.ts`: appending a relation to non-empty text produces
  `"existing → [[...]]"`; appending to empty text produces just the link;
  removing one of two appended relations leaves the other's text and
  separator intact (not e.g. a dangling `" → "`).
- `relations.ts`/model: a node with two same-doc relation links resolves
  to two `activeRelations` entries (already true today per Round 2
  grounding — add a test making it explicit/regression-proof once R5 makes
  it reachable from the UI).
- `LinkModal`-level (or a view-level test if `LinkModal` isn't independently
  instantiable): the item list shows N rows for N existing links; clicking
  a row's Remove calls the remove callback with that item identified
  correctly (not off-by-one when there are same-doc + cross-doc + plain
  links mixed).

---

## R4 — Cross-document relation authoring (two-step file + node picker)

### Concept
Under *Document relation*, combobox 1 lets the user search **every vault
`.md` file** (resolved: **all vault files**, per user decision D6; current
file listed/selected by default, since that's the common case); combobox 2
then lists the nodes **inside whichever file is selected** — for the
current file this is exactly today's `relationTargets` (unchanged,
in-memory, instant); for any other file, the plan is:

1. On first selecting a foreign file in combobox 1, read it
   (`app.vault.cachedRead(file)`) and parse it
   (`parseMindMap(text, file.basename)`), then walk its tree the same way
   `MindMapView.openLinkEditor`'s `collectTargets` does today, to populate
   combobox 2. Cache the parsed node list per file path for the lifetime of
   the modal (a vault can have many files; re-parsing on every keystroke in
   combobox 1 would be wasteful, though still off the layout hot path — this
   is a modal-local cache, not a new persistent cache).
2. On **Add**, re-read the foreign file fresh (don't trust the
   modal-open-time cache for the write — the file could have changed) and:
   - `forcePersistentId(targetNode, foreignModel.byId)` on the chosen node.
   - **Only write back if a new id was actually minted** (compare
     before/after, or have `forcePersistentId` report whether it minted —
     check its current signature/return value) — a node that already has a
     persistent id needs no write at all, so relating to the same foreign
     node twice, or to a node someone already related to before, touches
     that file zero times.
   - If a write is needed: `serializeMindMap(foreignModel)` then
     `app.vault.modify(foreignFile, serialized)` — a one-off read-modify-write
     outside the live debounced pipeline (that pipeline is for the
     *currently open* file only).
   - Build `[[<foreignBasename>#^id]]` (or `[[<foreignBasename>#^id|label]]`)
     in the *current* node via the same append mechanism as R5.
3. Known edge case to test manually, not solve with new infra: the foreign
   file is open unsaved in another pane at the same moment — flag as a
   known limitation in the progress log if hit, rather than building
   conflict resolution for it (out of scope unless the user asks after
   seeing it in practice).

### Performance
File search is a client-side substring filter over `app.vault.getMarkdownFiles()`
(an array Obsidian already maintains — no vault scan), same capped-results
pattern as the existing node combobox. Parsing a foreign file happens at
most once per file per modal session (cached), not on every keystroke, and
never on the mind-map canvas's own render/layout hot path. The foreign-file
write is a single vault call gated by "a new id was actually needed," not a
loop or a background job.

### Tests
- File combobox: filters `getMarkdownFiles()` by substring; current file
  appears first/pre-selected.
- Selecting a foreign file populates the node combobox from that file's
  parsed content; selecting a node in the *current* file still uses the
  existing in-memory path (no parse/read triggered).
- Add with a foreign node that has no persistent id: mints one, writes the
  foreign file exactly once, and the current node's text gets a correctly
  resolvable cross-doc link (round-trips through `classifyLink` as
  cross-doc, same as R2's existing detection).
- Add with a foreign node that already has a persistent id: **no**
  `vault.modify` call on the foreign file (mock/spy assertion).

---

## Milestones

> After each milestone: `npm test`; for R1/R2 run the fixtures + benches and log
> to `benchmarks.md`; manual dev-vault check (Electron — no automated visual
> verification, report what was checked); log decisions in `DECISIONS.md`;
> update [PROGRESS-relations-and-ux-fixes.md](PROGRESS-relations-and-ux-fixes.md).

- **M-F1** — color invariant fix (F1). Tests green; manual copy/paste + drag
  color check.
- **M-F2** — new-node ensure-visible (F2), per D4. Tests green; manual
  large-map Tab/Enter check.
- **M-R1a** — relation data model + resolution + `relationsG` rendering +
  `showRelations` toggle, authored via existing links (D1/D2a). Benchmarks.
- **M-R1b** *(optional, if D2b chosen)* — drag-to-connect authoring gesture.
- **M-R2** — cross-document relation indicator (D3 minimum).
- **M-F3** — inline editor live-repositions during pan/zoom (F3, per D8).
  Tests green; manual check: open an editor, two-finger-swipe pan and
  pinch-zoom while typing, confirm the box stays glued to its node.
- **M-R3/R5** — relation/link modal redesign: item list + remove, radio
  (Document relation / Link), append-based multi-relation authoring in the
  **current** document only (R4's foreign-file picker comes next). Tests
  green; manual check: add two same-doc relations from one node to two
  different targets, confirm both arrows render and both are individually
  removable.
- **M-R4** — cross-document two-step picker (all vault files + lazy
  parse/cache) and foreign-file write-back gated on "a new id was actually
  minted." Tests green; manual check: relate to a node in an unopened
  vault file, confirm the badge appears and click-through opens the right
  file/section; re-relate to the same node and confirm no second write
  (e.g. check the foreign file's mtime/undo history doesn't show a
  no-op edit).

---

## Open decisions (resolve before the dependent milestone; user decides)

| # | Decision | Options | Needed before | Recommendation | Status |
|---|---|---|---|---|---|
| D1 | How relations are **stored** | (a) inline markdown block-links · (b) `mindmap:` frontmatter entries | M-R1a | **(a)** — markdown is source of truth (N2/N3), round-trips natively | **Resolved: (a)** |
| D2 | How relations are **authored** | (a) existing Ctrl/Cmd+K link editor only · (b) add drag-to-connect gesture | M-R1a / M-R1b | ship (a) first, add (b) after | **Resolved: (a) only** |
| D3 | Cross-doc relation **display** richness | badge+click (min) · hover-preview/stub node (rich) | M-R2 | badge + click first | **Resolved: badge+click** |
| D4 | New-node **viewport** behavior | center always · minimal-pan ensure-visible | M-F2 | **minimal-pan** (better UX + cheaper) — but note says "centralized" | **Resolved: minimal-pan** |
| D5 | (perf, defer) arrow **visual fidelity** | cheap Bezier+arrowhead · rich routed/animated | during M-R1a | cheap first; **ask if richer wanted** | Default in effect (cheap); not revisited |
| D6 | Cross-doc **file-list scope** (R4) | (a) every vault `.md` file · (b) only files with existing `mindmap:` frontmatter | M-R4 | **(a)** — matches Obsidian's own link-autocomplete scope, no vault content scan needed | **Resolved: (a) all vault files** |
| D7 | Multi-relation **append format** (R3/R5) | (a) invisible append (empty alias) · (b) visible append (`" → target label"`) | M-R3/R5 | (a) keeps labels clean | **Resolved: (b) visible append** |
| D8 | Inline-editor **pan/zoom behavior** (F3, perf-adjacent — CLAUDE.md rule 3) | (a) live-reposition every frame · (b) commit-and-close on pan/zoom start | M-F3 | (a) — narrow/rare overlap, better UX | **Resolved: (a) live-reposition** |

D1–D8 are all resolved as of 2026-07-18. D5 was never revisited (still the
Round-1 cheap default) — flag it again only if the subagent or the user
finds cheap arrows visually insufficient once R5 makes multi-relation nodes
common.

---

## Per-item workflow (every milestone)
1. Re-read this plan's item section; confirm its open decisions are resolved.
2. Implement, honoring the performance rules (O(changed) over O(all); nothing
   new on the keystroke/pan hot paths; no full re-render or full re-parse per
   edit).
3. `npm test` — the item's listed tests must pass.
4. Perf-relevant items (R1, R2): `npm run fixtures` + `bench:m1`/`bench:m2`
   (+ a relations bench if warranted), compare to budgets, record in
   `benchmarks.md`.
5. Manual dev-vault verification (`npm run dev`, Obsidian). Report what was
   checked; do not claim automated visual verification.
6. Log any architectural/perf decision in `DECISIONS.md`.
7. Update the status in the progress tracker, then move on.
8. **Do not commit** unless the user explicitly asks — this batch is
   review-then-commit-by-the-user.

---

## Round 3 — separate "Associations:"/"Links:" lines (supersedes D7)

> **Status: built, then rolled back (2026-07-18).** The user tried this in
> practice and preferred the original D7 visible-append-into-`node.text`
> approach after seeing both — "the approach in the attached image with
> arrows was better." Everything below is kept as a historical record of
> what was designed/built and why (per this plan's append-only discipline),
> not as active guidance — **the current, active behavior is D7 (visible
> append, `" → "` separator, into `node.text`), unchanged from before this
> section.** Do not re-implement this section without a fresh ask.

### What prompted this
Round 2's D7 (visible append) writes an added relation/link straight onto
the node's own line: `existing text → [[...|label]]`. The user showed a
screenshot of exactly this, viewed as an ordinary Obsidian note (not the
mind-map canvas) — Obsidian renders the wikilinks/mdlinks inline, so the
line reads as one run-on, half-underlined sentence mixing the node's own
words with everything it's related to. Two decisions were put to the user
before this section was written:
- **Storage location:** resolved — **separate lines under the node**, not
  appended to its own line. This is the one that actually fixes the
  screenshot, since it changes the markdown itself, not just the canvas.
- **Canvas rendering:** resolved — **markdown + modal only**. The existing
  arrows (same-doc, R1) and cross-doc badge (R2) remain the canvas-visible
  indicators, unchanged. No new per-node rendering/layout work, no new
  wrap-and-measure pass, no change to `layoutEngine.ts`/`SvgRenderer.ts`'s
  node-box sizing at all — this was the perf-sensitive question (CLAUDE.md
  rule 3) and the richer option (rendering the lines on-canvas too, which
  would need `computeNodeBox` to size around up to 3 stacked text blocks
  instead of 1, the same way the image-thumbnail block already does) was
  explicitly not chosen.

### Target format
Directly beneath a node's own heading/list line, two new optional plain
lines (not list items, not headings — same "non-structural line" category
`attachedContent` already occupies, but recognized specially instead of
falling into that generic bucket):

```
- Node's own plain text
  Associations: [[#^abc|Target A]] : [[OtherFile#^xyz|Target B]]
  Links: https://example.com : [[SomeFile]]
```

- `Associations:` holds every **Document relation** the modal's add flow
  produced (same-doc arrow targets and cross-doc targets alike — both go
  through the node-picker/`forcePersistentId` path). `Links:` holds every
  plain **Link** (the free-text wikilink/URL/path flow) — the two
  modal radio options map 1:1 onto the two lines, matching the user's own
  framing (relations vs. links to external resources).
- Separator is `" : "` (space-colon-space) between items on the same line —
  the user asked for "colon separated"; a bare `[[...]]`/`[label](url)`
  occurrence is exactly what `buildLinkText` already produces, so this is
  the same join-by-separator mechanic Round 2 built for the arrow
  separator, just applied to a different pair of fields with a different
  separator string and no leading node-text prefix.
- **The node's own `text` field goes back to being link-free** (plain
  label only) once this ships — the modal's add flow no longer touches it
  at all. A user can still hand-type a `[[wikilink]]` directly into a
  node's own label if they want to (that's ordinary node-text content,
  unrelated to this feature, and `SvgRenderer`'s existing link-click
  handling on node text is untouched) — the change is only that the
  **modal** stops writing into `node.text`.

### Grounding: exactly where this plugs into the existing pipeline

- **Parser (`src/sync/parser.ts`)** — every non-heading/non-list line
  already becomes `pendingContent`, flushed onto whichever node is on top
  of the frame stack by `flushPendingContent(target)` (called right before
  a new heading/list line is processed, and once more at EOF) — see lines
  ~74-78 and the loop's `pendingContent.push(line)` fallback (~142). This
  is exactly the hook point: inside `flushPendingContent`, before
  concatenating the batch onto `target.attachedContent`, peel out any line
  matching `^\s*Associations:\s*(.*)$` / `^\s*Links:\s*(.*)$` into
  `target.relationsRaw` / `target.linksRaw` respectively; everything else
  still falls through to `attachedContent` exactly as today. No change to
  the main loop's heading/list branches needed.
  - **Known edge case, not solved, document don't block on:** a line of
    arbitrary user prose that happens to start with "Associations:" or
    "Links:" (case-sensitive, same capitalization the modal writes) would
    be misidentified. Same class of ambiguity as any keyword-sniffing
    format; not worth a stricter grammar for a plugin-internal
    convention — flag it in a doc comment, don't build a disambiguation
    scheme.
- **Model (`src/model/types.ts`)** — add `relationsRaw?: string` and
  `linksRaw?: string` to `MindNode`, alongside the existing
  `attachedContent?: string[]`. These are **not** frontmatter-style
  metadata (unlike `folded`/`manualPos`/`manualWidth`/
  `externalRelationTarget`) — they're ordinary markdown content, so they
  don't touch `nodeHasPersistableMeta`/`collectMeta`'s frontmatter
  machinery at all, same as `attachedContent` today.
- **`src/model/mutations.ts`'s `cloneSubtree`** (~line 190) currently
  copies `text`/`folded`/`manualWidth`/`attachedContent` and drops
  `colorKey`/`manualPos`/`branchSide` intentionally (see F1's fix above).
  Add `relationsRaw`/`linksRaw` to the copied set (paste keeps a node's own
  relations/links, same as it keeps `attachedContent` today) — flag as a
  known/accepted quirk, not a bug to fix here: a same-doc relation target
  id that gets duplicated via paste behaves the same as any other
  duplicated block id already does elsewhere in this codebase (out of this
  item's scope to change).
- **Serializer (`src/sync/serializer.ts`)** — `serializeNode` (~line 81)
  emits the node's own line, then `attachedContent`, then recurses into
  children. Insert `Associations: <relationsRaw>` and `Links: <linksRaw>`
  (only when non-empty) immediately after the node's own line and before
  `attachedContent`/children, at a 2-space-deeper indent than the node's
  own line (matching the child-list-item indent convention visually, even
  though indentation isn't structurally significant for a non-list line —
  the parser's recognition regex tolerates arbitrary leading whitespace).
  `goToSection.ts`'s `findNodeLine` (~line 39/47) mirrors this exact
  emission order to compute line-number fallback targets — it currently
  does `line += 1 + (node.attachedContent?.length ?? 0)` per node; **this
  must become `line += 1 + (relationsRaw?1:0) + (linksRaw?1:0) +
  (attachedContent?.length ?? 0)`, in the same order they're actually
  emitted, or the "go to line" fallback silently drifts by 1-2 lines for
  any node that has either field set.** Easy to miss; call it out
  explicitly in the implementation.
- **Relation resolution (`src/model/relations.ts`)** — `getCachedLinks`,
  `classifyLink`, `resolveRelations`, and `listNodeLinkItems` (all added/
  extended in Round 2) currently scan `node.text`. They need to scan
  `node.relationsRaw` for relation items and `node.linksRaw` for link
  items instead — two independent scans/caches rather than one, mirroring
  the two separate fields. `resolveRelations`'s arrow/badge output should
  come **only** from `relationsRaw` (arrows and the cross-doc badge are
  relation-specific, R1/R2's existing canvas indicators — unaffected by
  this change otherwise); `linksRaw` items never produce an arrow or
  badge, just a plain entry in the modal's item list.
  - `LinkItem`'s `occurrenceIndex` (a single flat index into one string
    today) needs to become dual — e.g. `{ list: "relations" | "links";
    occurrenceIndex: number }` — since there are now two independent lists
    a removal must identify by (list, index), not by one shared index.
- **Text-splice helpers (`src/model/links.ts`)** — `appendLinkText`/
  `removeLinkOccurrence` (Round 2) currently hardcode `" → "` and operate
  on whatever string they're given. Repurpose the separator to `" : "`
  (the arrow-append behavior for `node.text` is being fully replaced, not
  kept alongside this — there is no remaining caller that wants the arrow
  form once this ships) and keep them field-agnostic (still just `(text,
  linkText)` → new string) so the view layer can call them against
  `relationsRaw` or `linksRaw` depending on which the action targets.
- **Modal/view wiring (`src/view/LinkModal.ts`, `src/view/MindMapView.ts`)**
  — Round 2's `onAddRelation`/`onAddLink`/`onRemoveItem` callback shape,
  the radio button, and the document/node comboboxes (R4) all stay
  conceptually correct and should be **adapted, not rewritten**: the
  *only* change is which field each commits into
  (`onAddRelation`/`onRemoveItem` for a relation-kind item → splice
  `node.relationsRaw`; `onAddLink`/`onRemoveItem` for a link-kind item →
  splice `node.linksRaw`) and how items are identified for removal (the
  new dual `{list, occurrenceIndex}` shape). The foreign-file write-back
  logic (`src/sync/foreignRelation.ts`) and the durability fix
  (`externalRelationTarget`) are entirely unaffected — they operate on the
  *target* node in the *foreign* file, which still gets a forced
  block-id the same way regardless of which field the *source* node's
  reference lives in.

### Performance
No new work on the layout/render hot path (canvas rendering is explicitly
unchanged per the resolved decision above) — this is parser/serializer/
modal-local text bookkeeping only, same cost class as `attachedContent`
already is today (a couple of extra string fields per node, populated only
when present). `resolveRelations`'s per-node scan now checks two fields
(`relationsRaw`/`linksRaw`) instead of one (`node.text`), each still gated
by the same cheap "no `[` in the string" fast path — negligible, not on any
per-keystroke path (parsing/resolving happens at `onChange` granularity,
same as Round 2).

### Tests
- Parser: a node followed by `Associations: ...` / `Links: ...` lines
  (in either order, or only one present, or neither) parses into
  `relationsRaw`/`linksRaw` correctly; a plain prose line that happens to
  start with those words but isn't in the expected position still falls
  through to `attachedContent` as before (documenting the known ambiguity,
  not required to disambiguate perfectly).
- Serializer + `findNodeLine`: round-trip a node with both fields set —
  serialize, re-parse, confirm identical fields; confirm `findNodeLine`'s
  count for a later sibling node lands on the correct line when an earlier
  node has one/both/neither of these fields present.
- `model/relations.ts`: `listNodeLinkItems` returns relation items sourced
  from `relationsRaw` and link items from `linksRaw`, each with correctly
  independent `occurrenceIndex`; `resolveRelations`'s arrow/badge output is
  unaffected by `linksRaw` content (a node with only `linksRaw` set
  produces zero arrows/cross-doc badges).
- `model/links.ts`: append/remove against `" : "`-joined text, same
  first/middle/last removal correctness Round 2 already tests for the
  arrow form, just with the new separator.
- View/modal wiring: adding a relation writes to `relationsRaw` and leaves
  `text`/`linksRaw` untouched; adding a link writes to `linksRaw` and
  leaves `text`/`relationsRaw` untouched; removing an item identified by
  `{list, occurrenceIndex}` never touches the other list.

### Milestone
**M-R6** — Associations:/Links: separate-line storage (supersedes D7's
append-to-`node.text` behavior). Depends on nothing further from the user;
both open questions for this round are already resolved. Tests green;
manual check: add a same-doc relation and an external link to a node from
the modal, confirm the node's own text is untouched and two new lines
appear directly under it when the file is viewed as an ordinary note;
confirm "Go to note section" on a later sibling still lands on the correct
line.
