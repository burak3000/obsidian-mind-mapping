---
name: generate-mindmap
description: "Convert one or more input files (markdown, plain text, outlines, JSON, XML/OPML, DOCX, PDF, or source code in common languages — JS/TS, Python, Java, C#, C/C++, Go, Rust, Ruby, PHP, Swift, Kotlin, HTML/CSS, shell, SQL) into a single .md mind map file formatted for the 'Mind Map View' Obsidian plugin (heading + nested-list structure, wikilink relations, image embeds). Use when the user asks to turn a document/notes/codebase/data into a mind map, or wants a file 'readable with the mindmap plugin' in Obsidian. Portable — does not depend on this repo; works from any project directory."
trigger: /generate-mindmap
---

# /generate-mindmap

Turns one or more input files into a single markdown mind map that the
"Mind Map View" Obsidian plugin can open directly — a root topic,
first-level branches, and nested detail, with real clickable relations
between nodes where the source content implies them. Has two detail
levels (chosen up front, question 4): a condensed **summary** by default,
or a **detailed** mode that keeps far more of the source's own
granularity and adds file-association links (see below) back to real
source files on disk, not just in-document relation arrows.

This skill produces **markdown only**. It never touches this plugin's own
source code, and it works the same way in any project directory — the exact
output format it targets is documented in
[reference/plugin-format.md](reference/plugin-format.md); read that file
before writing output the first time you use this skill in a session, and
whenever a rendering detail (indentation, relation syntax, badges) matters.

## How this skill takes its parameters

This skill never accepts `--output`/`--output-dir`-style flags. All four
parameters (input, output name, output folder, detail level) are gathered
**up front, in one single AskUserQuestion call** with all four questions
in it — not sequential chat turns, not `ARGUMENTS` parsing. Once that one
call returns, the rest of the run is **fully autonomous**: no further
questions, confirmations, or check-ins of any kind, no matter how
ambiguous something turns out to be (use your best judgment and note any
assumption in the final report instead of asking about it).

## Step 0 — one AskUserQuestion call, four questions

Call AskUserQuestion **once**, before reading any file or invoking
`docx`/`pdf`, with exactly these four questions (`multiSelect: false` on
each; every question implicitly also offers "Other" for free-form text —
that's how a real path/name gets entered, since none of the preset options
below are meant to be the literal answer for the input question):

1. **"Which file(s) or folder should be converted into a mind map?"** —
   options: a plausible concrete guess if the conversation gives you one
   (a file/folder just discussed) labeled clearly as such, and a generic
   `"The current project directory"` fallback; the user answers via
   "Other" with the real path(s)/folder in the overwhelming majority of
   invocations — that's expected, not a failure of the options.
2. **"What should the output file be called?"** — options:
   `"Auto-generate a name from the content (Recommended)"` and `"Name it
   after the input file"`; "Other" lets them give an exact name.
3. **"Which folder should the output be saved in?"** — options: `"Same
   folder as the input (Recommended)"` and `"This project's root
   folder"`; "Other" lets them give an exact folder.
4. **"How much detail should the mind map include?"** — options:
   `"Summary — condensed overview (Recommended)"` and `"Detailed — every
   file/section, with links back to source files"`.

Resolve the answers:

- **Input** — accept one file, several files (comma/space/line-separated
  — use your judgment), or a folder. A folder means every supported file
  found inside it, recursing into subfolders, skipping hidden/dotfiles,
  anything not a supported extension (§1 below lists them — prose, data,
  and source-code formats alike), and noisy directories that aren't the
  user's own content even when they contain matching extensions:
  `node_modules`, `dist`, `build`, `out`, `target`, `vendor`, `.git`,
  `__pycache__`, `.venv`/`venv`, `bin`/`obj`. If nothing resolves to an
  existing file at all, that's a hard stop — report it as an error; don't
  guess a different path. Multiple resolved inputs merge into **one**
  output mind map: each becomes a top-level branch named after its source
  (filename or its own title/H1 if it has one), under a single shared
  root.
- **Output name** — if they picked the Recommended/auto option, generate
  one yourself in step 6 below (prefer the actual central topic you found
  over the resolver script's mechanical fallback) rather than asking
  anything further.
- **Output folder** — if they picked "Same folder as the input", resolve
  it yourself (the first input's directory, or the input folder itself if
  a folder was given) without asking again.
- **Detail level** — governs steps 2, 3, and 5 below; see "Summary vs.
  detailed mode" under Mind-mapping best practices. Default to Summary
  whenever this question wasn't asked for some reason (it always should
  be) — never silently assume Detailed.

## Workflow

1. **Read every resolved input file's content.** Dispatch by extension:
   - `.md` / `.markdown` / `.txt` / no extension: read directly with the
     Read tool.
   - `.json`: read and parse directly — treat object keys and array items
     as node structure (a key with a nested object/array becomes a parent
     node with children; a scalar leaf becomes a leaf node).
   - `.opml` / `.xml`: read directly — OPML `<outline text="...">`
     elements are already an outline; nest them the same way they're
     nested in the file.
   - `.docx`: invoke the `docx` skill first to extract the document's text
     and heading structure, then treat that extracted text like markdown.
   - `.pdf`: invoke the `pdf` skill first to extract text, then treat it
     like plain text/markdown.
   - **Source code** — `.js`/`.jsx`/`.mjs`/`.cjs`/`.ts`/`.tsx`, `.py`,
     `.java`, `.cs`, `.c`/`.h`/`.cpp`/`.hpp`/`.cc`, `.go`, `.rs`, `.rb`,
     `.php`, `.swift`, `.kt`/`.kts`, `.html`/`.htm`, `.css`/`.scss`/`.less`,
     `.sh`/`.bash`, `.sql`, and other mainstream languages by the same
     logic: read directly with the Read tool, then follow
     [reference/code-input.md](reference/code-input.md) — code needs a
     structural summary (classes/functions/purpose), not a line-by-line
     transcription, and that reference has the exact approach (both detail
     levels — the file's own "structural summary vs. keep more" split is
     the same distinction as summary/detailed mode below).
   - Anything else: read it as plain text and use your judgment.

2. **Understand the content** — identify the actual central topic, the
   natural top-level groupings, and genuine cross-references between
   sections (these become in-document relation arrows). In Detailed mode,
   also track which specific input **file** each piece of content came
   from — you'll need real file paths for file-association links in
   step 5.

3. **Restructure into a hierarchy applying mind-mapping best practices**
   (below) — do not just mechanically re-indent the source; a flat list
   of 40 bullet points is not a mind map. Follow the "Summary vs. detailed
   mode" split from question 4 for how much of the source's own
   granularity to keep.

4. **Multiple inputs → one merged tree.** Pick one root label describing
   the combined topic (or the more general theme, if the inputs are
   clearly related) and give each input its own first-level branch.

5. **Emit the exact markdown syntax** the plugin's parser expects — see
   [reference/plugin-format.md](reference/plugin-format.md) for the full,
   authoritative spec (heading/list nesting rules, link/relation/badge
   syntax, a worked example). Getting the 2-spaces-per-level list
   indentation and the `[[#^id]]` relation syntax exactly right is what
   makes this actually render as a mind map. **In Detailed mode**, also add
   file-association links — `[label](/absolute/path/to/the/real/file)` —
   on the node(s) representing each source file, so clicking a node opens
   that actual file (see plugin-format.md's "Links" section for exactly
   how the plugin routes an absolute path vs. a URL vs. a vault note).
   Always the file's real, absolute path — never a relative or invented
   one.

6. **Resolve the output path** using the answers from Step 0 by running
   the bundled cross-platform resolver script (Node's `path`/`fs` APIs
   behave identically on Windows/macOS/Linux, unlike shell `mkdir`/`cp`,
   which is why this is a script rather than inline shell commands):
   ```
   node "<skill-dir>/scripts/resolve-output.mjs" <resolved-input-file...> [--output <name>] [--output-dir <folder>]
   ```
   Pass `--output` with your own content-derived name whenever question 2
   was the Recommended/auto option (don't let the script's mechanical
   fallback decide when you can name it better yourself); pass it with
   the user's exact answer if they gave one via "Other". Same idea for
   `--output-dir` and question 3. The script prints the final absolute
   path on stdout, creates the output directory if needed, and refuses to
   run if an input file doesn't exist. If question 1 resolved to a folder,
   pass the folder itself here (not each file inside it) — it's only used
   to anchor the default output location/name, which content extraction
   (step 1) already read the individual files for separately.

7. **Write the file** at that path with the Write tool (never via shell
   redirection — the Write tool is what keeps this step OS-independent).

8. **Report back**: the output path, and a one-paragraph summary of the
   shape you produced (root + first-level branches, and how many relations
   you added, if any).

## Mind-mapping best practices

### Summary vs. detailed mode (question 4)

**Summary** (default) — everything below applies as written: 3–7
first-level branches, 3–5 levels deep, group by concept, relation arrows
only for standout cross-references. For a large input (many files, a
whole codebase), this usually means an *architecture-level* view: one
branch per file/module/project, each summarized from its own
docs/manifest/structure rather than exhaustively cataloging every
function — see "Large codebases" in
[reference/code-input.md](reference/code-input.md).

**Detailed** — the branch-count and depth guidelines below are relaxed on
purpose; the point of this mode is to keep far more of the source's own
granularity (every file, every function/class, every section) rather than
condensing for brevity. Two things change concretely:
- **File-association links.** Every node representing a distinct source
  file gets a real link back to it (step 5) — `[name](/absolute/path)` —
  so the mind map becomes a navigable entry point into the actual files,
  not just a description of them.
- **More liberal in-document relations.** Add `[[#^id]]` arrows for real
  associations more thoroughly than Summary mode's "only the standout
  ones" — cross-file dependencies, repeated concepts across sections,
  anything the source material itself actually connects — while still
  never inventing a connection that isn't really there.

Still apply *some* structure even in Detailed mode — one branch per
file/section with its own nested breakdown, not a single 200-item flat
list — "more detail" means less compression, not no organization at all.

- **One idea per node.** A node's label is a short phrase, not a sentence
  — if the source has a longer explanation that belongs with one node, put
  it as a short paragraph directly under that node's line rather than
  cramming it into the label.
- **3–7 first-level branches.** Fewer than 3 usually means the grouping is
  too coarse; more than 7 usually means two branches should merge or a
  branch should split into its own map.
- **Group by concept, not by source order.** Don't mirror a flat document's
  paragraph order 1:1 — cluster related ideas under a shared parent even
  if they were far apart in the source.
- **Depth: aim for 3–5 levels.** If content seems to need much deeper
  nesting, look for a way to split it into siblings instead, or use a
  relation arrow to point at a fuller treatment elsewhere in the map
  rather than nesting ten levels deep.
- **Parallel phrasing among siblings** (all start with a verb, or all are
  noun phrases, consistently) — reads faster than mixed styles.
- **Use relation arrows for genuine cross-references** (a dependency, a
  "see also", a concept that legitimately belongs under two branches) —
  not as a substitute for putting the idea in the right branch in the
  first place. A mind map with no relations at all is completely normal
  and often correct; don't force them in.
- **Don't invent structure that isn't in the source.** If the input is
  genuinely flat (a simple list with no natural grouping), it's fine for
  the output to be flat too — one root with direct children.
