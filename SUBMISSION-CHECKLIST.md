# Community Plugin Submission Checklist

Tracks readiness against [Obsidian's plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). Items are either done in this repo, or need something only you can provide/verify (an account, a real device, a legal choice).

## Done in this repo

- [x] `manifest.json` has all required fields (`id`, `name`, `version`, `minAppVersion`, `description`, `author`); empty `authorUrl` removed rather than left blank.
- [x] `versions.json` maps the plugin version to the minimum Obsidian version.
- [x] Plugin id/name don't redundantly include "Obsidian".
- [x] Command ids/names don't repeat the plugin name (Obsidian prefixes commands with the plugin name automatically).
- [x] No `innerHTML`/`outerHTML` with unsanitized content anywhere (DOM built via `createElementNS`/`textContent`/`setAttribute` throughout).
- [x] Static visual styling lives in `styles.css`, not inline; inline `style.*` is only used for genuinely dynamic, computed values (the inline editor's position).
- [x] Only public Obsidian APIs used (`TextFileView`, `Vault`, `Workspace`, `Modal`, `parseYaml`/`stringifyYaml`-equivalent avoided in favor of a narrower approach — see DECISIONS.md); no monkey-patching of Obsidian internals.
- [x] Bundle size (40–44 KB across milestones) is far under the 1 MB guideline ceiling — see `benchmarks.md`.
- [x] `.gitignore` excludes `node_modules/`, build output (`dist/`, the dev-vault's copy of `main.js`), and generated fixtures.
- [x] `npm test` (91+ unit tests) passes locally before a release is built.

## Needs your action before submitting

- [ ] **License.** No `LICENSE` file exists yet — community plugins require one. This is a real choice (MIT, GPL, etc.) with implications for how others can use/fork the code; I didn't pick one for you. Add one and reference it from `manifest.json` if you want (not required, but common).
- [ ] **GitHub repository + first tagged release.** No CI/release workflow is used for this project (intentionally — see CLAUDE.md); `main.js`, `manifest.json`, and `styles.css` need to be built locally (`npm run build`) and attached to a GitHub Release by hand, with the release tag (e.g. `1.0.0`) matching `manifest.json`'s `version`.
- [ ] **`authorUrl`/`fundingUrl`** (optional fields) — add if you want a link back to you or a sponsorship page.
- [ ] **Mobile verification.** `isDesktopOnly` is currently `false`, meaning the plugin claims mobile support, but nothing in this session verified it on an actual phone/tablet (no way to do that from here — see CLAUDE.md's note on this being an Electron desktop app with no browser dev-server, and mobile being a real device besides). Specifically untested: touch drag for manual positioning/reordering (built on Pointer Events, which *should* work, but pinch-to-zoom isn't implemented — only mouse-wheel zoom is). Either verify on a device, or set `isDesktopOnly: true` until you do.
- [ ] **Obsidian's official plugin review** happens after you submit a PR to the `obsidian-releases` repo — expect requests for changes; this checklist covers the mechanical/automatable parts, not their manual review judgment calls.
- [ ] **Screenshots/demo GIF** for the community plugin listing — needs the actual UI running, which needs the manual dev-vault verification already flagged as outstanding in `benchmarks.md`.

## Also outstanding (performance verification, not submission-blocking)

- [ ] Real browser (Chrome DevTools inside Obsidian) verification of paint/interaction cost — every benchmark in this repo is either headless-Node or jsdom, which don't paint. Flagged consistently across `benchmarks.md`; not yet done manually.
