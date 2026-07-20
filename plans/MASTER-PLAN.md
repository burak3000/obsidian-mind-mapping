# Master Plan — Tool notes backlog

Source: [dev-vault/Tool notes.md](../dev-vault/Tool%20notes.md), analyzed 2026-07-06.
Each item has its own subplan file with root-cause analysis / design, steps,
tests, and performance impact. This file is the single tracking document:
work order, dependencies, open decisions, and status all live here.

## Goal

Fix the three reported problems (arrow keys, inline editing, branch
ordering), then ship the five new features (context menu, multi-select, tree
copy, images, Ctrl+M) — without violating the project's performance budgets
(CLAUDE.md) at any step.

## Phases and work order

### Phase 1 — Problems (bugs & UX) ← current phase

| Order | Subplan | Item | Effort | Status | Blocked on |
|---|---|---|---|---|---|
| 1 | [01 — Arrow-key navigation](01-bug-arrow-key-navigation.md) | arrow keys don't always work | S | done | — |
| 2 | [02 — Inline editor fixes](02-ux-inline-editor-fixes.md) | letter-per-line typing; click closes editor | S | done | — |
| 3 | [03 — Anticlockwise node order](03-ux-anticlockwise-node-order.md) | branches in MD order, anticlockwise, balanced | M | done | — |

### Phase 2 — Features

| Order | Subplan | Item | Effort | Status | Blocked on |
|---|---|---|---|---|---|
| 4 | [08 — Ctrl+M toggle](08-feature-ctrl-m-toggle.md) | hotkey toggles markdown ↔ mind map | XS | done | — |
| 5 | [04 — Node context menu](04-feature-node-context-menu.md) | right-click menu, "Go to note section" | M | done | — |
| 6 | [05 — Multiple selection](05-feature-multiple-selection.md) | bulk copy/cut/paste | M | done | — |
| 7 | [06 — Tree copy to OS clipboard](06-feature-tree-copy-os-clipboard.md) | copy subtree as markdown text | S | done | — |
| 8 | [07 — Image display](07-feature-image-display.md) | render image embeds in nodes | L | done | — |

Rationale for the Phase 2 order: 08 is the smallest win; 04 gives the menu
surface that 06 and 07 later hook into; 05 before 06 because both touch the
clipboard (05 turns it into `MindNode[]`, 06 then serializes that array);
07 last — largest and the only one with real performance risk.

### Phase 3 — Later additions (post Phase 1/2)

| Order | Subplan | Item | Effort | Status | Blocked on |
|---|---|---|---|---|---|
| 9 | [09 — Node status badges](09-feature-status-badges.md) | Completed/Started/Blocked/Red Flag/Green Flag/Ready-to-work-on badges | M | done | — |

## Dependency notes

- **05 → 06**: `Controller.clipboard` becomes `MindNode[]` in 05; 06's
  `serializeSubtree` maps over that array. Doing 06 first works but means
  reworking its copy path when 05 lands.
- **04 ← 06/07**: context menu later gains "Copy subtree as markdown" (06)
  and image actions (07). No blocking either way.
- **03** changes side-assignment policy — do it *before* users accumulate
  many maps with weight-greedy persisted sides (the rebalance command
  migrates any map, so this is soft, not hard).
- 01, 02, 08 are fully independent of everything else.

## Open decision queue (perf rule 3 — user must decide)

| # | Decision | Options (details in subplan) | Needed before | Resolved |
|---|---|---|---|---|
| D1 | When may the left/right split point move? | A: only on explicit Rebalance *(recommended)* · B: on first-level add/remove/move · C: every change | 03 | **A**, plus a Ctrl/Cmd+B in-view shortcut for the Rebalance command |
| D2 | Exact anticlockwise geometry | (a) right top→bottom then left bottom→top · (b) right bottom→top first · (c) start top-left | 03 | **(c)** — left top→bottom, then right bottom→top |
| D3 | Image thumbnail policy | A: small fixed thumb + click-to-open *(recommended)* · B: large inline, aspect-ratio height · C: icon marker + hover preview | 07 | **A** — small fixed thumb, click opens in a new tab |

## Per-item workflow (applies to every subplan)

1. Re-read the subplan; confirm any listed decisions are resolved.
2. Implement, keeping the performance rules in mind (no full re-render per
   keystroke, O(changed) over O(all), no new deps without cost statement).
3. `npm test` — unit tests listed in the subplan must pass.
4. For perf-relevant items (03, 05, 07): run benchmark fixtures
   (`npm run fixtures`, scripts in `scripts/`), compare against budgets,
   record numbers in [benchmarks.md](../benchmarks.md).
5. Manual verification in the dev vault (`npm run dev`, Obsidian) — Electron
   app, no automated visual verification; report what was checked manually.
6. Log any architectural/perf decision in [DECISIONS.md](../DECISIONS.md)
   (03 supersedes part of the "sticky sides" entry).
7. Update the item's **Status** here and in the subplan
   (`planned → in progress → done`), then move to the next item.

## Status legend

`planned` — subplan written, not started · `in progress` — being implemented
· `blocked` — waiting on a decision · `done` — merged, tests + benchmarks
recorded.
