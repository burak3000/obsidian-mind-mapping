# Plan — Relations feature + copy-color & new-node-centering fixes

Source: [dev-vault/Tool notes.md](../dev-vault/Tool%20notes.md), analyzed 2026-07-18.
Companion tracker: [PROGRESS-relations-and-ux-fixes.md](PROGRESS-relations-and-ux-fixes.md).
This plan follows the same discipline as [MASTER-PLAN.md](MASTER-PLAN.md): every
item is grounded in the current code, carries a performance note, and lists its
tests. **Performance rules in [CLAUDE.md](../CLAUDE.md) override anything here;
any performance-vs-anything trade-off must be surfaced to the user, never
decided by the implementer.**

## Scope (four items from the notes)

| # | Item | Type | Effort |
|---|---|---|---|
| R1 | Show relations between nodes **in the same document** as a toggleable arrow | Feature | L |
| R2 | Show relations to a node **in a different document** | Feature | M |
| F1 | Pasted/moved branch must adopt the **target branch's color**, not keep its old one | UX bug | S |
| F2 | A newly created node must be **brought into view** before its editor opens | UX bug | S |

Recommended order: **F1 → F2 → R1 → R2** (ship the two low-risk fixes first;
R2 builds on R1's link-resolution work). R1/R2 depend on open decisions D1–D3
below — those must be resolved before their milestones start.

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

---

## Open decisions (resolve before the dependent milestone; user decides)

| # | Decision | Options | Needed before | Recommendation |
|---|---|---|---|---|
| D1 | How relations are **stored** | (a) inline markdown block-links · (b) `mindmap:` frontmatter entries | M-R1a | **(a)** — markdown is source of truth (N2/N3), round-trips natively |
| D2 | How relations are **authored** | (a) existing Ctrl/Cmd+K link editor only · (b) add drag-to-connect gesture | M-R1a / M-R1b | ship (a) first, add (b) after |
| D3 | Cross-doc relation **display** richness | badge+click (min) · hover-preview/stub node (rich) | M-R2 | badge + click first |
| D4 | New-node **viewport** behavior | center always · minimal-pan ensure-visible | M-F2 | **minimal-pan** (better UX + cheaper) — but note says "centralized" |
| D5 | (perf, defer) arrow **visual fidelity** | cheap Bezier+arrowhead · rich routed/animated | during M-R1a | cheap first; **ask if richer wanted** |

D1 and D4 change what gets built and must be answered before M-R1a / M-F2
respectively. D2/D3/D5 have safe recommended defaults and can be confirmed in
flight.

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
