# Progress — Relations feature + copy-color & new-node-centering fixes

Tracker for [PLAN-relations-and-ux-fixes.md](PLAN-relations-and-ux-fixes.md).
Source notes: [dev-vault/Tool notes.md](../dev-vault/Tool%20notes.md).
Implementation is done by a **Sonnet 5 subagent**, milestone by milestone, under
coordinator (this session) guidance. Performance trade-offs and the open
decisions below are the **user's** to make — never the subagent's (CLAUDE.md
rule 3). **Nothing is committed without the user's explicit say-so.**

_Created 2026-07-18. Last updated: 2026-07-18._

## Milestone status

| Milestone | Item | Status | Blocked on |
|---|---|---|---|
| M-F1 | Color invariant fix (pasted/moved branch adopts target color) | **Done** — committed `cc1bf66` | — |
| M-F2 | New node brought into view before editor opens | **Done** — committed `cc1bf66` | — |
| M-R1a | Same-doc relation model + rendering + toggle | **Done** — reviewed, benchmarked, uncommitted (awaiting user test) | — |
| M-R1b | Drag-to-connect authoring gesture (optional) | **Cut for now** | D2 → chose Ctrl/Cmd+K only |
| M-R2 | Cross-document relation indicator | **Done** — reviewed, uncommitted (awaiting user test) | — (D3 default) |

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

## Coordinator handoff notes (for the Sonnet subagent, when launched)
- Read the plan and CLAUDE.md first; the performance rules are mandatory.
- Work the milestones in order F1 → F2 → R1a → (R1b) → R2.
- Ground every change in the files cited in the plan's "Current-code grounding".
- Stop and return any performance-vs-anything trade-off as a question; do not
  decide it. Do not add dependencies without a bundle/runtime cost statement.
- Do not `git commit` — leave changes in the working tree for user review.
