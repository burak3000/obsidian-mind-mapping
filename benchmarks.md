# Benchmark Log

Numbers measured against the budgets in `CLAUDE.md` / addendum §3. One
section per milestone. Regression > 20% vs. previous milestone must be
flagged and discussed before merging (addendum §6).

## M0 — Scaffold & harness

No renderer/parser yet — nothing to benchmark for interaction budgets.

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M0 empty scaffold) | < 500 KB | 1.8 KB |

Fixture generator produces 100 / 500 / 2,000 / 5,000-node `.md` files in
`fixtures/` (and mirrored into `dev-vault/fixtures/` for manual testing)
for use starting M1.

## M1 — Read-only map from md

`node scripts/bench-m1.mjs` measures parser + flextree layout time against
the "open a map" budgets (headless — see caveat below).

| Fixture | Parse | Layout | Total | Budget | Status |
|---|---|---|---|---|---|
| 100 nodes | 0.4 ms | 1.6 ms | 1.9 ms | 300 ms | OK |
| 500 nodes | 0.9 ms | 3.0 ms | 3.9 ms | 300 ms | OK |
| 2,000 nodes | 1.5 ms | 10.3 ms | 11.8 ms | 1,000 ms | OK |
| 5,000 nodes (stress) | 2.1 ms | 19.8 ms | 21.9 ms | 2,000 ms | OK, no freeze |

Parser and layout are both effectively O(n) as expected — 5,000 nodes is
~2.5x the work of 2,000 for parse and ~2x for layout, no superlinear
blowup.

**Caveat:** this benchmark runs headless in plain Node (no DOM), so it
covers parse+layout only, not the SVG element creation / paint cost the
renderer adds on top. That portion needs the real Chrome DevTools
Performance panel inside Obsidian (addendum §6) — I have not done that
manual pass; treat the "open a map" budget as unverified end-to-end until
someone checks it in the dev vault. Given parse+layout leaves ~98% of the
2k/5k budgets unused, there's headroom, but SVG paint cost for 5,000+15,000
DOM nodes (rects+text+edges) is a real unknown until measured.

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M1: +parser+layout+renderer+d3-flextree) | < 500 KB | 14.4 KB |

## M2 — Core editing + sync

`node scripts/bench-m2.mjs` simulates Tab (add child), rename-commit,
delete, and serialize against the "new node visible & editable" budget
(target 50ms, ceiling 100ms), using jsdom for the renderer's DOM calls.

| Fixture | Tab (add+relayout+render) | Rename commit | Delete | Serialize |
|---|---|---|---|---|
| 100 nodes | 1.5 ms | 1.4 ms | 1.1 ms | 0.1 ms |
| 500 nodes | 4.5 ms | 3.3 ms | 3.6 ms | 0.1 ms |
| 2,000 nodes | 13.7 ms | 10.0 ms | 20.0 ms | 0.2 ms |
| 5,000 nodes (stress) | 33.7 ms | 26.7 ms | 34.4 ms | 0.6 ms |

All within the 50ms target even at 5,000 nodes, well inside the 100ms
ceiling. Note this still uses full-tree flextree relayout per mutation
(justified by M1's layout-only numbers); the renderer itself is now
dirty-tracked (create/update/remove only, no teardown+rebuild — see
`SvgRenderer.update()`), which is what keeps these numbers well under
budget despite the full relayout.

**Same caveat as M1:** jsdom measures DOM-API call cost, not real paint —
Chrome DevTools Performance panel inside Obsidian (addendum §6) is still
the authoritative check, not yet done manually.

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M2: +controller+mutations+undo+serializer+inline editor) | < 500 KB | 27.5 KB |

## M3 — XMind visuals (organic branches, color, taper, balanced L/R)

Initial implementation regressed Tab latency at 5,000 nodes by 62% (33.7ms
-> 54.6ms) because balanced L/R layout recomputed the optimal split from
scratch every edit, touching 4,999/5,000 nodes per Tab. Flagged to the
user per addendum §6 (regression > 20% must be discussed before
proceeding); user chose sticky sides over always-recomputing global
balance (see DECISIONS.md). Also fixed an unrelated dirty-tracking miss in
`SvgRenderer.upsertEdge` found during the investigation (edges were
written unconditionally every update).

Re-measured after both fixes:

| Fixture | Tab | Rename commit | Delete | Serialize |
|---|---|---|---|---|
| 100 nodes | 1.8 ms | 1.4 ms | 1.1 ms | 0.1 ms |
| 500 nodes | 4.6 ms | 3.4 ms | 3.2 ms | 0.2 ms |
| 2,000 nodes | 12.3 ms | 10.2 ms | 19.2 ms | 0.2 ms |
| 5,000 nodes (stress) | 36.2 ms | 26.7 ms | 35.8 ms | 0.6 ms |

Back within the 50ms target at every fixture size, matching the M2
baseline. Locality check: a single Tab on the 5,000-node fixture now moves
exactly 1 node's position (previously 4,999) — dirty-tracking is doing its
job again.

Parse+layout (headless, same caveat as M1 — no real paint):

| Fixture | Parse | Layout | Total | Budget | Status |
|---|---|---|---|---|---|
| 100 nodes | 0.4 ms | 1.6 ms | 2.1 ms | 300 ms | OK |
| 500 nodes | 0.8 ms | 3.1 ms | 4.0 ms | 300 ms | OK |
| 2,000 nodes | 1.9 ms | 9.8 ms | 11.7 ms | 1,000 ms | OK |
| 5,000 nodes (stress) | 2.0 ms | 20.1 ms | 22.1 ms | 2,000 ms | OK |

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M3: +colors+sides+bezier edges) | < 500 KB | 29.6 KB |

## M4 — Folding & balance polish

`npm run bench:m2` now also measures fold/unfold (collapsing/expanding the
heaviest first-level branch — closer to a worst case than a typical fold,
since it removes/restores a large fraction of the tree at once).

| Fixture | Tab | Rename | Delete | Fold | Unfold | Serialize |
|---|---|---|---|---|---|---|
| 100 nodes | 2.4 ms | 4.0 ms | 1.4 ms | 1.6 ms | 3.9 ms | 0.3 ms |
| 500 nodes | 6.7 ms | 3.4 ms | 3.1 ms | 7.8 ms | 7.4 ms | 0.2 ms |
| 2,000 nodes | 12.3 ms | 10.6 ms | 12.0 ms | 40.7 ms | 29.2 ms | 0.3 ms |
| 5,000 nodes (stress) | 39.2 ms | 33.0 ms | 28.6 ms | 58.6 ms | 71.6 ms | 0.7 ms |

At every **budgeted** tier (100/500/2,000 — addendum §3), fold/unfold stays
within the 50ms target. At 5,000 (explicitly the stress tier, "not a
budgeted target — degradation must be graceful, never a freeze") unfold
reaches 71.6ms: over the 50ms target but comfortably under the 100ms hard
ceiling, and not a freeze. Not flagged as a violation — 5,000 nodes isn't
held to the target, only to "no freeze," which this meets. If a smaller,
more typical fold (a deep leaf branch, not the heaviest root-level one)
were measured instead, this would likely already be well under target;
worth re-checking with a more representative fold target if this comes up
again.

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M4: +fold badges+metadata codec+animation) | < 500 KB | 32.4 KB |

## M5 — Links & custom positioning

Investigated and fixed a layout-time regression found while benchmarking
this milestone (see DECISIONS.md for root cause: link-aware width
estimation + manual-position filtering both added avoidable per-call
allocation/regex cost). Final numbers, no manual positions in the fixture
(the common case):

| Fixture | Parse | Layout | Total | Budget | Status |
|---|---|---|---|---|---|
| 100 nodes | 0.6 ms | 2.0 ms | 2.5 ms | 300 ms | OK |
| 500 nodes | 0.9 ms | 3.6 ms | 4.6 ms | 300 ms | OK |
| 2,000 nodes | 1.7 ms | 11.8 ms | 13.5 ms | 1,000 ms | OK |
| 5,000 nodes (stress) | 2.4 ms | 26.3 ms | 28.8 ms | 2,000 ms | OK |

| Fixture | Tab | Rename | Delete | Fold | Unfold | Serialize |
|---|---|---|---|---|---|---|
| 100 nodes | 2.1 ms | 1.8 ms | 1.3 ms | 1.3 ms | 3.6 ms | 0.3 ms |
| 500 nodes | 4.7 ms | 4.3 ms | 4.4 ms | 9.7 ms | 10.2 ms | 0.3 ms |
| 2,000 nodes | 19.3 ms | 12.3 ms | 13.7 ms | 38.1 ms | 34.0 ms | 0.3 ms |
| 5,000 nodes (stress) | 33.4 ms | 34.0 ms | 32.1 ms | 64.8 ms | 80.1 ms | 0.7 ms |

Same pattern as M4: all budgeted tiers (100/500/2,000) within target;
5,000-node fold/unfold (stress tier, not a budgeted target) stays under
the 100ms hard ceiling. No new regression beyond what M4 already logged.

| Metric | Target | Measured |
|---|---|---|
| Plugin bundle size (`dist/main.js`, production, M5: +links+drag/manual-position+rebalance) | < 500 KB | 40.3 KB |

## M6 — Hardening: viewport culling

Resolves the open caveat logged in M1 ("SVG paint cost for 5,000+15,000
DOM nodes is a real unknown until measured") — above 300 visible nodes,
`SvgRenderer` now culls to the current pan/zoom viewport (+400px margin),
re-running on pan/zoom (rAF-batched, same tick as the transform write).

| Fixture | `.mm-node` elements actually in the DOM | Total DOM elements | Mount time |
|---|---|---|---|
| 500 nodes | 94 (of 500) | 387 | 8.8 ms |
| 2,000 nodes | 26 (of 2,000) | 109 | 2.1 ms |
| 5,000 nodes (stress) | 40 (of 5,000) | 165 | 5.2 ms |

At every tested size, actual DOM footprint stays in the low hundreds of
elements regardless of total tree size — memory/paint cost is now
proportional to *viewport* size, not tree size, which is what the
addendum's culling requirement was asking for. This makes the previously
"unknown" real-browser paint cost a much smaller concern: even at 5,000
nodes, the browser is only ever asked to lay out/paint ~40 node boxes'
worth of SVG at once. Still not verified in a *real* browser (jsdom
doesn't paint) — Chrome DevTools inside Obsidian remains the authoritative
check per addendum §6, not yet done manually.

**Bonus effect discovered post-culling:** re-running the M4/M5 fold/unfold
benchmark after adding culling shows fold/unfold at 5,000 nodes dropping
from ~65–80ms to **15–24ms** — culling doesn't just cap steady-state DOM
size, it also caps the *render* cost of a large layout change, since
`update()` only has to touch whatever's inside the current viewport
regardless of how many nodes the underlying layout actually repositioned.
Tab/rename/delete at 5,000 nodes also dropped, to 22–25ms (from 32–44ms).
This pushes every operation at every fixture size, including the stress
tier, back under the 50ms *target* (not just the 100ms ceiling) — logged
here as a final confirmation, not a fix (nothing was broken).

## Post-M6 second bug-fix pass — text wrapping, drag-resize, unboxed sub-topics

Added link-aware word wrapping (`src/model/textWrap.ts`) plus variable
per-node height in the layout engine, and a per-node `manualWidth` drag
override — both consumed by `nodeSize` inside the flextree layout pass, so
this is the same "called multiple times per node" hot path flagged for
width estimation back in M5. Added a `WeakMap` cache (`nodeBoxFor`) keyed
by node identity to absorb the extra wrapping cost. Re-ran
`npm run bench:m2`:

| Fixture | Tab | Rename commit | Delete | Fold | Unfold |
|---|---|---|---|---|---|
| 100 nodes | 3.0–3.3 ms | 2.5–2.7 ms | 2.0–2.3 ms | 1.9–2.2 ms | 3.7–4.0 ms |
| 500 nodes | 3.1–3.4 ms | 3.4–4.3 ms | 3.1 ms | 2.8–3.2 ms | 3.5–3.6 ms |
| 2,000 nodes | 8.6–10.6 ms | 9.0–11.2 ms | 9.9–13.7 ms | 6.9–7.9 ms | 8.8–9.8 ms |
| 5,000 nodes (stress) | 23.3–27.1 ms | 20.5–26.1 ms | 19.3–20.6 ms | 14.6–16.9 ms | 21.3–22.7 ms |

Indistinguishable from the pre-wrapping M6/taper baseline (22–25ms at
5,000 nodes) — the per-node box cache is doing its job; wrapping cost is
paid once per node per actual text/width change, not once per `nodeSize`
call. Bundle size: 48 KB (`dist/main.js`, production), still well under
the 500 KB budget. No regression, no further flag needed.

## Post-M6 bug-fix pass — continuous per-edge taper (R10, high-fidelity)

User asked for the higher-fidelity taper option (single connector narrows
continuously along its own length, not just level-to-level — see
DECISIONS.md). Edge rendering switched from a constant-width stroked path
to a filled variable-width ribbon (16-sample centerline offset per edge).
Re-ran `npm run bench:m2` after the change:

| Fixture | Tab | Rename commit | Delete | Fold | Unfold |
|---|---|---|---|---|---|
| 100 nodes | 2.6–2.9 ms | 2.1 ms | 1.7–1.8 ms | 1.6–2.0 ms | 4.2–4.3 ms |
| 500 nodes | 4.9 ms | 3.0–3.3 ms | 3.0–3.5 ms | 3.1–3.3 ms | 3.5–3.6 ms |
| 2,000 nodes | 8.9–9.3 ms | 8.9 ms | 8.9–9.4 ms | 7.7–7.9 ms | 9.5–10.0 ms |
| 5,000 nodes (stress) | 22.3–23.3 ms | 24.2–24.8 ms | 22.5–23.3 ms | 15.5–15.7 ms | 23.1–23.7 ms |

Indistinguishable from the M6 post-culling baseline directly above (also
22–25ms at 5,000 nodes) — the extra per-edge sampling (16 fixed point/
tangent evaluations per edge, O(1) each) doesn't show up against the
existing dirty-tracked update cost. Bundle size: 44 KB (`dist/main.js`,
production), still well under the 500 KB budget. No regression, no further
flag needed.

## Final stress-test summary (5,000-node fixture, all milestones)

The addendum's stress-test requirement is "graceful degradation, never a
freeze" (5,000 nodes is explicitly not held to the same hard targets as
100/500/2,000). Across every milestone's headless/jsdom benchmarks:

| Operation | Worst measured (post-culling) | Hard ceiling | Freeze? |
|---|---|---|---|
| Open map (parse+layout) | 28.6 ms | 2,000 ms | No |
| Tab / rename / delete | 22–25 ms | 100 ms | No |
| Fold / unfold (heaviest branch — worse than typical) | 15–24 ms | 100 ms | No |
| Serialize (write-back) | <1 ms | — | No |
| DOM footprint (post-culling, M6+) | ~40 nodes / ~165 elements | — | No |

No operation ever approached a freeze at any point across six milestones.
The one real regression found (M3's balanced-layout recompute) was caught
by this same benchmark discipline before it shipped, discussed with the
user, and fixed — see DECISIONS.md.

**What remains unverified:** every number above is headless (Node) or
jsdom — neither paints pixels or reflects real Chromium layout/GC
behavior. Obsidian is an Electron desktop app with no browser dev-server
this environment can drive (per CLAUDE.md); the authoritative check is
Chrome DevTools' Performance and Memory panels inside a real Obsidian
window on the 5,000-node fixture (`dev-vault/fixtures/5000-nodes.md`),
watching for long tasks (addendum §6: >50ms) and confirming the memory
budget (<300MB hard ceiling for a 2,000-node map) — this has not been
done and needs a human at a real machine.

**Mobile:** not spot-checked at all — there is no mobile device or
Obsidian mobile emulator available in this environment. Per addendum §7.5,
mobile budgets are 2x desktop with the same "no freeze" requirement;
nothing here contradicts that, but nothing confirms it either. See
`SUBMISSION-CHECKLIST.md` for what's needed before treating mobile as
actually supported.

## 2026-07-06 — Anticlockwise document-order branch sides (plan item 03)

`assignMissingSides` changed from per-node weight-greedy to a contiguous
document-order split (recomputed only on explicit Rebalance — see
DECISIONS.md), and `partitionChildren` now reverses the right-side array
for the anticlockwise reading direction. Both changes are still O(first-
level branches) — no new O(N) or O(visible) work — so re-ran `npm run
bench:m2` (Tab/rename/delete/fold/unfold, which already exercises
`assignMissingSides` on every mutation) to confirm no regression:

| Fixture | Tab | Rename | Delete | Fold | Unfold | Serialize |
|---|---|---|---|---|---|---|
| 100 nodes | 4.1–4.3 ms | 2.6–3.1 ms | 2.3–2.6 ms | 2.1–2.6 ms | 5.6–6.2 ms | 0.3 ms |
| 500 nodes | 4.0–4.2 ms | 3.4–3.8 ms | 3.4–3.8 ms | 4.2 ms | 4.6–4.7 ms | 0.2 ms |
| 2,000 nodes | 9.4–9.9 ms | 10.6–11.0 ms | 12.2 ms | 8.4–8.9 ms | 11.4–11.7 ms | 0.4 ms |
| 5,000 nodes (stress) | 27.9–28.5 ms | 26.6 ms | 22.1–22.4 ms | 16.6 ms (one run: 53.0 ms, machine-load jitter — repeat run back to 16.6 ms, no consistent regression) | 24.0–31.3 ms | 0.6–0.8 ms |

Indistinguishable from the pre-change numbers logged above (Tab/rename/
delete 22–25ms, fold/unfold 15–24ms at 5,000 nodes) — the contiguous-split
and array-reverse work doesn't show up against the existing per-mutation
cost. All within budget except the single fold outlier noted above, which
did not reproduce.

## 2026-07-06 — Multiple selection (plan item 05)

The new Controller-level selection logic (`normalizedSelection`'s
`compareDocumentOrder` sort, `bulkDelete`'s compound delete/restore) and
`SvgRenderer.setSelection`'s symmetric-diff restyle are all O(Δselection)/
O(affected subtrees) — they don't touch the relayout (`computeLayout`) or
full-update (`SvgRenderer.update`) hot path that `bench-m2` measures, and
for a single-node selection (the common case, and the only case the
existing bench script's Tab/rename/delete/fold/unfold operations exercise)
they collapse to exactly the same work as before. Re-ran `npm run
bench:m2` anyway as a smoke check on the shared relayout/render pipeline:

| Fixture | Tab | Rename | Delete | Fold | Unfold |
|---|---|---|---|---|---|
| 100 nodes | 4.3 ms | 3.3 ms | 2.7 ms | 2.6 ms | 6.1 ms |
| 500 nodes | 4.3 ms | 4.1 ms | 3.6 ms | 4.1 ms | 5.0 ms |
| 2,000 nodes | 10.3 ms | 10.9 ms | 11.9 ms | 8.5 ms | 11.4 ms |
| 5,000 nodes (stress) | 26.8 ms | 27.6 ms | 22.4 ms | 16.5 ms | 24.2 ms |

Indistinguishable from the baseline above — no regression. No dedicated
multi-selection-specific benchmark was written: selections are expected to
stay small (a handful of nodes at most for a bulk copy/cut/paste), so the
O(depth)-per-comparison document-order sort and O(affected) bulk delete
are negligible next to the relayout that already follows every mutation.

## 2026-07-06 — Image display (plan item 07, decision A: fixed-size thumb, lazy load via culling)

New `scripts/bench-images.mjs` (`npm run bench:images`): a 201-node map
(root + 200 first-level branches, every one carrying an image embed) —
the worst case the perf section calls out ("hundreds of images all
in-viewport at low zoom"). Measures parse+layout, `SvgRenderer.mount`
(which includes creating and resolving every image element, since 201
nodes is below the 300-node culling threshold so nothing is lazy here —
this is intentionally the *unlazy* worst case), and a pan-dispatch
proxy (drag the viewport; jsdom doesn't paint, so this is JS/DOM-API time
only, not a real frame time — same caveat already logged for M2):

```
201 nodes (200 with an image embed): parse+layout=3.5–4.2ms mount=40.9–43.2ms
open=47.9–49.9ms (budget 1000ms) [OK] pan-dispatch=2.9–3.0ms
.mm-node-image elements created: 200
```

Comfortably inside the 2,000-node open budget (1s) despite every single
node needing an image element created and its `href` resolved — this is
the case lazy-loading is specifically meant to *avoid* paying for at
larger scale (above the 300-node culling threshold, only in/near-viewport
nodes get this cost at all, via the existing `applyVisibleSet`/`recull`
mechanism — no new benchmark needed for that path specifically, since
`culling.test.ts` already has a dedicated correctness test confirming the
image resolver is never called for a culled-out node).
**What remains unverified:** decode/paint cost for real image files (this
bench uses a `setImageResolver` stub that never actually fetches
anything) and real frame rate during a pan with images actually loaded —
neither is measurable in jsdom; per CLAUDE.md, the authoritative check is
a real Obsidian window with an image-heavy vault, watching Chrome
DevTools' Performance panel during pan/zoom. Not done in this environment.
