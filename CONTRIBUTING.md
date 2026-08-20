# Contributing

Thanks for looking. This is a small, deliberately boring program, and the goal
is to keep it that way.

## Getting set up

Requires [Node 20.19+ or 22+](https://nodejs.org) and [Rust](https://rustup.rs).
On Linux you also need `libwebkit2gtk-4.1-dev` and `libgtk-3-dev`.

```sh
npm install
npm start          # run the app in development
npm run validate   # everything CI will check
```

`npm run validate` runs the renderer tests with coverage thresholds, the
TypeScript type check, `cargo fmt --check`, and `cargo clippy -D warnings`. If
it passes locally, CI should agree. If it does not, that is a bug in the setup
and worth reporting on its own.

To eyeball a rendering change without launching the app:

```sh
node preview.mjs path/to/doc.md preview.html --dark
```

## Where things live

| Layer | What it does |
|---|---|
| `src-tauri/src/lib.rs` | Commands, state, file-open plumbing |
| `src-tauri/src/menu.rs` | Native menu; forwards ids to the webview |
| `src-tauri/src/watcher.rs` | Live reload |
| `src-tauri/src/assets.rs` | The `mdasset://` scheme |
| `src/render.ts` | markdown-it → highlight.js → DOMPurify → path resolution |
| `src/main.ts` | Menu events, drag-drop, links, export |
| `src/toc.ts`, `src/find.ts`, `src/prefs.ts` | Sidebar, search, preferences |

All rendering happens in the webview; all file and OS access happens in Rust.
The two talk over three commands and four events. Keeping that boundary narrow
is the main architectural constraint — if a change widens it, say so in the PR
and explain why it has to.

## Tests

The renderer is the part that handles untrusted input, so it is the part with
tests. `test/render.test.mjs` runs `src/render.ts` against jsdom — Node strips
the types on import, so there is no build step and coverage maps onto the real
source.

Coverage thresholds are enforced at 95% lines, 95% functions, 80% branches.

**Any change to sanitization needs a test.** That code is the boundary between a
document someone sent you and script running on your machine. The existing
sanitization tests are the model to follow.

There is a hand-rolled test runner at the bottom of the test file rather than
`node:test`. That is deliberate, and the reason is in the comment: `node:test`
silently dropped suites registered after a top-level `await` on some Node
versions, running four of the tests while reporting success. The custom runner
prints its own totals, so a silent drop is visible.

## Dependencies

Be reluctant. Eighteen npm packages ship inside the released binary and every
one of them parses or sanitizes untrusted input; the rest of the tree is
build-time only. A new runtime dependency needs a justification in the PR. A new
dev dependency needs a reason too, just a smaller one.

Dependabot proposes updates weekly. Patch and minor bumps auto-merge once CI
passes; major bumps wait for a human.

Rust dependencies are additionally checked by `cargo deny`, configured in
`src-tauri/deny.toml`: permissive licences only, crates.io only, no git
dependencies.

## Pull requests

- One change per PR.
- Match the surrounding style. Comments explain *why*, not *what* — the code
  already says what.
- Note anything you could not verify. "Tested on macOS, not on Windows" is
  useful; silence is not.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
