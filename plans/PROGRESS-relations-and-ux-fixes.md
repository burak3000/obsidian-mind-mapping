# Progress — Relations feature + copy-color & new-node-centering fixes

Tracker for [PLAN-relations-and-ux-fixes.md](PLAN-relations-and-ux-fixes.md).
Source notes: [dev-vault/Tool notes.md](../dev-vault/Tool%20notes.md).
Implementation is done by a **Sonnet 5 subagent**, milestone by milestone, under
coordinator (this session) guidance. Performance trade-offs and the open
decisions below are the **user's** to make — never the subagent's (CLAUDE.md
rule 3). **Nothing is committed without the user's explicit say-so.**

_Created 2026-07-18. Last updated: 2026-07-18 (Round 2 kickoff)._

## Milestone status

| Milestone | Item | Status | Blocked on |
|---|---|---|---|
| M-F1 | Color invariant fix (pasted/moved branch adopts target color) | **Done** — committed `cc1bf66` | — |
| M-F2 | New node brought into view before editor opens | **Done** — committed `cc1bf66` | — |
| M-R1a | Same-doc relation model + rendering + toggle | **Done** — committed `f58b3c1` (searchable combobox) + earlier commits | — |
| M-R1b | Drag-to-connect authoring gesture (optional) | **Cut for now** | D2 → chose Ctrl/Cmd+K only |
| M-R2 | Cross-document relation indicator | **Done** — committed | — (D3 default) |
| — | Several follow-on UX fixes (Mod+Shift+L rebind, link-click-vs-select, fold-badge hit-target, side-by-side badge/handle, Mod+Shift+C fold toggle, context-menu dead-zone fixes ×3) | **Done**, see Round 1 log entries below | — |
| **M-F3** | Inline editor live-repositions during pan/zoom (D8) | **Done** — `SvgRenderer.setViewportChangeHandler` + `InlineEditor.reposition`, see log below | — |
| **M-R3/R5** | Relation/link modal redesign: item list + remove, radio (Document relation/Link), append-based multi-relation authoring (current doc) | **Done** — see log below; **not committed** (awaiting review) | — |
| **M-R4** | Cross-document two-step picker (all vault files) + foreign-file write-back | **Done** — see log below; cross-doc target durability gap (see log) **now closed**; **not committed** (awaiting review) | — |
| **M-R6** | Separate `Associations:`/`Links:` markdown lines, superseding D7's append-to-node-text | **Rolled back** — user tried it, preferred the D7 visible-arrow-append approach after seeing both in practice; see log below | — |

Status legend: Not started · In progress · Blocked (awaiting decision) · Done
(tests + benchmarks recorded, awaiting user review/commit).

## Open decisions (must be answered before the dependent milestone)

| # | Decision | Needed before | Status |
|---|---|---|---|
| D1 | Relation storage: inline md links vs frontmatter | M-R1a | **Resolved: inline markdown block-links** |
| D2 | Relation authoring: Ctrl/Cmd+K only vs drag-to-connect | M-R1a / M-R1b | **Resolved: Ctrl/Cmd+K link editor only** (drag-to-connect cut) |
| D3 | Cross-doc display: badge+click vs richer preview | M-R2 | Default: **badge + click** (confirm in flight) |
| D4 | New-node viewport: center always vs minimal-pan | M-F2 | **Resolved: minimal-pan / ensure-visible** |
| D5 | (perf, defer) arrow fidelity: cheap vs rich | during M-R1a | Default: **cheap Bezier+arrowhead** (ask if richer wanted) |
| D6 | Cross-doc file-list scope: all vault `.md` files vs frontmatter-filtered | M-R4 | **Resolved: all vault `.md` files** |
| D7 | Multi-relation append format: invisible vs visible append | M-R3/R5 | **Re-resolved: visible append into `node.text`** (D9/D10's separate-lines approach was tried in M-R6 and rolled back — see log) |
| D8 | Inline-editor pan/zoom behavior: live-reposition vs commit-and-close | M-F3 | **Resolved: live-reposition** |
| D9 | Round 3: where do Associations:/Links: live in the markdown | M-R6 | **Rolled back** — built and tried; user preferred D7's original append-into-`node.text` after seeing both in the note view |
| D10 | Round 3: do Associations:/Links: also render on the canvas node box | M-R6 | **Moot** — M-R6 (which this gated) was rolled back |

## Log

- **2026-07-18** — Notes analyzed; plan + this tracker written by the
  coordinator. Root causes identified: F1 = `cloneSubtree`/`moveNode` leaving a
  stale `colorKey` that shadows inheritance (fix: enforce "colorKey only on
  root's direct children"); F2 = new-node path opens the inline editor without
  first panning the node into view (fix: reuse `centerOnWorldPoint`). R1/R2
  map onto the existing links + block-id + renderer-layer infrastructure.
  Subagent **not yet launched** — awaiting the user's decisions on D1 & D4 (and
  their rate-limit window), since those change what M-R1a / M-F2 build.
- **2026-07-18** — User resolved D1 (inline markdown block-links), D2
  (Ctrl/Cmd+K link editor only; drag-to-connect cut), D4 (minimal-pan/
  ensure-visible). Sonnet 5 subagent launched on M-F1 + M-F2 (both small,
  low-risk, decisions resolved); instructed to stop before M-R1a for a review +
  benchmark gate on the perf-sensitive relations work.

- **2026-07-18** — M-F1 + M-F2 implemented by the subagent and reviewed by the
  coordinator (diffs confirmed): F1 enforces the colorKey invariant in
  `assignMissingColors` + drops it in `cloneSubtree`; F2 adds
  `SvgRenderer.ensureWorldRectVisible` (minimal-pan, synchronous re-cull) wired
  through `MindMapView.onEditRequest`. 304 tests pass; build typecheck clean.
  DECISIONS.md updated with two entries. **Not committed** (user reviews/commits).
  Two open notes from the subagent: (1) `pasteImageAsChild` opens no editor
  today, so ensure-visible doesn't attach there — left as-is, not silently
  expanded; (2) `dev-vault/SBOM in TIA Release Pipeline.md` shows modified from a
  live Obsidian instance, unrelated to this work. Paused before M-R1a for user
  review/commit (rate-limit sensitivity + keeping the relations diff separate).

- **2026-07-18** — User reported `Ctrl/Cmd+K` didn't open the link/relation
  editor; root cause is Obsidian's own core "Insert markdown link" command
  defaulting to the same binding and winning the keystroke (same class of
  collision the Rebalance command hit on `Mod+Shift+B`). Rebound the link
  editor to **`Ctrl/Cmd+Shift+L`** (no conflict found) — coordinator made
  this change directly (small, mechanical). Updated: `MindMapView.ts`
  keydown handler + its doc comment, `LinkModal.ts` doc comment,
  `links.ts` comments, `README.md` (feature bullet + shortcut table). Left
  `DECISIONS.md` and `obsidian-mindmap-plugin-plan.md` untouched (historical
  records of what was actually decided/built at the time). 336 tests pass;
  rebuilt into dev-vault.

- **2026-07-18** — User reported node-selection was hard on any node whose
  text contains a link, since a plain click on the link text always
  navigated instead of selecting. `SvgRenderer.onClick`'s `.mm-node-link`
  branch now only navigates on Ctrl/Cmd+click; a plain click falls through
  to normal node selection. Updated the two `renderer.smoke.test.ts` tests
  that asserted the old always-navigate behavior to use a modifier click,
  and added one confirming a plain click selects instead. Image-embed
  clicks and the cross-doc relation badge are unchanged (not reported as an
  issue; visually distinct from inline link text). 337 tests pass; rebuilt
  into dev-vault. Coordinator made this change directly (small, mechanical).

- **2026-07-18** — User reported the fold/unfold badge "mixes with
  extending/shrinking nodes" and sometimes doesn't expand on click.
  Root-caused to two compounding issues in `SvgRenderer`: (1) the resize
  handle spans a node's *full height* at the same edge the badge sits on
  (badge is only ~16px across), so an imprecise click a few px off badge
  center lands on the resize strip instead; (2) `onPointerDown` had no
  special case for `.mm-fold-badge`/`.mm-cross-doc-badge` (unlike the
  resize handle), so even a clean hit fell through to the generic
  node-drag branch, where a few px of hand jitter between pointerdown/up
  could get misread as a drag/reorder instead of a click. Fixed both: (1)
  added an invisible, larger (`r=13` vs the visible `r=8`) `fill="transparent"`
  hit-circle in front of the visible badge circle, reclaiming more of that
  shared edge column for badge clicks; (2) `onPointerDown` now returns
  immediately for both badge classes, before the resize-handle/node-drag
  checks. Added 3 tests (hit-circle structure + a real
  pointerdown/move/up/click sequence with jitter). 339 tests pass;
  rebuilt into dev-vault. Coordinator made this change directly (small,
  mechanical, verified the regression test actually failed against the
  pointerdown fix reverted before keeping it).

- **2026-07-18** — User asked to go further than the hit-target fix: put
  the resize handle and fold badge physically side by side instead of
  stacked on the same node edge, orientation-aware (resize handle stays
  adjacent to the box; badge sits further out, in whichever direction that
  side's branch already grows — negative x for `branchSide "L"`, positive
  x beyond the box for `"R"`). Implemented in `SvgRenderer.upsertBadge`:
  new `BADGE_OUTWARD_OFFSET` constant (`RESIZE_HANDLE_HALF_WIDTH` (3) +
  `BADGE_OUTWARD_GAP` (4) + `BADGE_HIT_RADIUS` (13) = 20px), badge
  transform now `-20` / `layout.w + 20` instead of `0` / `layout.w`. Kept
  the enlarged invisible hit-circle from the prior fix (still helps
  precision on the small badge; no longer needed to resolve overlap with
  the resize handle specifically, since they no longer touch). Added a
  test asserting both L/R badge positions clear the resize handle's column
  by at least its half-width + the hit-circle radius. 340 tests pass;
  rebuilt into dev-vault. Coordinator made this change directly.

- **2026-07-18** — User asked for `Ctrl/Cmd+Shift+C` to toggle fold/unfold
  (checked first: not bound to anything in this plugin — only Obsidian's
  own live hotkey registry can't be checked from code, same caveat as the
  Mod+K/link-editor collision). Added as a *second* binding alongside the
  existing `Ctrl/Cmd+/` (not a replacement) in `MindMapView`'s keydown
  handler; README shortcut table updated. No test added — `MindMapView`
  isn't unit-instantiable (needs the real Obsidian API), same as the
  Mod+Shift+L rebind. 340 tests pass; rebuilt into dev-vault.

- **2026-07-18** — User reported the node context menu (right-click) had
  stopped working. Self-inflicted regression from the immediately prior
  side-by-side badge fix: `BADGE_OUTWARD_GAP` (4px) left a real gap of
  unpainted canvas between the resize handle and the badge's hit-circle —
  a right-click landing in that dead space hit no `.mm-node` element at
  all, so `onContextMenu` returned early without `preventDefault()` and
  the custom menu never opened. Fixed by setting `BADGE_OUTWARD_GAP` to 0
  — the two now sit flush/touching, not overlapping and not gapped, so
  every pixel from the box edge outward through the badge resolves to the
  node. Added two regression tests: an exact touching-boundary geometry
  check, and an end-to-end test dispatching a real `contextmenu` event on
  both the badge and the resize handle, confirming the menu handler fires
  either way. 342 tests pass; rebuilt into dev-vault. Coordinator made
  this change directly, having found and fixed its own regression.

- **2026-07-18** — User clarified the actual intent after the dead-gap fix:
  the context menu had been opening on the fold badge (and would on the
  resize handle too), which they don't want — only right-clicking the node
  body itself should open it. `SvgRenderer.onContextMenu` now excludes
  `.mm-resize-handle`/`.mm-fold-badge`/`.mm-cross-doc-badge` explicitly
  (mirroring the existing pointerdown dead-zone exclusion), calling
  `preventDefault()` and returning without invoking the menu handler for
  either. Rewrote the just-added end-to-end context-menu test to assert
  the corrected behavior (badge/handle → no menu; node box → menu opens).
  342 tests pass; rebuilt into dev-vault.

- **2026-07-18** — User reported the previous fix over-corrected: right-click
  now showed nothing at all, even on the node body itself, not just the
  (correctly) excluded badge/resize-handle. Root cause: `onPointerDown` had
  never checked which mouse button was pressed, so a right-click's
  pointerdown was treated identically to a left-click's and called
  `capturePointer` — plausibly retargeting the `contextmenu` event Chromium
  synthesizes afterward, the same class of problem `resolveClickOrigin`
  already exists to work around for `click`/`dblclick` (that workaround was
  never applied to `onContextMenu`, on the now-suspect assumption that
  right-clicks don't engage it). Two fixes: (1) `onPointerDown` now returns
  immediately for `evt.button === 2`, before any drag/resize/capture logic
  — a right-click should never start those gestures at all; (2)
  `onContextMenu` now resolves its target via the existing
  `resolveClickOrigin` (`elementsFromPoint`) instead of raw `evt.target`,
  matching `onClick`'s defensive pattern, as a second line of defense.
  Added a regression test confirming a right-click pointerdown with real
  movement never fires manual-move/resize/reorder. Not independently
  re-verified against a real Obsidian window (can't drive Electron
  headlessly) — user re-testing is the actual confirmation. 343 tests pass;
  rebuilt into dev-vault.

- **2026-07-18** — Note re-checked; it now asks for a fuller relations
  model (external-resource links vs. in-map/cross-doc relations, explicitly
  via a radio-button-driven modal with two-step file+node autocomplete for
  document relations, and multiple relations from one source node) plus a
  new UX bug (inline editor doesn't track its node when the canvas is
  panned/zoomed while editing). Re-grounded in the current code: confirmed
  a node's text can hold only one whole-text link today (authoring gap, not
  a parser/model/renderer gap — those already handle multiple links per
  node fine), confirmed `classifyLink` already treats any other-file
  wikilink as cross-doc with no changes needed, confirmed the pieces for a
  foreign-file write-back already exist (`parseMindMap`/`forcePersistentId`/
  `serializeMindMap`/`vault.modify`) just not wired together, and confirmed
  `InlineEditor` positions itself once at open time with no viewport-change
  hook to re-sync against. Put three decisions to the user before finalizing
  the plan (D6 file-list scope, D7 multi-relation append format, D8
  inline-editor pan/zoom behavior — the last is perf-adjacent per CLAUDE.md
  rule 3) — all three resolved (D6: all vault files, D7: **visible** append
  — not the coordinator's recommended invisible option, D8: live-reposition).
  `PLAN-relations-and-ux-fixes.md` updated with full grounding + design for
  F3, R3+R5 (tracked as one milestone — the list UI is what enables
  multiplicity), and R4. Sonnet 5 subagent (medium effort) launched next on
  F3 → M-R3/R5 → M-R4, in that order; this session continues as
  coordinator or the subagent's own follow-ups.

- **2026-07-18** — M-F3 implemented by the subagent. Root cause confirmed
  as grounded in the plan: `InlineEditor`'s `rect`/`fontSize` were
  constructor-only, positioned once at `MindMapView.openInlineEditor`
  (`src/view/MindMapView.ts:222`) time; `SvgRenderer.onWheel`
  (`src/render/SvgRenderer.ts:1419`) and the background-drag path in
  `onPointerMove` both mutate `view.tx/ty/scale` and apply them via the
  existing rAF-batched `scheduleApplyViewport`, with nothing re-syncing the
  overlay. Per D8 (resolved: live-reposition), added
  `SvgRenderer.setViewportChangeHandler(fn: () => void)` — a new subscriber
  slot fired once per applied frame from inside `scheduleApplyViewport`'s
  rAF callback (`src/render/SvgRenderer.ts`, right after the transform
  write + `recull()`), not per raw wheel/pointermove event. `MindMapView`
  subscribes once in `buildFromScratch` and tracks the currently-edited
  node in a new `editingNodeId` field, kept in lockstep with
  `inlineEditor` (set together in `openInlineEditor`, cleared together in
  `onCommit`/`onCancel`/`onCommitAndCreateChild`/`clear()`). Its callback,
  `repositionInlineEditorForViewport`, returns immediately when no editor
  is open (the cheap guard the plan asked for), otherwise recomputes
  `getNodeScreenRect`/`getNodeEditMetrics` for `editingNodeId` and calls a
  new `InlineEditor.reposition(rect, fontSize)` method (updates
  `left`/`top` always; re-measures width against the new font when
  `fontSize` changes, without discarding a height the user already grew
  past `rect.height` by typing multi-line content). Culling edge case:
  `getNodeScreenRect` returns `null` once a node's `lastLayout` entry is
  pruned by an extreme pan — handled by skipping that frame's reposition,
  not crashing or hiding the editor; picked back up on the next applied
  frame once the node re-enters the culled set. Added 5 tests: 3 in
  `test/inlineEditor.test.ts` (reposition updates left/top; updates
  fontSize and re-clamps width; no-op/no-throw after commit); 2 in
  `test/renderer.smoke.test.ts` (an integration test mirroring
  `MindMapView`'s exact wiring against `SvgRenderer` +
  `InlineEditor` directly, since `MindMapView` needs the real Obsidian API
  and isn't unit-instantiable — confirms a mocked moved rect only reaches
  the overlay after the next rAF, and that no editor open means the hook
  never calls `getNodeScreenRect`). 348 tests pass (343 baseline + 5);
  `npm run build` typechecks clean. `DECISIONS.md` updated with a new
  entry. No new performance-vs-anything trade-off surfaced beyond D8
  itself (already resolved) — nothing to ask. **Not committed** (user
  reviews/commits). Manual verification still needed in the dev vault
  (Electron, no automated visual check possible): open a map, double-click
  a node to edit, two-finger-swipe pan while typing and confirm the box
  stays glued to the node, then pinch-zoom the same way and confirm both
  position and text size track the node.

- **2026-07-18** — M-R3/R5 implemented by the subagent (reviewed diff: this
  entry). Redesigned `LinkModal` (`src/view/LinkModal.ts`) from the
  earlier one-shot "Edit link" (`onSave`/`onRemove`, replace-the-whole-text)
  modal into an item-list + radio-gated add-flow modal: every existing
  relation/link on the node is listed via a new `listNodeLinkItems(node,
  model, fileBasename)` (`src/model/relations.ts`) — walks
  `parseTextSegments` fresh (not `node.resolvedRelations`'s cache, which
  silently drops the same-file-but-unresolvable "ignored" case) and
  classifies each occurrence with a badge (`same-doc` / `cross-doc` /
  `external` / `unresolved`), each row individually removable. Adding a
  relation or link now *appends* to the node's text rather than replacing
  it — `appendLinkText(text, linkText)` (new, `src/model/links.ts`), per D7
  as resolved (**visible** append, `"existing → target label"`, plain
  arrow separator not part of the link syntax) — which is what lets one
  node carry multiple relations (R5). Removing one item strips exactly
  that occurrence plus its adjacent `" → "` separator via a new
  `removeLinkOccurrence(text, occurrenceIndex)` (`src/model/links.ts`,
  raw-regex-span splicing, not re-serialized from parsed segments, so
  every other link/text round-trips untouched). `LinkModalOptions`'s
  callbacks changed to per-item actions (`onAddRelation`/`onAddLink`/
  `onRemoveItem`), each committing immediately via the existing
  `commitRename` path and returning the node's refreshed item list for the
  modal to re-render — no more final "Save"; a single "Close" button.
  `MindMapView.openLinkEditor` rewired accordingly (imports
  `appendLinkText`/`removeLinkOccurrence`/`listNodeLinkItems`, drops the
  now-unused `getSoleLink` import).
  **Document-picker: stubbed vs. built (read this before starting M-R4).**
  This milestone is **current-document only** — no file/document combobox
  was built at all, per the plan's explicit scope split. The relation
  combobox is the same in-memory `relationTargets`/`collectTargets`
  pattern from the old `openLinkEditor`, unchanged. The only thing laid
  down for M-R4: `LinkModal.ts`'s new `RelationTarget` type is already a
  discriminated union with one member today
  (`{ fileId: "current"; nodeId: string }`) specifically so M-R4 can widen
  it to `{ fileId: string /* vault path */; nodeId: string }` without
  changing `onAddRelation`'s call sites. M-R4 still needs to build, from
  scratch: the file combobox itself (search `getMarkdownFiles()`), the
  per-file parse-and-cache-on-first-select step, and the foreign-file
  read-modify-write (`forcePersistentId` + `serializeMindMap` +
  `vault.modify`) — none of that exists yet.
  **Tests:** 15 new (363 total, up from 348 — see DECISIONS.md for the
  full breakdown by file). No test instantiates `LinkModal` directly
  (`extends Modal` from the types-only `obsidian` package — same
  not-unit-instantiable situation as `MindMapView`); the item-list/
  occurrence-index logic that actually needs correctness coverage
  (N-rows-for-N-links, same-doc + cross-doc + external + unresolved mixed
  without an off-by-one, remove-then-relist) lives in
  `listNodeLinkItems`/`removeLinkOccurrence` and *is* unit tested there.
  363 tests pass; `npm run build` typechecks clean. `DECISIONS.md` updated
  with one new entry (includes the index-based-vs-content-based removal-
  identifier call). No new performance-vs-anything trade-off surfaced —
  this is modal-local work (list rendering, text splicing on add/remove),
  never touching the layout/render hot path, same as the plan's own
  Performance section anticipated; nothing to ask. **Not committed** (user
  reviews/commits). Manual verification needed in the dev vault (Electron,
  no automated visual check possible) — see the coordinator's own
  checklist below.
  **Manual verification checklist (for a human in Obsidian):**
  1. Open a multi-node map, select a node, `Ctrl/Cmd+Shift+L` — confirm the
     modal now shows "Links & relations" with an (empty, if the node has
     no links yet) item list, an "Add" section with "Document relation"
     (pre-selected) and "Link" radio options, and a single "Close" button.
  2. With "Document relation" selected, search/pick another node, optionally
     type a display-text override, click "Add relation" — confirm: the
     item list now shows one row (label + a "Relation" badge), the modal
     stays open (doesn't close), and the node's canvas text now shows the
     picked node's label (or your override).
  3. Add a **second** relation to the same node, to a different target —
     confirm: the item list now shows two rows, and the node's on-canvas
     text reads `"first label → second label"` (the literal `" → "`
     arrow-separator character between them, per D7's visible-append
     resolution) — not just the second label alone, and not two separate
     canvas lines.
  4. Click "Remove" on the **first** of the two rows — confirm: the item
     list drops to one row (the second relation's), and the node's
     on-canvas text now reads just the second relation's label with **no**
     leading or dangling `" → "` left over. Repeat removing the other
     order (add two again, remove the *second* one this time) to confirm
     the first relation's text/separator survives intact either way.
  5. Switch the radio to "Link", fill in Link type + Target (+ optional
     Display text) as before, click "Add link" — confirm this path still
     behaves exactly as the old single-edit modal did: it appends a
     regular (non-relation) link to the node, shown in the item list with
     a "Cross-doc" or "External link" badge depending on target, and
     clicking it on the canvas still navigates/opens as before.
  6. Confirm undo (`Ctrl/Cmd+Z`) after an add or remove reverts the node's
     text/item-list correctly (each add/remove is its own `commitRename`,
     so should be its own undo step).

- **2026-07-18** — M-R4 implemented by the subagent (reviewed diff: this
  entry). Widened `LinkModal.ts`'s `RelationTarget` from the single-member
  placeholder M-R3/R5 left (`{ fileId: "current"; nodeId }`) to a `kind`-
  discriminated union: `{ kind: "current"; nodeId } | { kind: "foreign";
  filePath; nodeId }` (chose a tag field over the plan's literal
  `fileId: "current" | vaultPath` suggestion — cleaner exhaustive narrowing
  in TS). Added a "pick a document" combobox above the existing node
  combobox in the "Document relation" add form — `LinkModal`'s node/document
  comboboxes now share one generic `renderSearchCombobox<T extends {id,
  label}>` helper (replacing the old single-purpose
  `renderRelationCombobox`) so both get the same filter-as-you-type +
  `RELATION_COMBOBOX_MAX_RESULTS` cap. `CURRENT_DOCUMENT_ID` is always
  first/pre-selected (the common case).
  New module `src/sync/foreignRelation.ts` holds the two pieces of actual
  logic, deliberately kept free of any `obsidian` import (matching every
  other file in `sync/`/`model/` — the real `obsidian` package has no
  runtime JS at all) via a narrow structural `MinimalFile { path;
  basename }` type instead of the real `TFile`:
  `resolveRelationTargetsForDocument(docId, currentDocTargets, ctx)` (R4
  combobox-2's data source — `CURRENT_DOCUMENT_ID` resolves instantly with
  zero vault calls; any other id triggers a `cachedRead` + `parseMindMap`
  cached in a per-modal-session `Map<path, MindMapModel>` the caller owns)
  and `commitForeignRelationTarget(vault, file, pickerTimeTargetNode,
  mintBlockId?)` (the Add-time commit — re-reads the file **fresh**, not
  the picker-time cache). `MindMapView.openLinkEditor`
  (`src/view/MindMapView.ts`) wires both into real `app.vault` calls,
  builds the `documents` list from `app.vault.getMarkdownFiles()` (D6: all
  vault files, current file first), and owns the per-modal
  `foreignModelCache` Map (a fresh one per `openLinkEditor` call).
  **Node-identity problem found and solved:** synthetic ids (`nNN`,
  `model/id.ts`) come from one monotonic counter never reset between
  `parseMindMap` calls, so the picker-time parse and the commit-time fresh
  re-parse of the *same* file mint *different* synthetic ids for the same
  nodes — an id captured at picker time can't be looked up in the fresh
  model. Solved by reusing `findEquivalentNode` (`sync/reconcile.ts`,
  already used to carry selection across an external-edit reparse of the
  *current* file) to walk the picker-time node's child-index path and
  replay it against the fresh model — no new reconciliation primitive
  needed. Returns `null` (no-op, not a crash) if the file changed shape
  enough that the path no longer resolves.
  **Write-back gate:** `forcePersistentId` (`sync/metadata.ts`) doesn't
  itself report whether it minted a new id — it's a no-op returning the
  existing id when already non-synthetic. Gated by checking
  `isSyntheticId(targetNode.id)` *before* calling it: only writes
  (`vault.modify`) when it was synthetic beforehand, confirmed by test
  (relating to an already-referenced node, or the same node twice, writes
  zero times).
  **Discovered gap, fixed narrowly for this write, not fully solved (see
  DECISIONS.md for the full writeup):** the first version of this commit
  minted an id but then silently failed to persist it —
  `serializeMindMap`/`serializeNode` only emit a node's ` ^blockid` suffix
  when `nodeHasPersistableMeta` is true, and that flag's `isRelationTarget`
  case is normally set by `resolveRelations` scanning a file's *own*
  links; a cross-doc target's referencing link lives in the *other*
  file's text, so nothing in the foreign file's own resolve pass ever
  marks it. Confirmed this is pre-existing, reproducible with zero R4 code
  (a hand-written `^existing` suffix with no fold/pos/width and no
  same-file relation pointing at it is silently dropped on the very next
  `serializeMindMap`, unrelated to this feature). Fixed *this* write by
  setting `targetNode.isRelationTarget = true` right before the one
  `serializeMindMap` call it does. **Not fixed:** a later, independent
  resave of that same foreign file (opened as its own mind map some other
  time, edited for an unrelated reason) reparses from scratch with no way
  to know the id is still referenced from elsewhere, and could drop the
  suffix then. A full fix needs a persisted "externally referenced"
  marker in the target file's own frontmatter, or a vault-wide reverse
  index — out of scope for this milestone; flagging for a decision rather
  than building it unilaterally.
  **Concurrent-open-pane edge case:** cheaply detectable, so handled
  rather than left as a silent limitation —
  `MindMapView.isFileOpenElsewhere(path)` scans open leaves via
  `app.workspace.iterateAllLeaves` and shows a `Notice` warning before
  proceeding with the write if the foreign file is open elsewhere (still
  proceeds — no conflict-resolution logic built, per the plan's explicit
  scope note).
  **Tests:** 8 new (371 total, up from 363) in
  `test/foreignRelation.test.ts`, all against the pure
  `sync/foreignRelation.ts` functions with a mock `{ cachedRead, modify }`
  vault double (`LinkModal` still isn't unit-instantiable — `extends
  Modal` from the types-only `obsidian` package, same as every prior
  milestone this round). Covers: current-doc resolves with no vault call;
  foreign-doc parses + orders nodes correctly; repeated selection of the
  same foreign doc doesn't re-read/re-parse; unresolvable doc id returns
  empty; mint + write-once + the resulting link classifies as cross-doc
  via the existing `classifyLink`; no write when the node already has a
  persistent id (including a second relate-again call); `null` return (no
  write) when the picked node's structural path no longer resolves in a
  changed file. 371 tests pass; `npm run build` typechecks clean.
  `DECISIONS.md` updated with one new entry (full writeup of the
  persistence gap above). Rebuilt into dev-vault (`npm run dev`, left
  running in the background per the established pattern). **Not
  committed** (user reviews/commits). No new performance-vs-anything
  trade-off surfaced (CLAUDE.md rule 3) — this is modal/session-local
  work plus a single gated vault read+write per Add-click, same
  performance profile the plan's own R4 section anticipated. The
  persistence-durability gap above is a correctness/architecture question,
  not a performance one, but is flagged the same way rather than resolved
  unilaterally.
  **Manual verification checklist (for a human in Obsidian — cannot be
  driven headlessly):**
  1. Open a mind map with at least one node, `Ctrl/Cmd+Shift+L`, keep
     "Document relation" selected — confirm the "Document" combobox shows
     the current file pre-selected/typed in, above the existing "Node"
     combobox.
  2. Type part of the name of a **different** `.md` file in the vault (one
     not currently open in any pane) into the Document combobox and select
     it — confirm the Node combobox repopulates with that file's actual
     node text (not the current document's nodes), with no perceptible
     delay.
  3. Pick a node from that list, optionally set a display-text override,
     click "Add relation" — confirm: the item list shows a new row tagged
     "Cross-doc", the node's on-canvas text shows the link, and the
     cross-doc badge (R2) appears on the node with click-through opening
     the correct file (and section, once Obsidian resolves the block ref).
  4. Open the foreign file directly (outside the mind map) and confirm the
     target line now ends in ` ^<id>` — the block id actually persisted.
  5. Relate to the **same** foreign node again (from the same or a new
     `Ctrl/Cmd+Shift+L` session) — confirm no second edit occurred: check
     the foreign file's modified time doesn't change again, or check
     Obsidian's file-recovery history has no new entry for it after the
     first relate.
  6. With the foreign file now open in a second pane (split or new tab),
     relate to one of its other nodes from the mind map view — confirm a
     `Notice` warns that the file is open elsewhere before the write
     proceeds.
  7. Repeat the M-R3/R5 checklist's undo check (`Ctrl/Cmd+Z`) for a
     cross-doc add — confirm it reverts the **current** node's text (the
     foreign file's own write is a separate, non-undo-tracked vault
     operation, same as any other external file edit).

- **2026-07-18** — Fix (closes the M-R4 cross-doc durability gap): the user
  was asked "fix it now vs. ship as-is" for the known limitation logged
  above and chose fix it now. Added a new `MindNode.externalRelationTarget`
  field (`src/model/types.ts`) — deliberately separate from
  `isRelationTarget`, since `resolveRelations`'s `clearFlags` pass
  unconditionally resets `isRelationTarget` to `false` at the start of
  every walk, which would stomp a value loaded from frontmatter before
  anything else ran. Wired it through the existing `NodeMeta`
  fold/pos/width persistence mechanism (`src/sync/metadata.ts`): a new
  `NodeMeta.externalRef` field, an `EXTERNAL_REF_RE` regex in
  `extractMindmapData`, a set in `applyMindmapDataToTree`, an emitted
  `externalRef: true` part in `applyMindmapData`, and an OR'd-in check in
  `nodeHasPersistableMeta`. `collectMeta` (`src/sync/serializer.ts`) emits
  `externalRef` the same way it emits the other three fields.
  `commitForeignRelationTarget` (`src/sync/foreignRelation.ts`) now sets
  `targetNode.externalRelationTarget = true` instead of
  `targetNode.isRelationTarget = true` before its serialize call —
  `isRelationTarget` was dropped from this call entirely since nothing else
  in that function's serialize pass depends on it. Doc comments updated in
  all four touched files; DECISIONS.md has the full writeup (new
  2026-07-18 entry, plus a one-line pointer added to the top of the
  original M-R4 entry noting the gap is now closed without rewriting that
  entry's history).
  **Tests:** 5 new (376 total, up from 371). `test/metadata.test.ts`:
  `extractMindmapData`/`applyMindmapDataToTree` parse/apply `externalRef`;
  `nodeHasPersistableMeta` is true purely from `externalRelationTarget`
  with fold/pos/width all absent; a dedicated round-trip test simulates the
  actual bug scenario — parse, mark external, serialize, then parse the
  serialized output **again as an independent fresh session** (no shared
  state with the first parse) and confirms the block id and
  `externalRelationTarget` are both restored, with `isRelationTarget`
  correctly absent (nothing in the file's own content would set it).
  `test/foreignRelation.test.ts`'s existing mint-and-write test is extended
  to re-parse the written-back text a second and third time (simulating the
  foreign file being reopened/resaved independently later) and assert the
  `^blockid` suffix survives — this is the actual regression the original
  test didn't catch, since it only asserted on the first write.
  376 tests pass; `npm run build` typechecks clean. Not committed (user
  reviews/commits). No new performance-vs-anything trade-off (CLAUDE.md
  rule 3) — reuses the exact same per-node frontmatter mechanism already in
  place for fold/pos/width; no new per-file or vault-wide scan added.
  **Punted per explicit scope (not built):** no vault-wide reverse index of
  "which files reference which other files' block ids" (the frontmatter
  flag is self-contained per-file and doesn't need one); no automatic
  cleanup of a stale `externalRef: true` flag if the referencing relation
  is later removed from the source node elsewhere (harmless staleness —
  flagged in DECISIONS.md as a possible cheap follow-up, not attempted
  here).
  **Manual verification (for a human in Obsidian, extending item 4 of the
  M-R4 checklist above):** after confirming the foreign file's target line
  ends in ` ^<id>`, open that foreign file **directly** as its own mind map
  view, edit something unrelated in it (rename a different node, toggle a
  fold), let the 400 ms write-back debounce fire, then go back to the
  original relation and confirm the badge is still present and still
  clickable — before this fix that second independent save could silently
  drop the ` ^<id>` suffix and break the relation.

## Coordinator handoff notes (for the Sonnet subagent, when launched)
- Read the plan and CLAUDE.md first; the performance rules are mandatory.
- **Round 2 order: F3 → M-R3/R5 → M-R4** (Round 1's F1/F2/R1/R2 are done).
- Ground every change in the files cited in the plan's "Current-code
  grounding" **and** "Round 2 — current-code grounding" sections — both are
  load-bearing; the Round 2 one documents exactly what already works
  (parser/model/renderer already tolerate multiple relations; only the
  authoring UI doesn't) so don't re-derive it from scratch or redesign parts
  that don't need it.
- D6/D7/D8 are resolved — build to those resolutions (D7 in particular:
  **visible** append, `"existing text → target label"`, not an invisible
  empty-alias append) rather than the plan's stated recommendation where
  the two differ.
- Stop and return any **new** performance-vs-anything trade-off as a
  question; do not decide it. Do not add dependencies without a
  bundle/runtime cost statement.
- Do not `git commit` — leave changes in the working tree for user review.
- Report back (to this coordinator session) after each milestone with: what
  changed, test count/pass status, and anything that surfaced a design
  question not already covered by the plan — before moving to the next
  milestone, so this tracker stays current and the user can review
  incrementally rather than all at once at the end.

- **2026-07-18** — User pushed back on D7's actual result: a screenshot of
  the appended relation/link text as it renders in an ordinary Obsidian
  note view (not the mind-map canvas) shows one run-on, half-underlined
  line mixing the node's own words with everything it's related to. Asked
  for `Associations:`/`Links:` as separate, non-editable lines under the
  node instead. Two decisions put to the user and resolved: D9 (separate
  markdown lines under the node, not appended to the node's own line — this
  is what actually fixes the screenshot) and D10 (markdown + modal only;
  canvas rendering stays arrows/badges as today, no new per-node
  layout/render cost — the perf-sensitive question, resolved per CLAUDE.md
  rule 3 rather than decided unilaterally). Coordinator traced the exact
  implementation seams before writing the Round 3 plan section: the
  parser's existing `pendingContent`/`flushPendingContent` mechanism
  (`sync/parser.ts`) is the natural hook for recognizing the two new line
  formats without touching the main parse loop; `goToSection.ts`'s
  `findNodeLine` line-counting will silently drift by 1-2 lines per node
  with these fields set unless updated in lockstep with the serializer's
  new emission order — flagged explicitly so it isn't missed. Most of
  Round 2's M-R3/R5/M-R4 work (modal UI, radio, document/node comboboxes,
  foreign-file write-back, the durability fix) carries forward unchanged;
  only the append target moves from `node.text` to two new
  `relationsRaw`/`linksRaw` fields. M-R6 added to the milestone table;
  Sonnet 5 subagent to be launched on it next.

- **2026-07-18** — M-R6 implemented by the subagent (reviewed diff: this
  entry). Added `MindNode.relationsRaw`/`linksRaw` (`src/model/types.ts`),
  parsed out of `sync/parser.ts`'s existing `pendingContent`/
  `flushPendingContent` mechanism via two regexes
  (`^\s*Associations:\s*(.*)$` / `^\s*Links:\s*(.*)$`), peeled out of the
  batch before whatever remains falls through to `attachedContent`
  unchanged — no change to the main parse loop's heading/list branches.
  `sync/serializer.ts`'s `serializeNode` (and `serializeMindMap`'s root
  special case) emit `Associations:`/`Links:` lines right after a node's
  own line and before `attachedContent`/children, at 2 spaces deeper than
  that node's own indent. `sync/goToSection.ts`'s `findNodeLine` **was
  updated**, as the plan flagged as easy to miss — both the root special
  case and the per-node walk now add `(relationsRaw?1:0) +
  (linksRaw?1:0)` to their line-count accumulator in the same order the
  serializer emits them; confirmed this was load-bearing (not
  hypothetical) by checking a test with the fix reverted actually failed
  first.
  `model/relations.ts`: `getCachedLinks` renamed to
  `getCachedRelationLinks` and re-sourced from `relationsRaw` instead of
  `text`; `resolveRelations`'s arrow (R1)/cross-doc-badge (R2) output now
  comes **only** from `relationsRaw` — `linksRaw` is never scanned by it.
  `listNodeLinkItems` now walks both fields via a shared `buildLinkItems`
  helper and tags each row with a new `LinkItem.list: "relations" |
  "links"` discriminant, since `occurrenceIndex` is now scoped within
  whichever field produced it rather than one flat index across a single
  shared string — a removal must identify `{list, occurrenceIndex}`.
  `model/links.ts`'s `appendLinkText`/`removeLinkOccurrence` kept their
  exact mechanics but switched separator from D7's `" → "` to `" : "`,
  staying field-agnostic (still just `(text, linkText)` → new string) so
  callers pass in `relationsRaw` or `linksRaw` as appropriate.
  `model/mutations.ts`'s `cloneSubtree` now copies both new fields, same
  treatment as `attachedContent` (accepted quirk: a pasted relation
  target's block id can be duplicated, same as any other duplicated block
  id elsewhere in this codebase already behaves).
  **Controller wiring:** added `Controller.commitRelationsRaw`/
  `commitLinksRaw` (backed by new `mutations.ts` functions
  `setRelationsRaw`/`setLinksRaw`), parallel to `commitRename` — same
  undo/redo-via-inverse-closure plumbing, normalizing a fully-emptied
  value to `undefined` so removing the last item doesn't leave a stray
  empty `Associations:`/`Links:` line. `view/MindMapView.ts`'s
  `openLinkEditor` and `view/LinkModal.ts` were adapted, not rewritten:
  `onAddRelation`/relation removals now commit through
  `commitRelationsRaw` against `node.relationsRaw`; `onAddLink`/link
  removals commit through `commitLinksRaw` against `node.linksRaw`;
  `onRemoveItem`'s signature widened to `(list, occurrenceIndex)`. The
  node's own `text` field is no longer touched by any of this — it stays
  whatever plain label the user typed (a hand-typed `[[wikilink]]` in a
  node's own label still works via `SvgRenderer`'s existing link-click
  handling, untouched, unrelated to this feature).
  `sync/foreignRelation.ts` (R4 foreign-file write-back) and the
  `externalRelationTarget` durability fix were **not touched** — confirmed
  by inspection they operate on the *target* node in the *foreign* file,
  independent of which field the *source* node's reference lives in; the
  one existing test referencing the old embed-in-text fixture
  (`test/foreignRelation.test.ts`) was updated to use an `Associations:`
  line instead, with no change to the module under test.
  **Tests:** 395 total, up from 376. `test/parser.test.ts` (+7:
  Associations:/Links: recognition in either order, one/neither present,
  and the documented known-ambiguity case where arbitrary prose starting
  with "Associations:" still gets misidentified — not solved, per the
  plan). `test/serializer.test.ts` (+4: byte-exact round-trip including a
  deeper list node and the root's own lines). `test/goToSection.test.ts`
  (+3: correct line counts with one/both fields present, including on the
  root). `test/relations.test.ts` fully rewritten to source relations from
  real `Associations:`/`Links:` line fixtures (parsed, not hand-set on
  `node.text`) rather than the old embed-in-heading-text style, plus 2 net
  new cases (linksRaw-only produces zero arrows/badges; removing a
  linksRaw item never touches relationsRaw's items). `test/links.test.ts`
  updated for the `" : "` separator. `test/relationsRenderer.test.ts`
  updated to author relations via `Associations:` lines (the canvas
  arrow/badge tests were otherwise unaffected in intent). `test/
  controller.test.ts` (+4: `commitRelationsRaw`/`commitLinksRaw`
  undo/redo + field-isolation, plus a `cloneSubtree` copy check).
  `npm run build` typechecks clean. `DECISIONS.md` updated with one new
  entry (dated 2026-07-18, matching the round's other entries). Rebuilt
  into dev-vault (`npm run dev`, left running in the background). **Not
  committed** (user reviews/commits). No new performance-vs-anything
  trade-off surfaced — both perf-adjacent questions for this milestone
  (data location, canvas rendering) were already resolved via D9/D10
  before implementation started; nothing new to ask per CLAUDE.md rule 3.
  **Manual verification checklist (for a human in Obsidian — cannot be
  driven headlessly):**
  1. Select a node, `Ctrl/Cmd+Shift+L`, add a same-doc "Document relation"
     and, separately, an external "Link" (e.g. a URL) — confirm the modal
     behaves exactly as the M-R3/R5 checklist described (item list grows,
     stays open, etc).
  2. Open the file as a **plain Obsidian note** (not through the mind map
     view, e.g. via "Open as markdown" or a split pane in source mode) —
     confirm the node's own line reads as a clean, plain label with no
     link syntax on it, and that two separate lines appear directly
     beneath it: `Associations: ...` and `Links: ...`, each rendering as
     its own line (not mixed into the node's sentence).
  3. Add a **second** relation and a second link to the same node —
     confirm both new lines now show two colon-separated (`" : "`) items
     each, still on their own two lines (not four lines, not merged back
     into the node's own line).
  4. Remove one of the two relations via the modal — confirm only that
     Associations: line's affected item disappears (the line itself
     persists with the other item, not deleted entirely unless it was the
     last item on that line) and the Links: line is untouched.
  5. Select a node that comes *after* one with both fields set, right-click
     → "Go to note section" (or the equivalent command) — confirm it lands
     on that later node's actual line, not one shifted by the earlier
     node's extra Associations:/Links: lines.
  6. Confirm the canvas itself is unchanged by this milestone: the same-doc
     arrow and cross-doc badge still appear/behave exactly as before (per
     D10, nothing new renders on the node box for these fields).

- **2026-07-18** — User tried M-R6 in practice and asked to roll it back:
  "the approach in the attached image with arrows was better" — referring
  to the original D7 screenshot (visible append into the node's own text,
  `"existing → target label"`), not the separate `Associations:`/`Links:`
  lines M-R6 introduced. **M-R6 fully reverted** by the coordinator
  directly (no subagent — this was precise, mechanical, and the coordinator
  had just reviewed every affected file in detail during M-R6's own review
  pass, so re-deriving the target state from scratch wasn't needed).
  Reverted: `model/types.ts` (dropped `relationsRaw`/`linksRaw`),
  `sync/parser.ts` (dropped the `Associations:`/`Links:` line recognition
  in `flushPendingContent`, back to plain `attachedContent` capture),
  `sync/serializer.ts` (dropped the two-line emission, back to the
  original indent/suffix logic), `sync/goToSection.ts` (`findNodeLine`'s
  line-count back to just `attachedContent.length`), `model/mutations.ts`
  (`cloneSubtree` no longer copies the two dropped fields; also dropped the
  now-unused `setRelationsRaw`/`setLinksRaw`), `controller/Controller.ts`
  (dropped `commitRelationsRaw`/`commitLinksRaw`, back to `commitRename`
  only), `model/links.ts` (`appendLinkText`/`removeLinkOccurrence`
  separator back to `" → "`), `model/relations.ts` (`listNodeLinkItems`/
  `resolveRelations` back to scanning `node.text` via a single
  `getCachedLinks`, `LinkItem` back to a flat `occurrenceIndex`, no more
  `list` discriminant), `view/LinkModal.ts`/`view/MindMapView.ts`
  (`onAddRelation`/`onAddLink`/`onRemoveItem` back to committing into
  `node.text` via `commitRename`, keeping M-R4's foreign-file picker and
  write-back logic entirely intact — that plumbing was unaffected by M-R6
  and stays). Test files (`parser.test.ts`, `serializer.test.ts`,
  `goToSection.test.ts`, `controller.test.ts`) had only-M-R6 additions
  removed outright; `relations.test.ts`/`relationsRenderer.test.ts` (which
  Round 2 had *also* extended, not just M-R6) needed their M-R6-modified
  fixtures manually rewritten back to text-embedded links rather than a
  blind diff-reversal, since a naive `git diff`/reverse-apply against the
  single last commit would have wiped out Round 2's own legitimate
  additions along with M-R6's (caught this via an unexpected test-count
  drop to 370 instead of the expected 376, mid-rollback — fixed by
  restoring the pre-rollback state for just those two files from a backup
  patch and redoing them by hand). 376 tests pass (back to the exact
  pre-M-R6 baseline), build typechecks clean, no stray `relationsRaw`/
  `linksRaw`/"M-R6" references left in source, tests, or docs (grepped to
  confirm) other than this historical log entry and the plan's Round 3
  section (left as a record of what was tried and why it didn't stick,
  per the append-only discipline for `DECISIONS.md`/this tracker's log —
  not deleted). **Not committed** — the working tree is back to the M-R4 +
  durability-fix state (F3, M-R3/R5, M-R4, durability fix all still
  present and untouched by this rollback) plus the standalone
  `Ctrl/Cmd+Shift+G` shortcut added earlier, ready for review/commit.
