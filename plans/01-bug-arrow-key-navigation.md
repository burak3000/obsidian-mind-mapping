# 01 — Bug: arrow keys do not function properly always

**Source note:** "arrow keys does not function properly always"
**Status:** done

## Root cause analysis

Arrow handling lives in `MindMapView.navigate()` ([MindMapView.ts:324](../src/view/MindMapView.ts)),
which delegates to `findNearestInDirection()` ([navigation.ts:10](../src/render/navigation.ts)).
Two independent causes:

1. **Purely geometric navigation.** `findNearestInDirection` scans *all* visible
   nodes and picks the one with the best `primary + 2 * secondary` distance
   score. Failure modes:
   - **Up/Down jumps into a different branch** — a cousin or an unrelated
     node in another subtree can score better than the actual next/previous
     sibling, especially with multi-line (tall) nodes or manual positions.
   - **Left/Right skips levels** — the geometrically nearest node in that
     direction may be a grandchild or a node from a neighboring branch, not
     the parent/child the user expects.
   - **Crossing the root between sides** behaves unpredictably because
     left-side and right-side nodes compete in the same scan.

2. **Keyboard focus loss.** The keydown listener is on `contentEl`
   ([MindMapView.ts:98](../src/view/MindMapView.ts)); when focus is elsewhere
   (view header actions, another pane, after interacting with panels) arrows
   do nothing or scroll. There's also no visual feedback when nothing is
   selected: `navigate()` silently starts from the root, so the *first* arrow
   press seems to "do nothing" (it selects a neighbor of the root the user
   never saw selected).

## Approach: structural navigation first, geometric fallback

Mind maps are trees; arrows should follow tree relationships (XMind behavior):

- **Toward the root** (Left on a right-side node, Right on a left-side node)
  → select the parent.
- **Away from the root** (Right on a right-side node, Left on a left-side
  node) → select the vertically-nearest *visible child* (respect `folded`).
- **On the root**: Left/Right → geometrically nearest first-level child on
  that side only.
- **Up/Down** → previous/next *sibling* (same parent). If none, fall back to
  `findNearestInDirection` restricted to the **same side** of the map, so
  up/down can still walk across branch boundaries but never teleports across
  the root.
- If no selection exists, the first arrow press selects the root (visible
  feedback) and stops there.

Keep `findNearestInDirection` as the fallback for manual-positioned nodes and
cross-branch up/down.

## Implementation steps

1. Add `navigateFrom(node, direction, visibleNodes)` in
   [navigation.ts](../src/render/navigation.ts) implementing the structural
   rules above (node side comes from `node.layout.side`).
2. Add a side filter option to `findNearestInDirection` (or pre-filter the
   `visible` list at the call site).
3. Rewire `MindMapView.navigate()` to the new function; select root when
   `selectedId` is null instead of navigating from it invisibly.
4. Focus hardening: after any panel/modal closes and after `onChange`, ensure
   `contentEl` keeps focus (already done for editor commit and search close;
   audit the remaining paths, e.g. LinkModal save).

## Tests

Extend [test/navigation.test.ts](../test/navigation.test.ts):
- parent/child moves on both sides, folded children skipped
- sibling up/down within a branch; fallback across branches stays on-side
- root Left/Right lands on the correct side
- no-selection → first arrow selects root

## Performance

O(siblings) for the common case, O(visible) only in the fallback — strictly
cheaper than today's always-O(visible) scan. No layout or render impact.

## Open questions

None — no performance-vs-feature trade-off; pure behavior fix.

## Implementation notes

Implemented as planned: `navigateFrom` in
[navigation.ts](../src/render/navigation.ts), rewired in
`MindMapView.navigate()`, no-selection now selects root instead of
navigating from it invisibly, and `LinkModal` gained an `onClose` callback
so dismissing it (not just saving) restores focus to `contentEl`. Tests
added to [test/navigation.test.ts](../test/navigation.test.ts). Full
decision writeup in [DECISIONS.md](../DECISIONS.md) (2026-07-06 entry).
`npm test` (205/205) and `npm run build` both pass. Manual verification in
the dev vault still pending — see workflow step 5.
