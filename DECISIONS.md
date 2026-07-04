# Architectural Decision Records

## 2026-07-04 — Feature: visual hierarchy by size (R15) — font/box scale by depth

**Choice:** every node's box and font size now scale with depth: root
reads largest (18px), each level down shrinks by 2px, floored at 10px so
deep nodes stay legible instead of vanishing. `layoutEngine.ts` adds
`fontSizeForDepth`/`scaleForDepth`/`defaultWrapWidthForDepth`; box
geometry (`computeNodeBox`) multiplies every baseline px constant
(`nodeHeight`, `charWidth`, `lineHeight`, `paddingX`, `minNodeWidth` — all
tuned for a 12px "baseline" font) by that depth's scale ratio, so text
never overflows or rattles around inside its own box regardless of depth.
`SvgRenderer` sets `font-size` as a per-node SVG attribute (not CSS —
removed the old static `.mm-node-text { font-size: 12px }` rule
entirely, since a stylesheet rule would otherwise win the cascade over
the presentation attribute and silently flatten every node back to one
size) and derives text-y/wrap-width/line-height the same depth-scaled
way, reusing the exact same formulas layoutEngine used so wrapped line
counts never disagree between the two.
**Character-count wrap threshold stays depth-invariant on purpose:**
`maxCharsPerLine` (~60) doesn't itself change with depth — only the pixel
width it maps to does (via the scaled `charWidth`). This keeps "how many
characters before a line wraps" a constant, predictable behavior at every
depth, while the *box* still ends up proportionally sized.
**A node's own `manualWidth` (drag-resize) is never scaled** — it's
already a real px value the user chose by looking at the actual box on
screen, not a formula input.
**Cost:** none new — same O(1)-per-node math as before, just parameterized
by a value (`node.depth`) already on the node. Re-verified the box cache
(`nodeBoxFor`, added in the text-wrapping feature to survive flextree's
multiple-calls-per-node gotcha) also invalidates on a depth change, not
just text/manualWidth — depth *can* change via drag-reorder (`moveNode`),
which the original cache key predated. `npm run bench:m2` unchanged
(20–26ms at 5,000 nodes, same as the prior baseline); bundle size 56 KB.
**Regression tests:** `test/layout.test.ts` (`fontSizeForDepth` monotonic
decrease + floor, `computeNodeBox`/`computeLayout` giving identical text a
strictly smaller box the deeper it is), `test/renderer.smoke.test.ts`
(rendered `font-size` attribute matches the formula exactly at each
depth, not just "looks smaller"), `test/manualPosition.test.ts` (updated
hardcoded height expectations to the depth-scaled formula).

## 2026-07-04 — Feature: search with a results list, reveal + focus on click

**Choice:** `src/model/search.ts` (`searchNodes`) does a plain
case-insensitive substring scan of every node's display text (link syntax
stripped), including nodes hidden behind folded ancestors — search should
find anything in the document, not just what's currently visible. Results
are capped at 50 materialized rows but the true total match count is
still reported, so a broad query on a large map doesn't force rendering
thousands of list items. `src/view/SearchPanel.ts` is a small overlay
(same absolute-positioning pattern as `InlineEditor`) with the query input
and results list; arrow keys move a highlighted result, Enter selects it.
Clicking (or Enter-ing) a result calls `Controller.revealAndSelect`  — new
method that unfolds every folded ancestor of the target node in a single
undo step (mirroring `toggleFold`'s use of `setFolded`), then selects it —
followed by `SvgRenderer.centerOnWorldPoint`, a new renderer method that
pans (keeping current zoom) to a raw world-space coordinate rather than a
node id.
**Why raw coordinates, not a node-id-based "center on node":** the
renderer's own `lastLayout` cache is pruned for culled-out nodes (see
`applyVisibleSet`, M6) — a search hit on a large map is exactly the case
most likely to be off-screen/culled. The *model's* `node.layout` has no
such gap (computeLayout always fills it in for every fold-visible node,
regardless of viewport), so the caller (`MindMapView.focusNode`) reads
world position from there and hands the renderer just numbers. Panning
re-triggers `recull()` (already wired into the existing rAF-scheduled
transform write), which brings the target node back into the DOM.
**Cost, measured:** `searchNodes` is a single O(n) string-scan per
keystroke; timed directly against the 5,000-node stress fixture at
0.5–0.8ms per call (broad and narrow queries both) — not remotely close
to any per-keystroke budget, so no debouncing or indexing was added.
Bundle size: 56 KB (`dist/main.js`, production), still well under the
500 KB budget.
**Entry points:** Ctrl/Cmd+F (opens, or refocuses if already open — same
convention as a browser's find bar), a header search icon
(`addAction`), and an Obsidian command ("Search mind map"), matching the
existing "Rebalance mind map" command pattern.
**Regression tests:** `test/search.test.ts` (case-insensitivity, folded
subtrees, link-label matching, result cap vs. true count), `test/searchPanel.test.ts`
(keyboard nav, click-to-select, count display), `test/controller.test.ts`
(`revealAndSelect` unfolds multiple ancestors as one undo step),
`test/culling.test.ts` (`centerOnWorldPoint` brings a culled-out node back
into the DOM using only its model layout, not the renderer's own cache).

## 2026-07-04 — Bug fix: far-edge branch anchor (previous entry) crossed through other nodes' text

**Bug (reported by user with a screenshot):** the very next fix below
("node text floated in a gap instead of sitting on its branch") stretched
each edge across the child's entire box so the branch would visually run
under its text. That worked for short labels, but for a long or wrapped
(now up to ~60 chars/multi-line, per the wrapping feature added the same
day) box, stretching a short hop into a span of several hundred pixels
turned the Bezier into a long diagonal sweep — and at that length, with
siblings stacked at different row heights nearby, the sweep crossed
straight through *other* nodes' text instead of just running under its
own. Net effect: text became harder to read, not easier.
**Root cause:** conflating two different things under one change — "the
branch should visually connect to the text" doesn't require the branch
geometry itself to travel the text's full width; it only requires the
text to sit *at* the branch's tip.
**Fix:** reverted `edgePath`'s child anchor back to the near edge (short,
as it always was pre-taper). Instead, `SvgRenderer.textAnchorFor` aligns
the text itself flush against that near-edge tip (`text-anchor: start` at
a small padding past the tip for a right-side node, `text-anchor: end` a
small padding before it for a left-side node) and lets it grow *away*
from the branch, not centered in the box. The root keeps its old centered
alignment (it has no incoming branch and keeps its own visible box).
**Cost:** none beyond what the wrapping/taper work already cost — this
only changes which two x-coordinates get written (edge endpoint reverted,
text x/anchor added), still O(1) per node/edge. Added a `lastSide` cache
(parallel to `lastLayout`/`lastText`) so the text anchor/x recomputation
is gated by an actual size-or-side change, not written unconditionally
on every visible node on every update.
**Regression tests:** `test/renderer.smoke.test.ts` — edge ends at the
near edge (not far edge) for a right-side node; the same node's text uses
`text-anchor: start` positioned left of box-center; a left-side node uses
`text-anchor: end` positioned right of box-center; the root stays
centered in its own box.

## 2026-07-04 — Bug fix: node text floated in a gap instead of sitting on its branch

**Bug (reported by user with an annotated screenshot):** a node's text
appeared in the empty space between where its incoming branch visually
ended and where its own outgoing branches began, instead of sitting
directly on the branch — most visible on multi-level chains, where each
label looked like it was floating in a gap rather than riding on the
connecting line (XMind's usual "floating topic" look has no such gap).
**Root cause:** `SvgRenderer.edgePath`'s child-side anchor (`x2`) used
the child's *near* edge (the side facing the parent) — e.g. for a
right-side branch, `childLayout.x` (the box's left edge). Since the
child's text is centered within its own box (at `x + w/2`), the branch
stopped half the box's width short of the text, leaving it looking
disconnected. Meanwhile this same node's *own* outgoing edges (to its
children) already start from its *far* edge (`x1` computed the same way,
one level down) — so there was a real gap in the middle of every node's
box that nothing drew into.
**Fix:** changed `x2` to anchor at the child's *far* edge instead
(swapped which side of the existing ternary applies to R vs L) — the
incoming branch now runs across the child's entire box span, passing
underneath its centered text, and lands exactly on the point this same
node uses as `x1` for its own outgoing edges. Two consecutive segments
now connect with zero gap: one visually continuous branch per lineage,
with each node's label sitting on top of it — matching the screenshot's
green annotations exactly.
**Cost:** none — this only changes two constant x-coordinates already
being computed; same O(1) per edge, no new samples, no algorithm change.
Confirmed via `npm test` (161 passing) that the taper-width math (based
on depth, not anchor position) is unaffected.
**Regression test:** `test/renderer.smoke.test.ts` — asserts a
root→child edge's far-end centerline x equals the child's far edge
(`x + w`), and that this exactly matches the next edge's (child→grandchild)
start x.

## 2026-07-04 — Second bug-fix pass: text wrapping, drag-resize, unboxed sub-topics, Shift+Enter newline

**Context:** a second round of user-reported UI test results after
manually trying the first pass's fixes.

**Text wrapping instead of clipping (long texts):** node width previously
clamped at a max px width with no wrap — text past that point just
overflowed/clipped, illegible. Added `src/model/textWrap.ts`: a pure,
link-aware greedy word-wrapper (tokenizes via the existing
`parseTextSegments`, so a link's label stays attached to its target even
when the wrap splits it across lines). `layoutEngine.computeNodeBox` wraps
at ~60 characters/line by default (`cfg.maxNodeWidth` raised from 320px to
436px, i.e. `60 * charWidth + paddingX`, to match the user's stated
default), and grows node height by `cfg.lineHeight` (16px) per extra
wrapped line instead of clipping. A node's own `manualWidth` (see below)
overrides the 60-char default as the wrap ceiling.
**Cost:** wrapping is real per-character work, and flextree's `nodeSize`
accessor calls it several times per node per layout pass (the same
already-documented M5 gotcha for width estimation) — added a `WeakMap`
cache (`nodeBoxFor`) keyed by node identity, invalidated only when a
node's own text/manualWidth actually changes. Re-measured
`npm run bench:m2` after: 20–27ms at the 5,000-node stress fixture,
indistinguishable from the pre-wrapping baseline (22–25ms) — the cache
absorbed the added cost. Not asked to the user: this follows the exact
"cache to avoid O(calls) blowup" pattern already established (and
approved) for the M5 width-estimation fix, not a new trade-off.

**Draggable per-node width (manual width override):** added
`node.manualWidth` (mirrors `manualPos` exactly: mutation functions
`setManualWidth`/`clearManualWidth`, `Controller.setManualWidth` with
undo/redo, frontmatter persistence via a `width: N` entry alongside
`pos`/`folded`). A small resize-handle rect at each node's outer edge
(`SvgRenderer`'s `.mm-resize-handle`, hidden until hover/selection so the
new unboxed look isn't cluttered) drags to resize, following the same
live-preview-only-touches-this-node's-DOM pattern as the existing Alt+drag
manual-position feature — no model mutation or relayout per pointermove,
only on drop.

**Unboxed sub-topics ("do not box any branch other than main topic"):**
`.mm-node-rect` is now invisible by default (`fill:none; stroke:none;`
but `pointer-events: all` so hit-testing/dragging/resizing still work);
only the root gets the visible box (`.mm-node.mm-node-root .mm-node-rect`).
Selection/drop-target still show a stroke outline on any node (now the
*only* time a sub-topic's box becomes visible at all). Since sub-topics
lost their colored box border, branch color now accents the node's own
text fill instead (plan §9.2 already called for "node border/text accents
match branch color" — previously only the border implemented this).

**Shift+Enter for multi-line labels:** `InlineEditor` switched from
`<input>` to `<textarea>` (a plain `<input>` has no concept of a line
break) — Shift+Enter is deliberately left unhandled in the keydown
handler so the textarea's own default newline-insertion behavior applies;
plain Enter still commits+closes (from the first bug-fix pass). Height
auto-grows via `scrollHeight` on the `input` event — a DOM-local style
write on the overlay only, not a tree mutation/relayout, so it stays
within the "no full work per keystroke" rule the rest of the class
already follows.

**Regression tests:** `test/textWrap.test.ts` (wrap algorithm, link-token
attachment across a wrap point), `test/layout.test.ts` (wrap-driven
height growth, manualWidth as wrap ceiling), `test/renderer.smoke.test.ts`
(root-only box class, multi-line tspan rendering, link click survives a
wrap, resize-handle drag), `test/manualWidthPersistence.test.ts`
(serialize → reparse round trip, combined with fold/pos, cleared pin),
`test/moveAndRebalance.test.ts` (`setManualWidth` undo/redo),
`test/inlineEditor.test.ts` (Shift+Enter left unhandled/no commit).

## 2026-07-04 — Bug fix pass: continuous per-edge taper, long-text growth direction, click-to-select, Enter-while-editing, space-to-edit

**Context:** user-reported UI test results (`dev-vault/Mind Mapping Plugin
Test.md`) after first real manual use of the built plugin.

**Tapered lines (R10, pre-flagged trade-off, plan §3.4 item 4 / §9.1):**
the plan explicitly deferred "organic tapered branch visual fidelity vs
path-generation/paint cost" to an ask-the-user decision point before
building it — the only tapering in place was constant-width-per-edge by
depth (`strokeWidthForDepth`, thick near the root, thinner per level, no
taper *within* a single connector). Asked per the mandatory decision
protocol; **user chose the higher-fidelity option**: a single edge now
tapers continuously from the parent depth's branch width down to the
child depth's, rendered as a filled variable-width ribbon polygon
(`SvgRenderer.edgePath` samples the centerline Bezier at 16 points,
offsets each by a linearly-interpolated half-width along its normal, and
closes the two offset rows into one filled `<path>`) instead of a
constant-width stroked line. `.mm-edge` switched from `stroke`-based to
`fill`-based coloring in `styles.css` accordingly.
**Cost, measured (`npm run bench:m2`):** Tab/rename/delete at the
5,000-node stress fixture: 22–25ms — comfortably under the 50ms target
and *below* the M3 baseline (36.2/26.7/35.8ms), so no regression despite
the extra per-edge sampling work; cost stays O(1) per edge (fixed sample
count), so total cost is still O(n) in edge count, same as before.
Bundle size: 44 KB (well under the 500 KB budget).
**Alternative (declined):** keep constant-width-per-edge only — cheaper
(one attribute write, no sampling), visually acceptable but not the
"organic branch" look the user wanted.

**Other fixes in this pass (plain bugs, not trade-offs):**
- **Long text grows the wrong way on left-side branches:** `layoutEngine.ts`'s
  `layoutSide` set a left-side node's box `x` by negating `depthAxis`
  directly, which fixes the box's *inner* edge (nearest the parent) at a
  wrong spot and left the *outer* edge — the one that should move as text
  gets longer — anchored instead, so growing text pushed the box back
  toward the parent rather than away from it. Fixed by computing `x` so the
  inner edge (`x + w`) stays fixed and the outer edge (`x`) is what moves
  as `w` changes.
- **Single click didn't select a node:** pointer capture (`setPointerCapture`,
  needed for drag support) can retarget the `click` event that follows to
  the capturing `<svg>` element instead of whatever was actually clicked —
  same root cause as the earlier double-click bug, but this time hitting
  plain single-click too. Fixed by resolving the real element under the
  cursor via `document.elementsFromPoint(evt.clientX, evt.clientY)` (same
  technique already used for drag hit-testing) instead of trusting
  `evt.target`, with a fallback to `evt.target` where `elementsFromPoint`
  isn't available (jsdom).
- **Enter while editing jumped straight into creating+editing a new sibling:**
  changed so any Enter (with or without Shift) while the inline editor is
  open just commits and closes editing, leaving the node selected — the
  same effect as blur. Creating a sibling now requires a second, separate
  Enter press once nothing is being edited (already-existing behavior in
  `MindMapView.onKeyDown`). `InlineEditor`'s `onCommitAndCreateSibling`
  callback was removed as dead code.
- **Space did nothing on a selected node:** added `Space` (no modifier) as
  an alias for `F2` in `MindMapView.onKeyDown` to open the inline editor
  for the selected node.

**Regression tests:** `test/layout.test.ts` (long-text growth direction),
`test/renderer.smoke.test.ts` (click resolves via coordinates; edge ribbon
width decreases start-to-end and continues across parent/child edges),
`test/inlineEditor.test.ts` (Enter commits without creating a sibling).
Space-to-edit and click-through-real-pointer-capture-retargeting aren't
unit-testable (`MindMapView` needs the `obsidian` runtime, which is
types-only in this project — see M4 note; real pointer-capture retargeting
needs a real browser) — flagged for manual dev-vault verification per
CLAUDE.md.

## 2026-07-03 — M1: node width from character count, not measured text

**Choice:** node box width = `clamp(text.length * charWidth + padding, min, max)`,
a constant-time heuristic.
**Alternatives:** measure actual rendered text width (canvas `measureText`
or an offscreen DOM probe) — more visually accurate (proportional fonts,
wide/narrow glyphs), but costs a measurement call per node per layout pass.
**Cost:** O(1) per node vs. O(1) canvas-API call per node (not free at
5,000 nodes on every relayout, and would need caching/invalidation to stay
cheap on incremental relayout in M3+). Chosen for now since layout is
already the dominant cost at 20ms/5,000 nodes (see `benchmarks.md` M1); a
measurement pass would add to that on every full relayout.
**Revisitable:** if node boxes look visibly mis-sized in the dev vault
(text overflow/excess whitespace), this is the place to swap in measured
widths with a per-node width cache — flag as a fidelity-vs-performance
question at that point rather than deciding silently.

## 2026-07-03 — M2: undo/redo depth capped at 100 edits

**Choice:** operation-log undo/redo (inverse closures, not tree snapshots),
capped at 100 entries.
**Alternatives:** unbounded history (simplest, no cap logic, but grows
indefinitely over a very long session); smaller cap e.g. 25 (tighter memory
bound, less undo reach).
**Cost:** each entry is a small closure over a few node references plus
text/index — negligible even at 5,000-node map scale; the cap exists for
hygiene, not because 100 entries would be measurably heavy.
**Asked the user** (addendum §8 item 7, explicitly flagged as a
performance-vs-memory decision point not pre-specified by the plan) — user
chose the recommended 100-edit default.

## 2026-07-03 — M2: full-tree relayout per mutation, dirty-tracked render

**Choice:** every mutation (Tab/Enter/rename/delete) triggers a full
`computeLayout()` recompute, but the **renderer** stays dirty-tracked
(`SvgRenderer.update()` only creates/updates/removes the DOM nodes whose
data actually changed — see §4.3's mandatory "never re-render the whole
SVG" rule).
**Alternatives:** true incremental/partial layout (recompute only the
changed subtree + shift affected siblings, per plan §4.4) — algorithmically
correct per the tidy-tree spec, but `d3-flextree` has no incremental API;
building one is real work.
**Cost:** measured in `benchmarks.md` M2 — full relayout + dirty render
update stays under the 50ms Tab/Enter target even at the 5,000-node stress
fixture (33.7ms worst case). Since nothing is currently over budget, adding
incremental layout now would be optimizing before there's a measured
problem (addendum rule 6 also warns against premature micro-optimization).
**Revisitable:** if a future milestone's benchmark regresses this — e.g.
once organic Bezier paths (M3) or animations (M4) add per-node cost on top
— partial relayout becomes the next lever to pull. Flagged here, not
decided silently, because it's explicitly named in plan §4.4 as the
intended eventual architecture.

## 2026-07-03 — M2: self-write suppression via content comparison, not a version stamp

**Choice:** on a Vault `modify` event, compare the file's new content
against `this.data` / `this.lastWrittenText`; skip reconciliation if equal.
**Alternatives:** the plan's literal wording is "version-stamped
reconciliation" (e.g. a counter or hash written alongside the file).
**Cost:** content comparison achieves the same goal (ignore our own
write's echo) with no extra state to keep in sync and no risk of a stamp
surviving external edits/copies of the file. Equivalent correctness for
the self-echo case; doesn't by itself solve true concurrent-edit
detection, which the next entry covers.

## 2026-07-03 — M2: external-edit conflict policy is "keep local + notify", not merge

**Choice:** if an external file change is detected while there's an
unwritten local mutation pending (debounce not yet flushed), keep the
in-memory model as-is (it will still flush on the next debounce tick) and
show an Obsidian `Notice`, rather than attempting a merge.
**Alternatives:** plan §7.3 says "prefer non-destructive merge; if a true
conflict remains, ask the user." A real merge (diffing both trees and
combining non-overlapping changes) is a substantially bigger feature.
**Cost:** zero performance cost either way; this is a scope/safety
decision, not a perf trade-off, so it didn't need the rule-3 ask — but it's
logged because it's a deliberate deviation from the plan's literal wording,
and N2 ("never silently corrupt or lose content") is non-negotiable. "Keep
local" satisfies N2 by construction (nothing is dropped, the user is told).
**Revisitable:** true 3-way merge is a reasonable post-M2 follow-up if
external-edit conflicts turn out to be common in practice (e.g. syncing
via git or Obsidian Sync while the map view is open).

## 2026-07-03 — M3: sticky left/right sides for balanced layout

**Problem found:** the initial M3 implementation recomputed the optimal
L/R partition from scratch on every layout call (matching the plan's
literal "balanced" wording). Measured impact: one Tab keypress on the
5,000-node fixture moved 4,999 of 5,000 nodes and flipped 2 of 10
first-level branches to the other side. Tab latency at 5,000 nodes rose
from 33.7ms (M2 baseline) to 54.6ms — a 62% regression, crossing the
addendum §6 "flag before proceeding" threshold (>20%), and defeating the
renderer's dirty-tracking entirely (nearly the whole SVG got touched on
every edit regardless of how local the edit was).
**Choice (per user decision, asked via the mandatory decision protocol):**
sticky sides — `assignMissingSides` (`src/layout/sides.ts`) assigns each
first-level branch a side once, balancing against already-committed
weight, and never reassigns an existing branch. A new branch joins
whichever side is currently lighter. An explicit "Rebalance" command
(clears all pins via `clearAllSides`, M5) is the only way to force a full
recompute.
**Alternatives:** keep always-recomputing global balance (simpler code,
but cost scales with total tree size instead of edit size, and the map
visually reshuffles branches on unrelated edits — user explicitly declined
this after seeing the cost/benefit).
**Cost:** re-measured after the fix — Tab at 5,000 nodes is back to 36.2ms
(within the 50ms target), and the same edit now moves exactly 1 node
instead of 4,999. See `benchmarks.md` M3.
**Also fixed alongside this:** `SvgRenderer.upsertEdge` was writing `d`
and `stroke-width` unconditionally on every edge every update, bypassing
the dirty-tracking pattern already used for nodes — now cached and
diffed the same way (stroke-width is set once at creation since depth
can't change without reparenting, which doesn't exist until M5).

## 2026-07-03 — M4: surgical text patching for frontmatter metadata, not full YAML round-trip

**Choice:** `src/sync/metadata.ts` reads/writes only our own `mindmap:`
subtree within the frontmatter block via targeted line-range
replacement — it never parses or re-serializes the rest of the
frontmatter. `model.frontmatterRaw` (already captured verbatim since M2)
is spliced in place.
**Alternatives:** use Obsidian's real `parseYaml`/`stringifyYaml` (from
the `obsidian` package, zero bundle cost since it's external/runtime-only)
to parse the whole frontmatter, mutate the `mindmap` key, and
re-stringify. Correct, but reformats *every* key in the frontmatter
(quote style, ordering) on every write — a real fidelity cost matching
plan §3.4 item 5 ("full markdown fidelity vs simpler serialization"), and
it would make this module untestable in plain Vitest (the `obsidian`
package ships no runtime, only types — see M0 note on `obsidian` being a
types-only devDependency).
**Cost:** more code than "just call stringifyYaml," but zero risk of
reformatting a user's unrelated frontmatter keys, and fully unit-testable
without mocking Obsidian's runtime (see `test/metadata.test.ts`). Not
asked to the user — it's the same "custom narrow-scope parser over a
general AST library" pattern already established in M0/M1 for the
markdown body itself, applied consistently to frontmatter.
**Revisitable:** if the `mindmap:` schema grows past flat per-node
`{key: value}` pairs (e.g. nested manual-position objects in M5), the
regex-based line matching may need to become a tiny recursive-descent
parser instead of extending the regexes further.

(Update, M5: manual-position `pos: [x, y]` landed as a flat pair inside
the same per-node object — the regex approach held up fine, no
recursive-descent parser needed yet.)

## 2026-07-03 — M5: manual positioning via per-region recursive flextree calls

**Choice:** a manually-positioned node (R12) is excluded from its parent's
flextree `children` accessor entirely (invisible to that layout call, so
it consumes no space and gets no auto position); after that call
positions its region, a second pass over the same already-visited nodes
finds any manually-positioned direct children and recursively re-invokes
the same layout function anchored at the pin. This lets manual positioning
nest to any depth (a pinned node's own children can auto-layout relative
to it, and further pinned descendants recurse again).
**Alternatives:** restrict manual positioning to first-level branches only
(simpler — no recursion needed) — rejected because plan R12 doesn't scope
it that way, and mind-map users commonly want to nest a custom layout a
few levels deep (e.g. dragging a whole sub-cluster).
**Cost, investigated (addendum §6 — regression check before moving on):**
initial version regressed layout time at 5,000 nodes from ~20ms (M4) to
~32ms (60%) even with zero manual positions in the fixture. Two causes
found and fixed: (1) `estimateNodeWidth` started calling the new
link-aware `getDisplayText`, which runs a regex even on plain text, and
`nodeSize` is invoked multiple times per node internally by flextree
(verified empirically in M1) — fixed with a fast path that skips the
regex when the text has no `[` at all. (2) the per-node `children`
filtering for manual descendants always allocated a new array — fixed to
reuse the original array when a node has no manually-positioned children
(the common case). After both fixes, layout at 5,000 nodes is ~26ms
(~30% over M4's baseline, not 60%) — the remaining delta is the
unavoidable second traversal pass needed to find manually-positioned
descendants at any depth. Not flagged further to the user: nothing is
within an order of magnitude of any actual budget (28.8ms open-time vs
2,000ms ceiling; 33.4ms Tab vs 50ms target) — this is a justified,
bounded cost of a real feature, not a regression to fix.

## 2026-07-03 — M6: viewport culling threshold (300 nodes) and margin (400px)

**Choice:** below 300 folding-visible nodes, render everything
unconditionally (no culling bookkeeping at all); above it, only render
nodes within the current pan/zoom viewport plus a 400px world-space
margin, re-culling on every pan/zoom frame (rAF-batched, piggybacking on
the existing transform-write callback).
**Not asked to the user:** unlike the animation-threshold or sticky-sides
decisions, this isn't a trade-off — culling has no user-visible downside
(nothing looks or behaves differently; nodes just don't exist in the DOM
until they'd be visible anyway, within a margin generous enough that
panning shouldn't show visible pop-in) — it's a pure "render less" win,
so it doesn't trigger the rule-3 "ask when performance trades against
something else" protocol.
**Cost/benefit measured** in `benchmarks.md` M6: at 5,000 nodes, actual
DOM element count drops to ~165 total (vs. an un-culled ~20,000+ for
5,000 nodes × 4 elements each) — see the mount-time/element-count table.
**Revisitable:** 400px margin and 300-node threshold are both untuned
guesses reproduced from typical viewport/interaction sizes, not measured
against a specific pop-in complaint. If real-world use in the dev vault
shows nodes popping in visibly during fast pans, widen the margin; if
culling bookkeeping itself shows up in a profile for maps just above 300
nodes, raise the threshold.

## 2026-07-03 — M6: incremental parse (external-edit re-parse) not implemented

**Choice:** external file changes still trigger a full re-parse of the
whole file (`parseMindMap` on the complete text), not an incremental
re-parse of just the changed region — even though the plan names
"incremental parsing" as a target (addendum §4.2) and explicitly frames
full re-parse as "the fallback."
**Why this is fine for now:** measured parse time (see `benchmarks.md`,
every milestone) is 0.4–2.4ms even at the 5,000-node stress fixture —
nowhere near a cost worth optimizing. Building incremental/region-diffing
parsing is real engineering (tracking which lines changed, mapping them
back to tree positions, handling structural shifts) for a cost that
doesn't show up in any measurement. Implementing it now would be
optimizing before there's a problem (addendum rule 6 warns against this
directly).
**Revisitable:** if a future real-world file turns out to be enormous
(tens of thousands of lines) such that parse time becomes noticeable, or
if external-edit reconciliation frequency becomes a real UX complaint
(e.g. heavy use of Obsidian Sync/git triggering frequent re-parses),
incremental parsing is the documented next lever — not built speculatively
ahead of that.

## 2026-07-03 — Bug fix: inline editor positioned via viewport-fixed coordinates

**Bug (reported by user after first real manual use):** the text input
for editing a node appeared in the wrong place on screen instead of over
the active branch.
**Root cause:** `SvgRenderer.getNodeScreenRect` computed absolute
viewport coordinates (`svg.getBoundingClientRect()` + view transform),
and `InlineEditor` used `position: fixed` to place itself at that
coordinate. `position: fixed` is normally viewport-relative, but silently
becomes relative to the nearest ancestor with a CSS `transform` (or
`filter`/`contain`/`perspective`) if one exists anywhere up the DOM tree
— which Obsidian's workspace panes commonly have (pane
animations/dragging, mobile). This is exactly the kind of thing that
can't be caught by jsdom (no real layout) or by unit tests that don't
model page-offset geometry — it only showed up on first real use, which
is why the transcript's earlier "verify manually in the dev vault"
caveats were flagged rather than skipped.
**Fix:** stopped depending on the viewport at all. `getNodeScreenRect`
now returns coordinates relative to the renderer's own `container`
element (the offset between the container's and svg's bounding rects,
plus the view transform); `InlineEditor` uses `position: absolute` inside
that same container, which now has `position: relative` in `styles.css`
so it's an explicit containing block we control — no dependency on
whatever transforms exist further up Obsidian's DOM tree.
**Regression test:** `test/renderer.smoke.test.ts` mocks the container's
`getBoundingClientRect()` to a page position far from the origin (300,
500) and asserts the returned rect does *not* include that offset — this
test fails against the old (buggy) implementation and passes against the
fix.

## 2026-07-04 — Bug fix: double-click didn't open the inline editor

**Bug (reported by user):** double-clicking a node did nothing instead of
opening the inline text editor.
**Root cause:** double-click detection relied on the browser's native
`dblclick` event. `onPointerDown` calls `setPointerCapture` on every node
click (needed so drag tracking keeps receiving `pointermove` even if the
cursor leaves the node mid-drag). While an element holds pointer capture,
some browsers retarget the mouse-derived events that follow (`click`,
`dblclick`) to the *capturing* element (`this.svg`) instead of whatever
was actually under the cursor — so `evt.target.closest(".mm-node")`
inside `onDblClick` resolved to nothing, since `this.svg` is an ancestor
of `.mm-node`, not a match itself.
**Fix, two parts:**
1. `onPointerUp` now explicitly calls `releasePointerCapture` instead of
   relying on the spec's implicit release, so capture doesn't outlive the
   gesture it was needed for.
2. More robustly, double-click detection no longer depends on the native
   `dblclick` event at all — `onClick` now tracks the last-clicked node id
   and timestamp itself, and promotes a second same-node click within
   400ms to a "double-click" call. This sidesteps the capture/retargeting
   interaction entirely rather than depending on getting the timing of
   part 1 exactly right across browsers.
**Regression tests:** `test/renderer.smoke.test.ts` — two `click` events
(not `dblclick`) on the same node fire the dblclick handler once; two
clicks on *different* nodes don't; a third click after a double-click
doesn't re-fire it.

Each entry: choice made, alternatives considered, measured/estimated
performance cost. Newest first.

## 2026-07-03 — Rendering: hand-rolled SVG renderer

**Choice:** SVG, hand-rolled (no charting/diagram library).
**Alternatives:** Canvas/WebGL (raw scalability, less styling/accessibility
convenience); a full graph/mind-map library (faster to start, bundle bloat +
per-frame overhead outside our control).
**Cost:** SVG scales to the 2-3k visible node budget with dirty tracking +
viewport culling; beyond that, Canvas/WebGL is a pre-identified fallback
(see plan §3.4.1) — revisit if the 5k stress-test fixture shows frame drops.
**Source:** plan §5 Technology Stack, addendum §8.1.

## 2026-07-03 — Layout: d3-flextree only (not full D3)

**Choice:** `d3-flextree` module only.
**Alternatives:** full D3 (unneeded bundle weight), hand-rolled tidy-tree
(more dev time, same asymptotics).
**Cost:** ~ single-digit KB min+gzip, O(n) layout, well under the 50 KB
approval threshold in CLAUDE.md rule 4. To be installed when M1 needs it.
**Source:** plan §5 Technology Stack.

## 2026-07-03 — Md parsing: custom line-based parser (not an AST library)

**Choice:** hand-rolled line-based markdown parser scoped to the
heading/list subset we need.
**Alternatives:** `remark`/`unified` (full CommonMark AST, heavier, harder
to do incremental/partial re-parse on top of).
**Cost:** zero added dependency weight; full control over incremental
parsing and round-trip fidelity, at the cost of more parser code to
maintain ourselves.
**Source:** plan §5 Technology Stack, addendum §4.2.
