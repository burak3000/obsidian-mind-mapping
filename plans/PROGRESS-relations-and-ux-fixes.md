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
| M-F1 | Color invariant fix (pasted/moved branch adopts target color) | **Done** — reviewed, uncommitted (awaiting user review/commit) | — |
| M-F2 | New node brought into view before editor opens | **Done** — reviewed, uncommitted (awaiting user review/commit) | — |
| M-R1a | Same-doc relation model + rendering + toggle | **Not started** | — (D1/D2 resolved; review gate) |
| M-R1b | Drag-to-connect authoring gesture (optional) | **Cut for now** | D2 → chose Ctrl/Cmd+K only |
| M-R2 | Cross-document relation indicator | **Not started** | — (D3 default) |

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

## Coordinator handoff notes (for the Sonnet subagent, when launched)
- Read the plan and CLAUDE.md first; the performance rules are mandatory.
- Work the milestones in order F1 → F2 → R1a → (R1b) → R2.
- Ground every change in the files cited in the plan's "Current-code grounding".
- Stop and return any performance-vs-anything trade-off as a question; do not
  decide it. Do not add dependencies without a bundle/runtime cost statement.
- Do not `git commit` — leave changes in the working tree for user review.
