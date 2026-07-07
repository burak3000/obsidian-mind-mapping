# Performance Addendum — Obsidian Mind Mapping Plugin

> **How to use this document:** Append this addendum to the main implementation plan (`obsidian-mindmap-plugin-plan.md`) or keep it alongside it. Its rules **override** any conflicting guidance in the main plan. Copy the "Instructions for Claude Code" section into the project's `CLAUDE.md` file so it is always in context during development.

---

## 1. Performance Is a First-Class, Non-Negotiable Requirement

Performance is not a "nice to have" or a Phase-N optimization pass. It is a **cross-cutting constraint that applies to every architectural decision, every feature, and every milestone** in the plan. The plugin must feel instant — like a native application — even on large mind maps and mid-range hardware.

Every section of the main plan (data model, markdown sync, rendering engine, layout algorithm, folding, shortcuts) must be read with this addendum in mind.

---

## 2. Instructions for Claude Code (copy into `CLAUDE.md`)

```markdown
## Performance Rules (MANDATORY)

1. Performance is a top-priority requirement for this plugin. Treat it as a
   hard constraint, equal to correctness.
2. Before implementing any feature, consider its performance impact on large
   mind maps (1,000+ nodes). Prefer incremental/O(changed) approaches over
   full recomputation.
3. **Decision protocol:** Whenever you face a trade-off between performance
   and ANY other concern — feature richness, visual fidelity, code
   simplicity, development speed, memory usage, sync granularity, library
   convenience — you MUST STOP and ASK the user which to prioritize.
   Never silently choose. Present the options, the performance cost/benefit
   of each, and your recommendation, then wait for the user's decision.
4. Never introduce a dependency without stating its bundle-size and runtime
   cost and getting approval if it is non-trivial (> ~50 KB min+gzip or any
   per-frame overhead).
5. After implementing each milestone, run the performance benchmarks
   (Section 7) and report the numbers against the budgets before moving on.
6. Avoid premature *micro*-optimization, but never make *architectural*
   choices that block later optimization (e.g., full re-render on every
   keystroke, full re-parse of the md file on every change).
```

Rule 3 is the most important one: **any performance-vs-anything trade-off must be surfaced to the user as an explicit question, never decided unilaterally.**

---

## 3. Performance Budgets (Targets)

These budgets define what "very performant" means concretely. Measure on a mid-range machine (and periodically on mobile, since Obsidian runs there too).

| Metric | Target | Hard ceiling |
|---|---|---|
| Keystroke → node text update on screen | < 16 ms (1 frame) | 33 ms |
| Tab/Enter → new node visible & editable | < 50 ms | 100 ms |
| Fold/unfold branch (incl. rebalance animation start) | < 50 ms | 100 ms |
| Pan/zoom frame rate | 60 fps | 30 fps |
| Open a map with 500 nodes | < 300 ms | 700 ms |
| Open a map with 2,000 nodes | < 1 s | 2 s |
| Full relayout (auto-balance) of 2,000 nodes | < 100 ms compute | 250 ms |
| Markdown sync after node edit (write-back) | < 50 ms, debounced | — |
| Idle CPU usage (map open, no interaction) | ~0% | — |
| Memory for 2,000-node map | < 150 MB above baseline | 300 MB |
| Plugin bundle size | < 500 KB | 1 MB |

Benchmark fixture sizes: **100 / 500 / 2,000 / 5,000 nodes** (5,000 is a stress test, not a budgeted target — degradation must be graceful, never a freeze).

---

## 4. Performance Requirements per Architectural Area

### 4.1 Data Model
- Single in-memory tree as the source of truth for the view; **never** re-derive the tree from the markdown text on every interaction.
- O(1) node lookup by id (Map-based index), parent/child links held directly.
- Mutations are localized: adding/renaming/folding a node must not touch unrelated subtrees.

### 4.2 Markdown Parsing & Bidirectional Sync
- **Incremental parsing:** on external file changes, diff and re-parse only the changed region where feasible; full re-parse only as a fallback.
- **Debounced write-back** (e.g., 300–500 ms after last edit) with batched serialization; never write the file on every keystroke.
- Serialization must be O(n) single-pass; avoid regex-heavy per-line processing on large documents.
- Sync must never block the UI thread noticeably; if parsing a very large file, consider chunking/yielding.

### 4.3 Rendering Engine
- Only re-render what changed (dirty tracking). A text edit re-renders one node; a fold re-renders one subtree region — never the whole SVG.
- **Viewport culling / virtualization:** nodes and branches outside the visible viewport are not rendered (or are detached) on large maps.
- Batch DOM writes inside `requestAnimationFrame`; never interleave reads and writes (layout thrashing).
- Pan/zoom via a single root `transform` (GPU-composited), not per-node updates.
- Organic Bezier branches: precompute path strings; recompute only paths affected by a layout change.
- If SVG hits limits at the stress-test size, the Canvas/WebGL fallback is a **performance-vs-simplicity trade-off → ask the user** (per the decision protocol).

### 4.4 Layout / Auto-Balance
- Use an O(n) tidy-tree style algorithm; cache subtree extents so local edits trigger **partial relayout** (recompute the changed subtree + ancestors, shift siblings), not a full pass.
- Folding removes the subtree from layout entirely: cost proportional to *visible* nodes.
- Animate transitions with interpolated transforms, capped duration, and skip animation automatically above a node-count threshold (threshold value → ask the user when tuning).
- Custom-positioned nodes are excluded from auto-layout without forcing a global recompute.

### 4.5 Interaction & Shortcuts
- Keyboard handlers must be synchronous and light; defer md serialization and non-essential work (debounce/idle callbacks).
- Inline node text editing happens in a lightweight overlay editor, not by round-tripping through the file.
- Hit-testing for node selection via spatial indexing (or cheap bounding-box checks scoped by viewport) on large maps.

### 4.6 Folding Indicators
- The child-count badge is computed from cached subtree counts (maintained incrementally on mutation), never by walking the subtree on render.

---

## 5. Dependency Policy

- Every dependency must justify itself in bundle size and runtime cost (see CLAUDE.md rule 4).
- Prefer small, focused libs (e.g., `d3-flextree` alone) over pulling in all of D3 or a full mind-map framework with unneeded overhead.
- No runtime dependency may perform work on every frame or every keystroke unless explicitly approved.

---

## 6. Development Process Rules

- **Profile early:** from Milestone 1 onward, keep the 2,000-node fixture loadable and check it after each milestone.
- Use Chrome DevTools Performance panel inside Obsidian (Ctrl+Shift+I) for flame charts; watch for long tasks > 50 ms.
- Any PR/milestone that regresses a budget metric by > 20% must be flagged and discussed with the user before merging.
- Architectural decision records: when a design choice affects performance, note the choice, alternatives, and measured/estimated cost in a short `DECISIONS.md` entry.

---

## 7. Performance Testing Strategy (extends main plan's testing section)

1. **Benchmark fixtures:** generated md files at 100 / 500 / 2,000 / 5,000 nodes with realistic text lengths and link density.
2. **Automated micro-benchmarks** (run in CI or a local script): parse time, serialize time, full layout time, partial layout time per fixture size.
3. **Manual interaction checks per milestone:** typing latency, Tab/Enter responsiveness, fold/unfold, pan/zoom smoothness on the 2,000-node fixture.
4. **Memory snapshots:** heap size before/after opening each fixture; check for leaks after opening/closing the view 10×.
5. **Mobile spot-check** (later milestones): budgets ×2 are acceptable on mobile, but no freezes.
6. Record results in a `benchmarks.md` log per milestone so regressions are visible over time.

---

## 8. Known Performance-Sensitive Trade-offs to Expect (ask the user when reached)

These are decision points where performance will likely conflict with another goal. Per the decision protocol, Claude Code must present each one and ask:

1. **SVG vs Canvas/WebGL rendering** — simplicity, styling, and accessibility vs raw scalability beyond ~2–3k visible nodes.
2. **Animation richness** (smooth rebalance/fold animations) vs frame budget on large maps.
3. **Sync granularity** — instant write-back (data safety) vs debounced batching (performance).
4. **Organic branch visual fidelity** (complex tapered variable-width paths) vs path-generation and paint cost.
5. **Full markdown fidelity** (preserving all user formatting on round-trip) vs faster, simpler serialization.
6. **Library convenience** (feature-rich mind map/graph libs) vs bundle size and per-frame overhead.
7. **Undo/redo depth and granularity** vs memory usage.
8. **Live preview of external file edits** (watch + re-parse frequency) vs CPU usage.

---

*End of Performance Addendum — rules here take precedence over the main plan where they conflict.*
