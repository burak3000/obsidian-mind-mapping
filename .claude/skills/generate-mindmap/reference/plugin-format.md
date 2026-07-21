# Mind Map View markdown format (exact, derived from plugin source)

The plugin parses a **heading + nested-list subset of markdown** in one
linear pass. Getting these rules exactly right is what makes the output
actually render as a mind map instead of a flat outline — this is the
authoritative reference; when in doubt, match this over intuition.

## Structure

- **The first `# H1` in the file becomes the root node itself** (not a
  child of it). If the file has no H1 at all, the plugin falls back to a
  title you provide — but always emit an explicit `# Title` as the first
  line so the root's label is exactly what you intend.
- **`## H2` through `###### H6`** become nested nodes, one level of
  hierarchy per heading level, relative to whichever heading/list node is
  currently open. A heading at level *N* closes any open heading at level
  ≥ *N* and any open list context, then becomes a child of the nearest
  still-open heading (or the root).
- **Bulleted list items** (`-`, `*`, or `+`, any of the three) continue the
  hierarchy *underneath the nearest enclosing heading*, once you no longer
  want a heading level. Nesting depth is **indentation ÷ 2, rounded down**
  — i.e. exactly **2 spaces per additional level**:
  ```
  ## Branch
  - depth 2 (2 spaces)
    - depth 3 (4 spaces)
      - depth 4 (6 spaces)
  ```
  3-space or 5-space indents are not a new level (integer division), so
  always use multiples of 2.
- **Mix headings and lists freely.** A common, clean shape: `#` root,
  `##` first-level branches, then plain lists for everything deeper
  (headings 3–6 also work, but lists are simpler to indent correctly).
- **Plain paragraph lines** (anything that isn't a heading or a list item)
  attach as extra content *under whichever node they follow*. Use sparingly
  — a mind map node is meant to be a short label, not a paragraph. If the
  source material has substantial prose that belongs with one node, a
  short paragraph directly under that node's line is fine; don't attach
  large blocks this way.

## Links (clickable in the rendered map)

- **Wikilink:** `[[Target]]` or `[[Target|Displayed Label]]`.
- **Markdown link:** `[Displayed Label](target)`.
- A node's text can mix plain words and links freely:
  `"Check [[Some Note]] before ## next steps"`.

`target` resolves to one of three destinations, checked in this order
(`MindMapView.openLink`, `src/view/MindMapView.ts`) — **regardless of
whether the link was written as a wikilink or a markdown link**, so either
syntax works for all three:

1. **A URL** (`isUrlTarget`: an explicit scheme like `https://…`, or a bare
   domain like `example.com`/`www.example.com` — the plugin adds
   `https://` automatically) opens in the system browser.
2. **An absolute filesystem path** (`isAbsoluteFilesystemPath`: `/…`,
   `~/…`, `C:\…`, `D:/…`) opens via the OS itself — a file in its
   registered default app, a folder in the system file browser — through
   Electron's `shell.openPath`, **not** Obsidian's vault-relative
   resolution. This is the mechanism for **linking a node to a real file
   on disk** (a source file, a document, an asset) so clicking it opens
   that actual file: `[Controller.ts](/Users/me/project/src/Controller.ts)`.
   Always use an **absolute** path here (or `~/…`) — a relative path would
   be misread as a vault-relative note reference (case 3 below) instead.
3. **Anything else** is a vault-relative note/attachment reference,
   resolved through Obsidian's own link resolution (`openLinkText`) —
   this is what a bare `[[Some Note]]` normally means.

Same-doc relations (`[[#^id]]`, below) are a distinct fourth case, handled
before this three-way check ever runs.

### Gotcha: real file paths containing `(`, `)`, `[`, or `]`

Both link forms are matched by regex, not a real parser, and **there is no
escape syntax** — wrapping a target in `<...>` (standard Markdown link
syntax elsewhere) is *not* recognized here and just fails to match at all,
leaving the raw `[label](<...>)` text sitting unparsed in the node's
label. Each form has its own blind spot:

- **Markdown link** `[label](target)`: `target` is everything up to the
  **first** `)`. A real path containing a parenthesis — e.g. a Next.js/
  Expo-Router route-group folder like `app/(main)/(customers)/index.tsx`
  — truncates there, silently producing a wrong/broken target.
- **Wikilink** `[[target|label]]`: `target` is everything up to the
  **first** `]`. A path containing a literal `]` — e.g. a dynamic-route
  filename like `[id].tsx` — breaks the same way.

So: prefer **wikilink form for a path with parens but no brackets**
(covers the common route-group case), prefer **markdown-link form for a
path with brackets but no parens** (e.g. Next.js's `[locale]` segment —
fine in a markdown link, since only `)` is forbidden there). **A path with
both** (parens *and* brackets, e.g. `app/(main)/(customers)/[id].tsx`)
cannot be represented as a working link in either form — don't fake one;
mention the path as plain text instead and say why it isn't linked.

When in doubt, verify: parse the exact string you're about to write
through `parseTextSegments` (`src/model/links.ts`) — or, in a pinch, check
that the text doesn't contain both an unescaped `(...)` and `[...]` inside
what's meant to be one target.

## Same-document relations (arrows between two nodes in this file)

To draw an arrow from one node to another **within the same generated
file** (e.g. "this decision depends on that requirement"):

1. Give the **target** node a stable id by suffixing its heading/list line
   with a space and a caret-prefixed id: `## Target node text ^mytarget1`.
   - The id must match `[A-Za-z0-9_-]+` and be **unique in the file**.
   - This suffix is stripped from the displayed text automatically — it's
     metadata, not part of the label.
2. Reference it from the **source** node's text with `[[#^mytarget1]]`.
   - If the source node already has other content, the plugin's own UI
     appends relations as `"existing text → [[#^id]]"` (a plain arrow
     separator, plain text, not link syntax) — match that convention if
     you're adding a relation to a node that already has a label, so a
     later relation added through the plugin's own editor looks
     consistent: `"Ship v2 → [[#^kickoff]]"`.
3. Only use this for a **genuine cross-reference** the source material
   itself implies (e.g. "see also", a dependency, a shared concept
   appearing in two branches) — not as a substitute for normal parent/child
   nesting. Overusing relation arrows defeats the purpose of a hierarchy.

Do **not** use `[[OtherFile#^id]]` (cross-document) syntax when producing
a single combined output file — everything in one file is same-document,
so always use the bare `[[#^id]]` form.

## Image embeds

`![[image.png]]` or `![[image.png|caption]]` (wikilink form), or
`![alt](path/to/image.png)` (markdown form). Only include these if the
source material actually references an image file you have a real path
for — never fabricate an image reference.

## Status badges (optional — use sparingly)

If the source material has an explicit workflow status per item (a task
list with done/blocked markers, a roadmap with stages), you can tag a node
with one of six badges: `done`, `started`, `blocked`, `red-flag`,
`green-flag`, `ready`. This requires **two things together**:

1. The node's line needs a block id, same as a relation target:
   `## Ship the beta ^ship1`.
2. A YAML frontmatter block at the very top of the file, before the `#`
   root heading:
   ```
   ---
   mindmap:
     nodes:
       ^ship1: { badge: done }
   ---
   # Root
   ## Ship the beta ^ship1
   ```
   Multiple nodes each get their own `^id: { badge: ... }` line under
   `nodes:`. Only add this section if you're actually encoding a real
   status from the source content — don't invent statuses.

## Example: putting it together

```
# Q3 Planning

## Hiring
- Backend
  - Senior engineer req approved
  - Panel interviews start next month
- Design
  - One open req, JD in review

## Roadmap ^roadmap1
- Beta launch ^beta1
  - Blocked on payments integration → [[#^payments1]]
- Payments integration ^payments1
  - Vendor contract signed
  - Engineering kickoff
  - Implementation: [PaymentsController.cs](/Users/me/repo/Api/PaymentsController.cs)

## Risks
- Payments timeline slip could delay Roadmap → [[#^roadmap1]]
```

This renders as a root "Q3 Planning" with three first-level branches
(Hiring, Roadmap, Risks), nested detail under each, two visible arrows
(Beta launch → Payments integration, and Risks → Roadmap) — an in-document
association between two nodes in this same file — and one file
association: clicking "PaymentsController.cs" opens that real file on
disk in its default editor, a completely different mechanism from the
arrows even though both are called a "link."
