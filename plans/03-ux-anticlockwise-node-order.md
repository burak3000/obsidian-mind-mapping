# 03 — UX: branches placed anticlockwise in MD-file order (balancing preserved)

**Source note:** "nodes must be anticlockwise with the same order in the MD
file — balancing must continue to work"

**Status:** done — decisions resolved: D1 = **A** (recompute only on
explicit Rebalance, plus a new Ctrl/Cmd+B in-view shortcut for it),
D2 = **(c)** (left top→bottom, then right bottom→top).

## Current behavior and why it violates the requirement

Side assignment is weight-greedy and *sticky*
([sides.ts:14](../src/layout/sides.ts)): each first-level branch without a
side is dropped onto whichever side is currently lighter, and never moves
again (persisted via mindmap metadata). Within a side, document order is
preserved ([layoutEngine.ts:114](../src/layout/layoutEngine.ts)), but the
sides themselves interleave arbitrarily — branch 1 may go right, branch 2
left, branch 3 right… so reading around the map has no relationship to the
order of sections in the `.md` file.

The sticky behavior exists for a measured performance reason (DECISIONS.md:
one Tab on a 5,000-node map used to move 4,999 nodes and flip 2 branches).
Any fix must keep edits from reshuffling the whole map.

## Target behavior

First-level branches appear in **document order, arranged anticlockwise**,
while left/right weight stays roughly balanced. With N branches and a split
index K chosen by subtree weight:

- Branches `1..K` on one side, `K+1..N` on the other, each side a
  **contiguous run** of document order (this is the key change — no
  interleaving).
- "Anticlockwise" fixes which side starts and which direction each side
  reads. Starting at the **top-right** and going anticlockwise: right side
  reads **bottom→top**, left side reads **top→bottom**… whereas the familiar
  desktop-mind-mapper arrangement (item 1 top-right, then down) is *clockwise*. See
  **Decision 2** — the exact geometry needs the user's confirmation.

## Implementation sketch

1. **Split computation** (`sides.ts`): replace the greedy per-node assignment
   with a contiguous-prefix split: walk children in document order, find the
   split index K that minimizes `|weight(1..K) − weight(K+1..N)|` (O(N) with
   a prefix-sum — N = first-level branches only, so trivially cheap).
2. **Within-side ordering** (`layoutEngine.ts`): `partitionChildren` keeps
   document order; for the side that must read bottom→top, pass the array
   reversed into `layoutSide` (flextree lays out top→bottom, so reversal is
   free — no engine change).
3. **Stickiness policy** — per Decision 1 below.
4. **Persistence/round-trip**: branch sides are already persisted; a
   recomputed split overwrites them. External-reparse side carry-over
   ([MindMapView.ts:369-374](../src/view/MindMapView.ts)) keys off structural
   position and keeps working.
5. Update DECISIONS.md (this supersedes part of the "sticky sides" entry).

## Tests

- New `sides` tests: contiguous split correctness, weight balance quality,
  ordering (incl. the reversed side), behavior when a branch is added /
  removed / moved.
- Existing [test/sides.test.ts](../test/sides.test.ts) and
  [test/moveAndRebalance.test.ts](../test/moveAndRebalance.test.ts) will need
  updating to the new policy.

## Performance

Split computation is O(first-level branches) — negligible. The cost question
is **when** the split is allowed to change (Decision 1): a split-point change
moves every node on both sides (full relayout, budget: <100 ms compute for
2 k nodes — within budget, but visually a big jump).

---

## ⚠️ Decisions required before implementing (perf rule 3)

**Decision 1 — when may the split point move?** (performance / visual
stability vs. ordering fidelity)

| Option | Ordering fidelity | Perf / stability cost |
|---|---|---|
| **A. Recompute split only on explicit "Rebalance" command; edits keep the current contiguous split, new first-level branches append to the document-order-correct side** *(recommended)* | Order always correct; balance drifts until user rebalances | Zero extra cost on edits; no surprise reshuffles |
| B. Recompute split whenever a first-level branch is added/removed/moved | Order + balance always correct | Occasional whole-map reflow mid-edit (up to full relayout of 2 k+ nodes, visual jump) |
| C. Recompute on every change | Always perfect | Worst: frequent whole-map reflows; re-introduces the measured 5 k-node problem |

**Decision 2 — exact anticlockwise geometry.** Which arrangement matches your
mental model? (`1..N` = document order, K = split)

- **(a)** `1..K` right side top→bottom, `K+1..N` left side **bottom→top**
  (reading order runs clockwise-down the right, then anticlockwise-up the
  left — familiar desktop-mind-mapper start, anticlockwise return)
- **(b)** `1..K` right side **bottom→top**, `K+1..N` left side top→bottom
  (strict anticlockwise starting bottom-right)
- **(c)** `1..K` **left** side top→bottom, `K+1..N` right side bottom→top
  (strict anticlockwise starting top-left)

## Implementation notes

Implemented as planned, with D1/D2 resolved as above:
`assignMissingSides` ([sides.ts](../src/layout/sides.ts)) now has the two
paths described in the sketch (fresh contiguous split when no branch has a
side yet; adjacency-inherit from the nearest already-assigned sibling
otherwise), `partitionChildren` ([layoutEngine.ts](../src/layout/layoutEngine.ts))
reverses the right-side array for the bottom→top reading, and
`MindMapView.onKeyDown` gained a Ctrl/Cmd+B handler calling the existing
`rebalance()` (same local-shortcut pattern as Ctrl+F/Z/Y/K/C/X/V — not also
registered as an Obsidian command hotkey, to avoid double-firing against
the already-existing "Rebalance mind map" command). Tests updated/added in
[test/sides.test.ts](../test/sides.test.ts) (contiguity over weight-greedy,
front-insert inheritance, contiguous-split-from-scratch, Rebalance
recompute) and [test/layout.test.ts](../test/layout.test.ts) (explicit
anticlockwise-direction assertion). `npm run bench:m2` shows no regression
(logged in [benchmarks.md](../benchmarks.md)). Full decision writeup in
[DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test` (211/211)
and `npm run build` both pass. Manual verification in the dev vault still
pending — see workflow step 5: open a multi-branch map, confirm reading
order (left top-down, right bottom-up) matches document order, add a
first-level branch and confirm existing branches don't move, then Ctrl+B
and confirm the whole map rebalances.
