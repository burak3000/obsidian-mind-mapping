# 07 — Feature: image display in nodes ("image gösterme")

**Source note:** "image gösterme" (showing images)

**Status:** done — decision resolved: **A** (small fixed ~120px thumb,
click opens the image in a new tab).

## Goal

Nodes whose text contains an image embed — `![[photo.png]]` or
`![alt](path/to.png)` — render the image inside/under the node box instead of
(or alongside) the raw markup.

## Design

### Detection & resolution

1. Extend [links.ts](../src/model/links.ts) with embed parsing:
   `![[target]]` and `![alt](target)` (leading `!` distinguishes embeds from
   the already-supported links).
2. Resolve to a displayable URL via
   `app.metadataCache.getFirstLinkpathDest(target, sourcePath)` →
   `app.vault.getResourcePath(file)` (native Obsidian attachment resolution;
   remote `https://` URLs used as-is).

### Rendering (SVG)

- An `<image>` element inside the node group, below the text lines.
- **Fixed thumbnail box** (e.g. max 120×90 px at depth scale, preserving
  aspect ratio) — the node's layout box grows by the thumb height via
  `computeNodeBox` (an image counts as N extra "lines" of known height).
  Fixed-size thumbs mean **layout never depends on image load** — no reflow
  when a load completes, no async layout invalidation.
- Placeholder rect until loaded; broken links show a small "missing" glyph.

### Performance strategy (the real design constraint)

Budgets: 2 000-node map < 1 s open, 60 fps pan/zoom, < 150 MB.

- **Lazy load via existing culling**: only nodes in/near the viewport get a
  `href` set on their `<image>`; off-screen images stay placeholders.
  Scrolling triggers loads incrementally (browser cache makes revisits free).
- **Never decode at full size**: `getResourcePath` returns the original
  file — a vault of 5 MB photos would blow memory if decoded eagerly. The
  fixed CSS/SVG display size keeps GPU texture cost bounded, but decode cost
  is per-image; lazy loading caps concurrent decodes.
- Fold/cull already removes off-screen nodes — image elements ride along.
- Idle CPU stays ~0: no polling; loads are event-driven.

## Implementation steps

1. Embed parsing + URL resolution helper (pure, testable).
2. `computeNodeBox`: account for an embed's thumb box in w/h.
3. Renderer: placeholder + lazy `href` assignment keyed off the culling
   pass; load/error handlers.
4. Editing behavior: inline editor keeps showing the raw markup text
   (image is a render-time affordance only) — no change needed.
5. Benchmark: fixture with ~200 image nodes; measure open time & pan fps,
   record in benchmarks.md.

## Tests

- Embed-parse unit tests (wiki/md forms, alt text, non-image targets).
- Node-box sizing with embeds.
- Renderer smoke: placeholder before load, href only for visible nodes.
- Manual dev-vault check for actual rendering (Electron).

## Performance

No new dependencies. Cost is bounded by thumbnail policy + lazy loading as
above; worst case (hundreds of images all in-viewport at low zoom) degrades
to browser image-decode throughput — graceful, not a freeze.

## ⚠️ Decision required (perf rule 3)

**Thumbnail size & appearance policy** — trade-off between visual richness
and memory/decode cost:

| Option | Look | Cost |
|---|---|---|
| **A. Small fixed thumb (~120 px), click opens the image in an Obsidian modal/tab** *(recommended, chosen)* | Compact, uniform map | Bounded memory & decode; zero layout reflow |
| B. Larger inline images (up to node wrap width, height from aspect ratio) | Richer, closer to a traditional desktop mind-mapper | Layout depends on image dimensions → must read intrinsic size on first load → one-time reflow per image; more memory |
| C. Icon-only marker, hover/click to preview | Cheapest | Least visual value |

## Implementation notes

Implemented as planned, decision A: `parseEmbeds`/`isImageTarget`/
`getImageEmbed` ([links.ts](../src/model/links.ts)), `computeNodeBox`'s new
`imageBox` ([layoutEngine.ts](../src/layout/layoutEngine.ts), fixed thumb
size — no reflow on load), `SvgRenderer`'s lazy placeholder/image/missing-
glyph group (rides on the existing viewport-culling mechanism for free —
no new lazy-load bookkeeping needed) and new `setImageResolver`/
`setImageClickHandler` callbacks, and `MindMapView`'s
`resolveNodeImageUrl`/`openImage` (new tab, unlike a regular link click).
Tests added: `parseEmbeds`/`isImageTarget`/`getImageEmbed` in
[test/links.test.ts](../test/links.test.ts) (13 new cases), `computeNodeBox`
image-box sizing in [test/layout.test.ts](../test/layout.test.ts) (6 new
cases), renderer smoke tests for placeholder/href/click/embed-removal in
[test/renderer.smoke.test.ts](../test/renderer.smoke.test.ts) (5 new
cases), and a lazy-load-via-culling correctness test in
[test/culling.test.ts](../test/culling.test.ts). New
`scripts/bench-images.mjs` (`npm run bench:images`) per the subplan's
benchmark step, logged in [benchmarks.md](../benchmarks.md). Full decision
writeup in [DECISIONS.md](../DECISIONS.md) (2026-07-06 entry). `npm test`
(272/272) and `npm run build` both pass. Manual verification in the dev
vault still pending — see workflow step 5: add an image embed to a node
and confirm the thumbnail renders below the text at the expected size,
click it and confirm it opens in a new tab, try a broken/nonexistent image
target and confirm the "missing" glyph shows, and check pan/zoom
smoothness on a map with many image nodes (this is the one budget this
environment cannot verify — jsdom doesn't paint).
