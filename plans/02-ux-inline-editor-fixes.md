# 02 — UX: inline editor — one-letter-per-line typing & click-closes-editor

**Source notes:**
- "entering text can be each letter in a line"
- "click can lost focus — in editing view one click must navigate the cursor to the selected text part"

**Status:** done

Both issues are in the inline-edit path: [InlineEditor.ts](../src/view/InlineEditor.ts)
+ how [MindMapView.ts](../src/view/MindMapView.ts) hosts it.

## Issue A: each typed letter wraps to its own line

### Root cause
The editor `<textarea>` is sized to the node's *current* screen rect
([MindMapView.ts:165-171](../src/view/MindMapView.ts) →
[InlineEditor.ts:42-45](../src/view/InlineEditor.ts)). A freshly created node
has empty text, so its box is `minNodeWidth` (40 px × depth scale — see
[layoutEngine.ts:77](../src/layout/layoutEngine.ts)). The textarea is therefore
~40 px wide; the browser soft-wraps at that width, so nearly every character
lands on a new line. The `input` listener only grows the **height**
([InlineEditor.ts:63-66](../src/view/InlineEditor.ts)), which makes it worse —
the box grows into a one-character-wide column.

### Fix
Grow the editor's **width** with content, up to the node's wrap ceiling:

1. Pass the depth-scaled wrap ceiling to the editor:
   `maxWidth = defaultWrapWidthForDepth(node.depth, layoutConfig) * view.scale`
   (or `manualWidth * scale` when set) — exposed alongside
   `getNodeScreenRect`.
2. Give the editor a sane minimum width (e.g. ~16 characters at the node's
   scaled char width) so even an empty node opens with a usable box.
3. On `input`, measure the content (hidden mirror `<span>`, or
   `wrap="off"` + `scrollWidth` while under the ceiling) and set
   `width = clamp(contentWidth, minWidth, maxWidth)`; only after hitting
   `maxWidth` does wrapping kick in, then grow height as today.
4. Match the editor font to the node: set `font-size` from
   `fontSizeForDepth(depth) * view.scale` instead of the hard-coded 12 px in
   [styles.css:177](../styles.css) — sizes then agree with what's measured.

All of this is DOM-only work on the overlay — the no-relayout-per-keystroke
invariant (addendum §4.5) is untouched.

## Issue B: clicking inside the editor closes it

### Root cause
[MindMapView.ts:99](../src/view/MindMapView.ts):

```ts
this.registerDomEvent(this.contentEl, "mousedown", () => this.contentEl.focus());
```

This fires for **every** mousedown inside the view — including clicks *inside
the editor textarea*. Focus jumps to `contentEl`, the textarea receives
`blur`, and blur commits & removes the editor
([InlineEditor.ts:89](../src/view/InlineEditor.ts)). So a user who clicks to
place the cursor inside the text they're editing gets the editor yanked away
instead.

### Fix
Guard the focus-steal:

```ts
this.registerDomEvent(this.contentEl, "mousedown", (evt) => {
    if ((evt.target as HTMLElement).closest(".mm-inline-editor, .mm-search-panel")) return;
    this.contentEl.focus();
});
```

With the steal gone, the native textarea behavior gives exactly what the note
asks for: the initial open still selects all (`input.select()`,
[InlineEditor.ts:48](../src/view/InlineEditor.ts)), and a single click then
places the caret at the clicked character. Clicking *outside* the editor
still blurs → commits, which is the desired close behavior.

## Implementation steps

1. `MindMapView`: guard the mousedown focus handler (Issue B — 3 lines).
2. `SvgRenderer`: expose the node's wrap-ceiling and font-size in screen px
   (small helper next to `getNodeScreenRect`).
3. `InlineEditor`: accept `minWidth`/`maxWidth`/`fontSize` options; add
   width-growth logic on `input`.
4. `MindMapView.openInlineEditor`: pass the new options.

## Tests

- Extend [test/inlineEditor.test.ts](../test/inlineEditor.test.ts): width grows
  with content and clamps at max; mousedown inside editor does not commit;
  mousedown outside does.
- Manual check in the dev vault (Electron — no automated visual verification
  possible): create node → type a sentence → text stays on one line until the
  wrap ceiling; click mid-word → caret moves there, editor stays open.

## Performance

Per-keystroke work is one measurement + one style write on a single detached
overlay element — well under the 16 ms keystroke budget; model/layout/render
untouched until commit.

## Open questions

None — no performance trade-off.

## Implementation notes

Implemented as planned: `SvgRenderer.getNodeEditMetrics()` exposes the
depth-scaled wrap ceiling/font size, `InlineEditor` grows width to content
via a hidden mirror span (clamped `[minWidth, maxWidth]`, defaulting to the
old fixed `rect.width` when omitted), and `MindMapView`'s mousedown handler
now skips refocusing `contentEl` for clicks inside `.mm-inline-editor` /
`.mm-search-panel`. `LinkModal` also gained an `onClose` restore-focus hook
(shared fix with [01](01-bug-arrow-key-navigation.md), same root cause).
Tests added to [test/inlineEditor.test.ts](../test/inlineEditor.test.ts)
(width growth/clamping, with `scrollWidth` stubbed since jsdom doesn't do
real layout). The mousedown-guard itself lives in `MindMapView.ts`, which
imports the real `obsidian` package (types-only outside the Electron host)
and so isn't unit-testable here — decision writeup in
[DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test` (207/207)
and `npm run build` both pass. Manual verification in the dev vault still
pending — see workflow step 5: create an empty node and type a sentence
(should stay on one line, growing until the wrap ceiling), and click
mid-word while editing (caret should move, editor should stay open).
