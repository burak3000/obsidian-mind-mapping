# Obsidian Mind Mapping Plugin — Implementation Plan

**Goal:** Build a custom Obsidian plugin that provides an XMind-like mind mapping experience directly on `.md` files, because existing community plugins fall short. **Performance is a first-class, non-negotiable requirement throughout.** This document is the working plan for iterative development with Claude Code.

---

## 1. Vision & Goals

- An interactive mind map view inside Obsidian that **works like XMind**: fast keyboard-driven node creation, organic curved branches, per-subtopic coloring, folding with child-count indicators, auto-balance, and custom positioning.
- The map **operates directly on `.md` files**: the markdown hierarchy reflects the mind map and vice versa (true bidirectional sync). The markdown file remains readable and useful as a normal note.
- Links (web URLs, file/folder links, Obsidian internal wikilinks) are first-class node content.
- The plugin must feel **instant, like a native app**, even on large maps and mid-range hardware. Performance is treated as a hard constraint equal to correctness.

### Non-goals (v1)
- Rich per-node styling (fonts, shapes, images, themes) — deferred to future versions ("support for more styling").
- Multi-sheet workbooks, presentation/pitch mode, Gantt views, or other XMind extras.
- Real-time multi-user collaboration.

---

## 2. Requirements Analysis

### 2.1 Functional requirements (from the XMind notes)

| # | Requirement | Notes / Interpretation |
|---|---|---|
| R1 | Works like XMind | UX conventions, shortcuts, and visual language modeled on XMind |
| R2 | `Tab` creates a new child under the selected node | Immediately editable; focus moves to new node |
| R3 | `Enter` creates a new sibling at the same level | Inserted after current node; immediately editable |
| R4 | Other important XMind shortcuts supported | Full map in §8 (navigation, rename, delete, fold, zoom, etc.) |
| R5 | Adding links: web links, file/folder links | Also Obsidian wikilinks `[[Note]]`; links clickable in map view |
| R6 | Works on `.md` files | No proprietary format as source of truth |
| R7 | Hierarchy reflects the mind map and vice versa | Bidirectional sync: edit md → map updates; edit map → md updates |
| R8 | Branches are organic (curved), not straight | Bezier-based branch paths |
| R9 | Branches are colored; each main subtopic a different color; children inherit parent's color | Color assigned per first-level branch, propagated down the subtree |
| R10 | Branch widths taper: parent branches thicker than children | Width decreases with depth, with a minimum floor |
| R11 | Auto-balance functionality | Automatic tidy layout distributing branches (e.g., left/right of root), rebalancing on structural change |
| R12 | Custom positioning | User can drag nodes to manual positions; manual nodes are excluded from auto-layout but persisted |
| R13 | Folding: hides all children, auto-rebalances visible branches | Layout cost proportional to *visible* nodes |
| R14 | Folded branch shows an indicator with hidden-children count | Badge next to the fold point, e.g., `⊕ 12` |
| R15 | Future: more styling options | Architecture must keep styling extensible |

### 2.2 Non-functional requirements

| # | Requirement |
|---|---|
| N1 | **Performance:** instant interactions, smooth pan/zoom, fast load — see §3 for concrete budgets. Every design decision must respect this. |
| N2 | **Data safety:** the md file is the source of truth; the plugin must never corrupt or lose user content, including content it doesn't understand. |
| N3 | **Markdown friendliness:** the file stays readable/editable as a plain note; metadata storage must be unobtrusive. |
| N4 | **Obsidian citizenship:** follow plugin guidelines (no monkey-patching internals, use Vault API, support light/dark themes, respect mobile constraints) to remain eligible for community plugin submission. |
| N5 | **Extensibility:** styling, layout, and rendering behind clean interfaces so future styling features don't require rewrites. |

### 2.3 Why existing plugins fall short (gap analysis)

- **Obsidian Mind Map (markmap-based):** read-only rendering of the outline; no editing from the map, no custom positioning, no folding persistence, no XMind-like interaction model.
- **Enhancing Mindmap:** editable but aging/unmaintained, limited layout control, sync quirks, no organic tapered branches or per-subtopic color inheritance done well.
- **Markmind:** closed/paid tiers, mixed md fidelity, its "rich" mode moves away from plain markdown as source of truth.
- **Obsidian Canvas / Excalidraw:** free-form, not hierarchy-bound; no md-hierarchy sync, no auto-balance, not keyboard-first.
- Common gaps this plugin targets: **true bidirectional md sync + XMind-grade keyboard flow + organic tapered colored branches + folding with indicators + auto-balance with manual-position override + high performance on large maps.**

---

## 3. Performance — First-Class Requirement

Performance is a **cross-cutting constraint that applies to every architectural decision, every feature, and every milestone**. It is not an optimization pass at the end.

### 3.1 Decision protocol (MANDATORY during development)

> **Whenever a trade-off arises between performance and ANY other concern — feature richness, visual fidelity, code simplicity, development speed, memory usage, sync granularity, library convenience — Claude Code must STOP and ASK the user which to prioritize. Never decide silently.** Present the options, the performance cost/benefit of each, and a recommendation, then wait for the user's decision.

### 3.2 `CLAUDE.md` block (copy into the project root)

```markdown
## Performance Rules (MANDATORY)

1. Performance is a top-priority requirement. Treat it as a hard constraint,
   equal to correctness.
2. Before implementing any feature, consider its impact on large maps
   (1,000+ nodes). Prefer incremental/O(changed) approaches over full
   recomputation.
3. DECISION PROTOCOL: On any trade-off between performance and anything
   else (features, visuals, simplicity, dev speed, memory, sync granularity,
   library convenience), STOP and ASK the user which to prioritize. Present
   options + performance cost/benefit + a recommendation. Never choose
   silently.
4. No new dependency without stating bundle-size and runtime cost; get
   approval if non-trivial (> ~50 KB min+gzip or any per-frame overhead).
5. After each milestone, run the performance benchmarks and report numbers
   against the budgets before moving on.
6. Avoid premature micro-optimization, but never make architectural choices
   that block later optimization (e.g., full re-render per keystroke, full
   re-parse per change).
```

### 3.3 Performance budgets

Measured on a mid-range machine; benchmark fixtures at **100 / 500 / 2,000 / 5,000 nodes** (5,000 = stress test: graceful degradation required, never a freeze).

| Metric | Target | Hard ceiling |
|---|---|---|
| Keystroke → node text update | < 16 ms (1 frame) | 33 ms |
| Tab/Enter → new node visible & editable | < 50 ms | 100 ms |
| Fold/unfold + rebalance start | < 50 ms | 100 ms |
| Pan/zoom frame rate | 60 fps | 30 fps |
| Open 500-node map | < 300 ms | 700 ms |
| Open 2,000-node map | < 1 s | 2 s |
| Full relayout of 2,000 nodes (compute) | < 100 ms | 250 ms |
| Md write-back after node edit | < 50 ms, debounced | — |
| Idle CPU (map open, no interaction) | ~0% | — |
| Memory, 2,000-node map (above baseline) | < 150 MB | 300 MB |
| Plugin bundle size | < 500 KB | 1 MB |

### 3.4 Expected performance trade-off points (ask the user when reached)

1. SVG vs Canvas/WebGL rendering beyond ~2–3k visible nodes.
2. Animation richness (smooth fold/rebalance transitions) vs frame budget.
3. Sync granularity: instant write-back (data safety) vs debounced batching.
4. Organic tapered branch visual fidelity vs path-generation/paint cost.
5. Full markdown round-trip fidelity vs simpler/faster serialization.
6. Feature-rich libraries vs bundle size and per-frame overhead.
7. Undo/redo depth vs memory.
8. External-edit watch frequency vs CPU.

---

## 4. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                     MindMapPlugin (main.ts)                │
│  - registers view, commands/hotkeys, settings tab          │
└──────┬─────────────────────────────────────────────────────┘
       │
┌──────▼──────────────┐   ┌───────────────────────────────┐
│ MindMapView          │   │ SettingsTab                  │
│ (ItemView, per leaf) │   │ (defaults: colors, layout,   │
│ - toolbar, canvas    │   │  debounce, animation caps)   │
└──────┬──────────────┘   └───────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────┐
│                      Controller                           │
│  - selection & focus state, command dispatch, undo/redo   │
└───┬───────────────┬───────────────────┬──────────────────┘
    │               │                   │
┌───▼─────────┐ ┌───▼────────────┐ ┌────▼─────────────────┐
│ Model        │ │ LayoutEngine   │ │ Renderer (SVG)       │
│ MindNode tree│ │ tidy/flextree, │ │ dirty-tracked,       │
│ + id index   │ │ incremental,   │ │ viewport-culled,     │
│ + subtree    │ │ balance L/R,   │ │ rAF-batched,         │
│   counts     │ │ manual overrides│ │ Bezier branch paths │
└───┬─────────┘ └────────────────┘ └──────────────────────┘
    │
┌───▼──────────────────────────────────────────────────────┐
│ SyncEngine (markdown ⇄ model)                             │
│ - parser (md → tree), serializer (tree → md)              │
│ - metadata codec (colors, positions, fold state)          │
│ - debounced write-back, external-change reconciliation    │
│ - Vault API only (no direct fs access)                    │
└───────────────────────────────────────────────────────────┘
```

**Key principles**
- **Model is the runtime source of truth** for the view; the md file is the persistent source of truth. The view never re-derives the tree from text during interaction.
- **Unidirectional update flow:** input → Controller mutates Model → LayoutEngine computes (partial) layout → Renderer applies dirty updates → SyncEngine writes md (debounced).
- **Everything incremental:** mutations, layout, rendering, and serialization all scale with the size of the *change*, not the map (N1).

---

## 5. Technology Stack

| Concern | Choice | Rationale (incl. performance) |
|---|---|---|
| Language | TypeScript (strict) | Obsidian standard; safety for a complex model |
| Build | esbuild | Obsidian sample-plugin standard; fast builds; small bundle |
| View | `ItemView` in a `WorkspaceLeaf` | Registered as an alternate view for `.md` files with a "Open as mind map" toggle (like Kanban plugin) |
| Rendering | **SVG** (hand-rolled renderer) | Crisp at any zoom, CSS-themable (light/dark), per-element events for hit-testing, DOM accessibility; scales to budget sizes with culling + dirty tracking. Canvas/WebGL fallback is a pre-identified trade-off (§3.4.1) |
| Layout | **`d3-flextree`** (only this module, not all of D3) | O(n) non-layered tidy tree supporting variable node sizes — exactly what balanced mind map layout needs; tiny footprint |
| Md parsing | Custom line-based parser | Full control over round-trip fidelity and incremental parsing; avoids heavyweight AST libs on the hot path |
| Persistence | Obsidian Vault API | Required for correctness with Obsidian's file cache and mobile |
| Testing | Vitest (unit/bench) + manual fixtures in a dev vault | Fast unit tests for parser/layout; benchmarks in CI |

Dependency policy: every dependency must justify bundle size and runtime cost (CLAUDE.md rule 4). Prefer small focused modules; no dependency may do per-frame or per-keystroke work without approval.

---
## 6. Data Model

```ts
interface MindNode {
  id: string;              // stable id (also used as md block id ^xxxxxx)
  text: string;            // node label (markdown inline allowed: links, bold)
  children: MindNode[];
  parent: MindNode | null;
  folded: boolean;
  colorKey?: string;       // set on first-level nodes; children resolve via ancestor
  manualPos?: { x: number; y: number }; // custom positioning (R12)
  // caches (maintained incrementally, never recomputed by walking on render):
  subtreeCount: number;    // descendants count → folding badge (R14), O(1) read
  layout?: { x: number; y: number; w: number; h: number; side: 'L' | 'R' };
}

interface MindMapModel {
  root: MindNode;
  byId: Map<string, MindNode>;   // O(1) lookup
  version: number;               // monotonic, for sync reconciliation
}
```

- Mutations (`addChild`, `addSibling`, `rename`, `delete`, `move`, `fold`) are localized and update `subtreeCount` caches along the ancestor chain only — O(depth), not O(n).
- Undo/redo via an operation log (inverse operations), not full-tree snapshots (memory-friendly; depth is a §3.4.7 trade-off knob).

---

## 7. Markdown ⇄ Mind Map Sync

### 7.1 Mapping strategy

Source of truth: standard markdown structure.

```
# Central Topic                ← root (H1 or file name if no H1)
## Main Subtopic A             ← first-level branch (colored)
- child item                   ← deeper levels as nested list items
  - grandchild
## Main Subtopic B
- another child [[Some Note]]  ← links preserved as markdown/wikilinks
```

- **Headings (H1–H6)** map the upper hierarchy; **nested list items** continue below the deepest heading level used. (Simple rule: a node becomes a heading while its depth ≤ configured heading depth, else a list item — configurable in settings.)
- Node text is markdown inline content: `[text](url)` web links, `[[wikilinks]]`, `file:///` or vault-relative file/folder links (R5). The renderer displays them as clickable elements; click opens via Obsidian's `openLinkText` / default handlers.
- Non-mindmap content (paragraphs under a heading, code blocks, frontmatter) is **preserved verbatim and re-attached** to its owning node on serialization (N2, N3). The parser stores it as opaque `attachedContent` on the node.

### 7.2 Metadata persistence (colors, positions, fold state)

Metadata that doesn't fit markdown lives in a single **frontmatter block under a plugin key**, keyed by node block-ids:

```yaml
---
mindmap:
  layout: balanced
  nodes:
    ^a1b2c3: { color: "#e5484d" }        # first-level color override
    ^d4e5f6: { pos: [420, -180] }        # manual position (R12)
    ^g7h8i9: { folded: true }            # persisted fold state (R13)
---
```

- Block ids (`^a1b2c3`) are appended to lines only when a node actually has metadata — files stay clean by default.
- Alternative considered: sidecar `.mindmap.json` file (zero md pollution but risks orphaning) and HTML comments per line (noisy). Frontmatter chosen as default; **this is revisitable — if round-trip cost or file noise becomes an issue, present options to the user (§3.1).**

### 7.3 Sync mechanics (performance-critical)

- **Map → md:** debounced write-back (default 400 ms after last mutation; configurable). Serializer is single-pass O(n) with string-builder output. Never writes per keystroke.
- **Md → map (external edits):** subscribe to Vault `modify` events; skip events caused by our own writes (version stamp). Reconcile by re-parsing and diffing against the model **by block-id first, then by structural position**, so unrelated subtrees keep identity, selection, and fold state. Full re-parse is the fallback; incremental region re-parse is an optimization milestone.
- **Conflict rule:** if the file changed externally while unsaved map mutations exist, prefer non-destructive merge; if a true conflict remains, ask the user (never silently drop either side) (N2).
- Parsing very large files yields to the event loop in chunks to avoid blocking the UI.

---

## 8. Keyboard Shortcuts (XMind parity)

All registered as Obsidian commands (user-remappable) with defaults scoped to the mind map view:

| Shortcut | Action | Req |
|---|---|---|
| `Tab` | New child of selected node | R2 |
| `Enter` | New sibling after selected node | R3 |
| `Shift+Enter` | New sibling before selected node | R4 |
| `F2` or double-click | Edit node text (inline overlay editor) | R4 |
| `Esc` | Finish/cancel editing; clear selection | R4 |
| `Delete` / `Backspace` | Delete node (+subtree) with undo | R4 |
| `Arrow keys` | Navigate to nearest node in direction | R4 |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo | R4 |
| `Ctrl/Cmd+/` | Fold / unfold selected branch | R13 |
| `Ctrl/Cmd+K` | Insert/edit link on node | R5 |
| `Ctrl/Cmd+=` / `Ctrl/Cmd+-` / `Ctrl/Cmd+0` | Zoom in / out / reset (fit) | R4 |
| `Space` (hold) + drag, or middle-drag | Pan canvas | R4 |
| `Ctrl/Cmd+Home` | Center on root | R4 |
| Drag node | Reorder within tree; `Alt`+drag → detach to manual position | R12 |

Handlers are synchronous and light; serialization and layout animation are deferred (§3).

---

## 9. Rendering & Layout

### 9.1 Organic branches (R8)

- Each branch is a cubic Bezier from parent anchor to child anchor; control points offset horizontally by a fraction of the gap for the classic XMind "S-curve".
- **Tapered width (R10):** stroke width by depth, e.g., `w = max(1.5, 10 · 0.66^depth)` px — root limbs thick, leaves thin. For high-fidelity taper (variable width along one path), filled outline paths are an option — extra path cost → §3.4.4 trade-off.
- Path strings are precomputed and cached; only paths whose endpoints moved are regenerated.

### 9.2 Colors (R9)

- A default palette (colorblind-aware, theme-adaptive) assigns each first-level branch the next color; all descendants resolve color by walking up to their first-level ancestor (cached per node, invalidated on re-parent).
- Node border/text accents match branch color; overrides persisted via metadata (§7.2). Palette editable in settings; per-node color UI is a "future styling" item (R15).

### 9.3 Auto-balance layout (R11)

- `d3-flextree` computes a tidy layout per side; first-level branches are partitioned Left/Right to balance total subtree heights (classic XMind balanced map). Modes: `balanced` (default), `right-only`, `left-only`.
- **Incremental relayout:** subtree extents cached; a local edit recomputes the changed subtree and shifts affected siblings/ancestors — O(changed + shifted), not O(n).
- **Manual positions (R12):** nodes with `manualPos` (and their subtrees) are pinned and excluded from auto-layout; a "re-balance" command clears pins on demand.
- Transitions animate via interpolated transforms with a capped duration; animation auto-disables above a node-count threshold (threshold tuning → ask the user, §3.4.2).

### 9.4 Folding (R13, R14)

- Folding sets `node.folded = true`; children leave the layout and the scene graph entirely → relayout and render cost proportional to *visible* nodes.
- A count badge (`⊕ N`) renders at the branch end using the incrementally-maintained `subtreeCount` — O(1), never a walk.
- Clicking the badge or `Ctrl/Cmd+/` unfolds; fold state persists via metadata (§7.2).

### 9.5 Renderer performance rules

- Dirty tracking: text edit re-renders one node; fold re-renders one region — never the whole SVG.
- Viewport culling: offscreen nodes/branches detached on large maps.
- All DOM writes batched in `requestAnimationFrame`; reads and writes never interleaved (no layout thrash).
- Pan/zoom via a single root `transform` (GPU-composited), not per-node updates.
- Inline text editing in a lightweight positioned overlay (`contenteditable`/input), not via file round-trip.

---

## 10. Implementation Roadmap (milestones for Claude Code)

> After **every** milestone: run benchmarks (§12) on the 100/500/2,000-node fixtures and report against budgets **before proceeding**. Surface any §3.4 trade-off encountered.

**M0 — Scaffold & harness (small)**
Sample-plugin skeleton (TS + esbuild), `manifest.json`, dev vault, hot-reload, benchmark fixture generator (100/500/2k/5k nodes), empty `MindMapView` registered with an "Open as mind map" command + file-menu entry.

**M1 — Read-only map from md**
Parser (headings + lists → model), flextree layout (right-only), SVG renderer with straight lines, pan/zoom, node selection. *Exit:* 2k-node file opens within budget.

**M2 — Core editing + sync**
Tab/Enter/F2/Delete/arrows, inline editor, undo/redo, serializer with content preservation, debounced write-back, external-change reconciliation by block-id. *Exit:* keystroke and node-creation latency within budget; round-trip loses nothing.

**M3 — XMind visuals**
Organic Bezier branches, per-subtopic color inheritance, tapered widths, balanced L/R layout, theme adaptation. *Exit:* full relayout of 2k nodes < 100 ms.

**M4 — Folding & balance polish**
Fold/unfold with count badges, persisted fold state, incremental relayout, capped animations with auto-disable threshold.

**M5 — Links & custom positioning**
`Ctrl/Cmd+K` link editor; clickable web/wikilink/file/folder links; Alt+drag manual positioning with persistence; re-balance command; drag-reorder.

**M6 — Hardening & release**
Viewport culling, incremental parse optimization, 5k stress test, mobile spot-check, settings tab (palette, debounce, animation caps, heading depth), README/docs, community plugin submission checklist (guidelines compliance, versioning, release workflow).

---

## 11. Testing Strategy

- **Unit (Vitest):** parser/serializer round-trip property tests ("parse→serialize is identity on fixtures, including non-map content"), model mutations + `subtreeCount` invariants, layout snapshots, metadata codec.
- **Sync tests:** external-edit reconciliation (identity preservation by block-id), conflict scenarios, self-write suppression.
- **Performance benchmarks (per milestone, logged to `benchmarks.md`):** parse/serialize time, full & partial layout time per fixture; manual interaction checks (typing latency, fold, pan/zoom at 2k nodes); heap snapshots and leak check (open/close view ×10).
- **Manual QA vault:** curated files — huge map, deep map, wide map, md with code blocks/frontmatter/paragraphs, links of every kind, light/dark themes.
- Regression rule: any metric worsening > 20% vs last milestone is flagged and discussed before merging.

---

## 12. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| Md files with structures that don't map cleanly (skipped heading levels, mixed lists, tables) | Tolerant parser; unmappable content preserved as attached content; never destroyed |
| Data loss on serialization | Round-trip property tests; write only when model dirty; conflict rule §7.3 |
| SVG limits at 5k+ nodes | Culling first; Canvas fallback is a pre-declared user decision (§3.4.1) |
| External sync tools (Obsidian Sync, git) touching the file mid-edit | Version-stamped reconciliation; merge-first, ask on true conflict |
| Block-id churn cluttering files | Ids only added when metadata exists; cleanup command |
| Mobile performance & touch | Budgets ×2 on mobile; touch pan/zoom; test on phone from M3 |
| Obsidian API changes | Pin `minAppVersion`; use only public APIs |

---

## 13. Future Enhancements (post-v1)

- More styling (R15): per-node colors/shapes/fonts, images/icons on nodes, boundary/summary shapes, themes.
- Export: PNG/SVG/PDF, XMind import.
- Search/filter within map; jump-to-node from editor cursor and back.
- Relationship lines between arbitrary nodes; notes/labels on nodes.
- Multiple maps per file (per-heading root selection).

---

*Performance rules in §3 override any conflicting guidance elsewhere in this plan. When in doubt between performance and anything else: ask the user.*
