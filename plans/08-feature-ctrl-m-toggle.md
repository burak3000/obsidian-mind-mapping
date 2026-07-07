# 08 — Feature: Ctrl+M toggles mind-map mode

**Source note:** "CTRL+M ile mind map modunu aç" (open mind-map mode with
Ctrl+M)

**Status:** done

## Goal

One hotkey (default `Ctrl/Cmd+M`) that **toggles** the active file between
the markdown editor and the mind-map view — a mode switch, not a new tab.

## Current state

[main.ts:15-24](../src/main.ts) has an `open-as-mindmap` command with **no
default hotkey**, and it opens a **new tab** (`getLeaf("tab")`) — so repeated
use piles up duplicate views, and there is no way back to markdown by key.

## Design

New command `toggle-mindmap-view` (keep `open-as-mindmap` for the file menu):

- Active view is a **MarkdownView** on a `.md` file → switch *the same leaf*
  via `leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file } })`.
- Active view is a **MindMapView** → flush the debounced write first
  (`writeNow()` — otherwise the editor may open stale content), then
  `leaf.setViewState({ type: "markdown", state: { file } })`.
- Anything else → command unavailable (checkCallback false).

Default hotkey: `Mod+M` via the command's `hotkeys` field. Note in README:
Obsidian lets users remap it; on macOS `Cmd+M` is the OS window-minimize
shortcut — Obsidian intercepts in-app hotkeys first, but users can remap if
they prefer minimize. (Community-plugin guidelines discourage *common* editor
hotkeys; `Mod+M` has no core Obsidian binding, so a default is acceptable.)

Same-leaf switching preserves tab position and history (Obsidian records the
view-state change in navigation history, so back/forward also works).

## Implementation steps

1. Add `MindMapView.flushPendingWrite()` public wrapper around the existing
   debounced-write path.
2. Add the toggle command in `main.ts` (~25 lines).
3. Optionally change `openAsMindMap` (file-menu action) to reuse the current
   leaf when the file is already active — keep as is otherwise.

## Tests

- Command availability logic is trivial; behavior is workspace-API-driven —
  verify manually in the dev vault (markdown→map→markdown round trip keeps
  the same tab; unsaved map edit appears in markdown after toggle).

## Performance

Opening a map already meets the open-time budget; toggling adds only a
`writeNow()` flush (already < 50 ms budget). No dependencies.

## Open questions

None — smallest item; good candidate to do first among the features.

## Implementation notes

Implemented as planned: `MindMapView.flushPendingWrite()`
([MindMapView.ts](../src/view/MindMapView.ts)) cancels the debounce timer
and flushes only if there's actually unwritten data; `main.ts` adds the
`toggle-mindmap-view` command (default `Mod+M`) switching the active leaf
between `MarkdownView` and `MindMapView` in place, keeping the existing
`open-as-mindmap` (new-tab, file-menu) command as-is. No automated tests —
this is workspace-API-driven and `main.ts` imports the real `obsidian`
package (types-only outside the Electron host), so it isn't unit-testable
here, same as noted for the arrow-key/inline-editor items. Decision
writeup in [DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test`
(211/211) and `npm run build` both pass. Manual verification in the dev
vault still pending — see workflow step 5: open a `.md` file, press
Ctrl/Cmd+M (should switch to mind map in the same tab), edit a node, press
Ctrl/Cmd+M again (should switch back to markdown in the same tab, showing
the edit — not stale content), confirm back/forward navigation still
works.
