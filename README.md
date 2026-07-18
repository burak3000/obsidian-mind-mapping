# Mind Map View

An XMind-like mind mapping view for [Obsidian](https://obsidian.md) that operates directly on your `.md` files — the markdown outline *is* the mind map, in both directions. No proprietary file format: the map is always a normal, readable markdown note underneath.

## Features

- **True bidirectional sync** — edit the map, the markdown updates; edit the markdown (in Obsidian's normal editor, or any other tool), the map updates.
- **Keyboard-first editing**, matching XMind conventions: `Tab` for a child, `Enter` for a sibling, `F2` to rename, arrow keys to navigate.
- **Organic, tapered, colored branches** — each first-level branch gets its own color, inherited by its descendants; branch width tapers with depth.
- **Balanced auto-layout** — first-level branches are distributed left/right of the root to balance the map, XMind-style.
- **Folding** with a child-count badge, persisted across sessions.
- **Links** — wikilinks, URLs, and file paths are clickable directly on the map; `Ctrl/Cmd+Shift+L` opens a link editor.
- **Manual positioning** — `Alt`+drag any node to a custom position; a "Rebalance" command resets everything back to auto-layout.
- **Undo/redo**, viewport culling and dirty-tracked rendering for large maps, and content-preserving serialization (anything the plugin doesn't understand — paragraphs, code blocks, unrelated frontmatter — round-trips untouched).

## Usage

Open any markdown note as a mind map via the command palette (**Open as mind map**) or the file context menu. The note's heading/list structure becomes the map:

```markdown
# Central Topic
## Main Subtopic A
- child item
  - grandchild
## Main Subtopic B
- another child [[Some Note]]
```

- `H1` (or the note's title, if there's no `H1`) is the root.
- `H2` (configurable) becomes first-level branches.
- Nested lists continue the hierarchy below that.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | New child of the selected node |
| `Enter` | New sibling after the selected node |
| `Shift+Enter` | New sibling before the selected node |
| `F2` / double-click | Edit node text |
| `Esc` | Cancel editing |
| `Delete` / `Backspace` | Delete the selected node (+ its subtree) |
| Arrow keys | Navigate to the nearest node in that direction |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Ctrl/Cmd+/` or `Ctrl/Cmd+Shift+C` | Fold / unfold the selected branch |
| `Ctrl/Cmd+Shift+L` | Add / edit a link (or a same-document relation) on the selected node |
| `Ctrl/Cmd+=` / `Ctrl/Cmd+-` / mouse wheel | Zoom |
| `Ctrl/Cmd+Home` | Center on the root |
| Drag a node | Reorder it under the node you drop it on |
| `Alt`+drag a node | Pin it to a custom position |

Metadata that doesn't fit plain markdown (fold state, manual positions) is stored in a small `mindmap:` block in the note's YAML frontmatter, keyed by block references — it's added only to nodes that actually need it, and any other frontmatter you already have is left untouched.

## Settings

- **Layout mode** — balanced (default), right-only, or left-only.
- **Heading depth** — how many levels of the hierarchy are written as markdown headings before switching to list items.
- **Write-back delay** — how long to wait after an edit before saving to disk.
- **Animation cutoff** — the node-count threshold above which fold/unfold animations turn off (large maps stay instant instead of janky).

## Performance

Performance is treated as a hard requirement, not an afterthought — see [CLAUDE.md](CLAUDE.md) for the budgets and [benchmarks.md](benchmarks.md) for measured numbers per milestone. In short: opening, editing, and folding stay well under budget up to 2,000 nodes, and a 5,000-node stress-test map never freezes (viewport culling keeps the actual DOM footprint proportional to what's on screen, not to the size of the map).

## Development

```bash
npm install
npm run dev      # esbuild watch build -> dev-vault/.obsidian/plugins/mindmap-view/
npm run build    # production build (type-checked, minified) -> dist/
npm run fixtures # (re)generate benchmark fixtures
npm test         # unit tests (Vitest)
npm run bench:m1 # parse+layout benchmark
npm run bench:m2 # mutate+relayout+render benchmark
```

Open `dev-vault/` as an Obsidian vault to test the plugin manually — it's a real vault with the plugin pre-enabled. See [obsidian-mindmap-plugin-plan.md](obsidian-mindmap-plugin-plan.md) for the full implementation plan and [DECISIONS.md](DECISIONS.md) for architectural decision records.

## Known limitations

- Mobile has not been tested on an actual device (no automated way to do so in this environment) — see DECISIONS.md. `isDesktopOnly` is currently `false`, but treat mobile support as unverified until someone confirms it on a phone/tablet.
- External-edit conflict handling is "keep local changes, notify" rather than a true three-way merge (see DECISIONS.md).
- No settings UI yet for the color palette itself, or for per-node color overrides (planned as a post-v1 styling feature per the original plan).
