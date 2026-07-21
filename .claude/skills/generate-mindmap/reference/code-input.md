# Converting source code into a mind map

Code needs a different approach from prose: the goal is a **structural
summary** (what's in this file, and why), not a transcription of the
implementation. A mind map node that contains a full function body has
failed at being a mind map node — see the general best-practices in
[SKILL.md](../SKILL.md); everything there still applies (short labels,
3–7 first-level branches, group by concept, relations for genuine
cross-references) — this is the code-specific layer on top of it.

## The shape to aim for

For a typical source file, structure the branch like this (skip whichever
of these don't apply — a 40-line script doesn't need all of them):

- **Purpose** (as the branch's own label, not a child node) — one phrase
  describing what the file/module is for, read from its own doc comment,
  docstring, or the dominant class/export name. Fall back to the filename
  if intent isn't stated anywhere.
- **Dependencies** — only the notable ones (a key third-party library, a
  significant internal module this file is coupled to). Skip an
  exhaustive import list; it's rarely useful in a mind map.
- **Types / data models** — interfaces, structs, dataclasses, schemas:
  one node per type, its fields as children only if the field list itself
  is meaningful (skip for a type with one obvious field).
- **Classes** — one node per class. Its methods are children; each method
  node is `methodName() — one-line purpose`, not its body. Group related
  methods under an intermediate node if a class has many (e.g. "Validation
  methods", "Lifecycle hooks") rather than flattening 15 methods under one
  parent.
- **Top-level functions** — group by what they do (e.g. "Formatting
  helpers", "API handlers", "Event listeners"), not by declaration order
  in the file.
- **Constants / configuration** — only ones that matter for understanding
  behavior (a feature flag, a magic number worth calling out), not every
  literal in the file.
- **Entry point / main flow** — for a script or a file with a clear
  top-to-bottom execution path: a short *ordered* list of what happens
  when it runs, at the level of "validates input → calls the API →
  renders the result", not every statement.

## Node text vs. attached content

A node's label is the purpose (`parseConfig() — reads and validates
config.json`), never the code itself. If one specific line is genuinely
worth quoting (a critical constant's exact value, a regex whose exact
shape matters), it's fine to put that single line as a short line of
attached content directly under the node — but never a multi-line block;
that's what "one idea per node" means applied to code.

## Language-specific notes

- **HTML**: branch by document region, not by DOM depth — `<head>`
  (title/meta/key stylesheets and scripts), the page's actual visual
  sections (whatever the real landmarks are: header/nav/main/footer, or
  the page's own section headings if it's more of a document), forms and
  their fields, and embedded `<script>` blocks (treated as their own
  code-file branch using the rules above). Don't mirror every nested
  `<div>` — that's DOM structure, not the page's conceptual structure.
- **CSS/SCSS/LESS**: branch by concern (layout, typography, components,
  theme/variables, responsive breakpoints) rather than one node per
  selector.
- **Shell scripts**: branches by phase (setup/validation, main work,
  cleanup/error handling), each with its key commands as short children —
  same "purpose, not implementation" rule.
- **SQL**: branch by object type (tables/schemas, views, stored
  procedures/functions, migrations) — a table's notable columns/keys as
  children only when they matter for understanding the schema's intent.

## Relations across code files

When multiple source files are merged into one map (§4 of SKILL.md) and
one file's function/class genuinely depends on or calls into another's,
that's exactly the case `[[#^id]]` relation arrows are for (see
[plugin-format.md](plugin-format.md)) — a real dependency the reader would
otherwise have to guess at. In Summary mode, don't add one for every
import — only where it clarifies an actual coupling between branches. In
Detailed mode, be more thorough about surfacing real cross-file
dependencies (still never inventing a coupling that isn't actually there).

## File-association links (Detailed mode only)

Every node standing in for one specific source file gets a link back to
the real file — `[filename.ext](/absolute/path/to/filename.ext)` (see
"Links to real files on disk" in [plugin-format.md](plugin-format.md) for
exactly how the plugin opens it). Put it on the file-level node itself
(e.g. as trailing content on that node's line, or as its own short child
line), not repeated on every method/function underneath it — one link per
file is enough to jump straight to it from the map.

**Watch for parens/brackets in the path** — framework routing conventions
love both (Next.js/Expo Router `(group)` folders, `[param]`/`[id]`
dynamic-segment filenames), and this plugin's link syntax has no escape
for either (see the "Gotcha" in plugin-format.md's Links section). Pick
wikilink vs. markdown-link form per path, and leave a path with both kinds
of character unlinked rather than emitting a link that silently breaks.

## Large codebases (many files as input)

**Summary mode**: for a large codebase, don't walk every file at all —
build an *architecture-level* view instead, reading each project/module's
own docs (README, CLAUDE.md, manifest like package.json/*.csproj) and top
folder structure rather than every source file, one branch per
project/module summarized that way. This is what keeps a multi-repo input
from turning into a mind map with thousands of nodes.

**Detailed mode**: the per-file branch structure earlier in this doc still
applies file-by-file, but with many files merged into one map, first-level
branches (§ "Multiple inputs → one merged tree" in SKILL.md) get crowded
fast. If there are more than ~7 files, group them: pick a first-level
branch per logical area/directory (e.g. "API layer", "UI components",
"Utilities") and nest each file as its own branch inside its area (each
still getting its own file-association link), rather than every file
competing for a first-level slot.
