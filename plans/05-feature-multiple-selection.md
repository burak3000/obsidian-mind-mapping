# 05 — Feature: multiple selection (bulk copy / cut / paste)

**Source note:** "add multiple selection — to support bulk copy/cut and paste"

**Status:** done

## Goal

Select several nodes at once (Ctrl/Cmd+click to toggle, Shift+click for a
sibling range), then copy/cut/paste/delete them as one operation with one
undo step.

## Design

### Selection model (Controller)

`selectedId: string | null` becomes the *primary* selection plus a set:

```ts
selectedIds: Set<string>;      // all selected
selectedId:  string | null;    // primary/anchor (keyboard nav, editor target)
```

- Plain click / arrow nav → collapses to a single selection (today's
  behavior unchanged).
- Ctrl/Cmd+click → toggle membership; primary follows the last toggled-on.
- Shift+click → range among *siblings of the anchor* (contiguous slice of
  `parent.children`); cross-branch shift-select is out of scope.
- Esc → collapse to primary.
- Normalization rule: if a selected node's ancestor is also selected, the
  descendant is dropped at operation time (operating on the ancestor already
  covers it) — prevents double-clone/double-delete.

### Bulk operations (one undo step each)

- **Copy**: clipboard becomes `MindNode[]` (document-ordered clones of the
  normalized selection). Existing single-node behavior is the length-1 case.
- **Cut**: clone all, then delete all inside a single `stack.execute`
  (do: delete each; undo: restore each from its `RemovedNodeRecord` in
  reverse order).
- **Paste**: insert each clipboard subtree, in order, as children of the
  target; single command wrapping N `insertSubtree` calls.
- **Delete**: same compound pattern as cut without the clipboard write.

Controller emits **one** `emitChange()` per bulk op → one relayout + one
render update, regardless of selection size.

### Renderer

`selectNode(id)` becomes `setSelection(ids, primaryId)`; multi-selected nodes
get the existing selection style, primary gets an accent. Must stay
dirty-tracked: keep the previous selection set, restyle only the symmetric
difference (O(changed), not O(visible)).

### Touch points

- [Controller.ts](../src/controller/Controller.ts): selection state, bulk
  copy/cut/paste/delete, normalization helper.
- [MindMapView.ts](../src/view/MindMapView.ts): pass modifier keys from the
  click handler; keyboard ops route to bulk variants.
- [SvgRenderer.ts](../src/render/SvgRenderer.ts): modifier-aware click
  callback signature; set-based selection styling.
- [mutations.ts](../src/model/mutations.ts): no changes expected —
  `cloneSubtree` / `deleteNode` / `insertSubtree` / `restoreNode` compose.

## Tests

- Controller: toggle/range selection; ancestor-descendant normalization;
  bulk cut→undo restores all at original indices; paste order; single
  `onChange` per bulk op (listener call count).
- Renderer smoke: selection diff restyles only changed nodes.

## Performance

Selection changes are O(Δselection); bulk ops are O(affected subtrees) with
exactly one relayout/render — no change to budgets. No dependencies.

## Open questions

- Rubber-band (drag-rectangle) selection: useful but adds pointer-mode
  complexity next to existing pan/drag/resize gestures — **propose deferring
  to a follow-up**; Ctrl+click and Shift+click cover the bulk-edit use case.
  (Deferred as proposed — not a performance trade-off, so no rule-3 stop
  needed; see DECISIONS.md.)

## Implementation notes

Implemented as planned: `Controller` gained `selectedIds`,
`toggleSelection`, `selectRange`, `collapseSelection`, and a private
`normalizedSelection()`/`bulkDelete()` pair that `deleteSelected`/
`cutSelected`/`copySelected`/`pasteToSelected` now route through (single-
selection is the length-1 case of the same path — no behavior change for
existing callers). `Controller.clipboard` is now `MindNode[] | null`.
`SvgRenderer` gained `setSelection(ids, primaryId)` (symmetric-diff
restyle; `selectNode` is now a thin wrapper around it) and a
`.mm-selected-primary` accent class. `MindMapView`'s click handler routes
Ctrl/Cmd+click and Shift+click to the new Controller methods; Esc calls
`collapseSelection`. Tests added: 10 new cases in
[test/controller.test.ts](../test/controller.test.ts) (toggle, range,
collapse, bulk delete/cut undo, ancestor-descendant normalization,
document-order-independent bulk copy/paste, single-`onChange`-per-bulk-op)
and one in [test/renderer.smoke.test.ts](../test/renderer.smoke.test.ts)
(selection-diff restyles only changed nodes). `bench-m2` shows no
regression (logged in [benchmarks.md](../benchmarks.md)). Full decision
writeup in [DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test`
(232/232) and `npm run build` both pass. Manual verification in the dev
vault still pending — see workflow step 5: Ctrl/Cmd+click to toggle
multiple nodes, Shift+click for a sibling range, bulk copy/cut/paste/
delete, Esc to collapse, and confirm the primary node's accent outline is
visible alongside the regular selection outline on the others.
