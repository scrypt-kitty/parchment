# Parchment

A fast, private, open-source Markdown viewer for macOS, Windows, and Linux.

Open a `.md` file and read it. That's the whole product. No editor, no account,
no sync, no telemetry — and unlike the closed-source viewers in this category,
you can read every line that runs on your machine.

![MIT licensed](https://img.shields.io/badge/license-MIT-blue)

## Install

Grab the file for your platform from the
[latest release](https://github.com/scrypt-kitty/parchment/releases/latest):

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | `Parchment_<version>_aarch64.dmg` |
| macOS (Intel) | `Parchment_<version>_x64.dmg` |
| Windows | `Parchment_<version>_x64-setup.exe`, or the `.msi` |
| Linux | `parchment_<version>_amd64.AppImage`, or the `.deb` |

Releases are **unsigned** — code-signing certificates cost money, and this
project has no revenue. Each platform therefore needs one extra step the first
time:

- **macOS** — the first launch is refused as being from an unidentified
  developer. Either right-click the app and choose *Open*, or clear the
  quarantine flag:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Parchment.app
  ```

- **Windows** — SmartScreen shows a blue "Windows protected your PC" panel.
  Click *More info*, then *Run anyway*.

- **Linux** — mark the AppImage executable first:

  ```sh
  chmod +x parchment_*_amd64.AppImage
  ```

If you would rather not trust a prebuilt binary, building from source takes two
commands — see [Building](#building).

## Features

**Reading**

- GitHub-flavored Markdown: tables, task lists, strikethrough, autolinks, footnote-style references
- GitHub's typography and color tokens, in light and dark
- Syntax-highlighted code blocks with one-click copy
- YAML frontmatter rendered as a metadata table instead of leaking into the page
- Images alongside the document resolve and display

**Getting a file in**

- Drag a file onto the window
- <kbd>⌘O</kbd> / <kbd>Ctrl+O</kbd>
- Double-click any `.md`, `.markdown`, `.mdown`, `.mkd`, or `.mdx` file
- Links to sibling Markdown files open in-app, so linked docs are browsable

**While reading**

- **Live reload** — edit in your editor, the view updates and holds your scroll position
- **Find** (<kbd>⌘F</kbd>) with match count and next/previous
- **Table of contents** sidebar (<kbd>⌘\\</kbd>) that tracks the section you're in
- **Zoom** (<kbd>⌘+</kbd> / <kbd>⌘−</kbd> / <kbd>⌘0</kbd>), remembered between launches
- **Appearance** (<kbd>⇧⌘L</kbd>) cycling system → light → dark
- **Export to a standalone HTML file** with styles inlined, and **Print**

## Privacy

Parchment makes no network requests. There is no analytics SDK, no update
pinger, no crash reporter. You can verify that rather than take it on faith.

The direct check is to watch for sockets while the app runs:

```sh
lsof -nP -iTCP -a -c parchment    # no output means no connections
```

Grepping the binary for URLs is the weaker check, because it finds inert
strings: source-comment links baked into Tauri, wry, and muda, the literal
`HTTP/1.1` version tokens, and this project's own repository URL. What matters
is that no *endpoint* appears — no analytics host, no update feed:

```sh
strings -a "/Applications/Parchment.app/Contents/MacOS/parchment" \
  | grep -Eio 'https?://[a-z0-9.-]+\.[a-z]{2,}' | sort -u
```

The app's permission set is declared in
[`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) and
is deliberately tiny: open a file dialog, save a file dialog, open a URL in your
browser, set the window title. There is no filesystem plugin, no HTTP plugin,
and no shell access.

Files are read only when you ask for one. Images referenced by a document are
served by a private URI scheme that refuses any path outside the open document's
own directory, so a hostile Markdown file cannot read the rest of your disk.

## Building

Requires [Node 20.19+ or 22+](https://nodejs.org) and [Rust](https://rustup.rs).

```sh
npm install
npm start          # run in development
npm test           # renderer tests, including the sanitizer
npm run bundle     # produce installers in src-tauri/target/release/bundle
```

On Linux you also need `libwebkit2gtk-4.1-dev` and `libgtk-3-dev`.

To check a styling change without launching the app, render any document to a
standalone page with the real pipeline and stylesheets:

```sh
node preview.mjs path/to/doc.md preview.html --dark
```

Releases for macOS (Apple Silicon + Intel), Windows, and Linux are built on
native runners by
[`.github/workflows/release.yml`](.github/workflows/release.yml) on any `v*` tag.
Cross-compiling to Windows from macOS is not supported by the toolchain — use the
CI workflow, which builds each target on its native runner.

## How it's put together

| Layer | What it does |
|---|---|
| [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) | App setup, `load_document` / `write_text_file` / `take_pending_file` commands, file-open plumbing |
| [`src-tauri/src/menu.rs`](src-tauri/src/menu.rs) | Native menu bar; every item forwards an id to the webview as a `menu-action` event |
| [`src-tauri/src/watcher.rs`](src-tauri/src/watcher.rs) | Live reload; watches the parent directory to survive atomic-rename saves |
| [`src-tauri/src/assets.rs`](src-tauri/src/assets.rs) | The `mdasset://` scheme, scoped to the open document's directory |
| [`src/render.ts`](src/render.ts) | markdown-it → highlight.js → DOMPurify → path resolution |
| [`src/main.ts`](src/main.ts) | Wires menu events, drag-drop, links, export, and scroll preservation |
| [`src/toc.ts`](src/toc.ts), [`src/find.ts`](src/find.ts), [`src/prefs.ts`](src/prefs.ts) | Sidebar, in-document search, persisted zoom/theme |
| [`test/render.test.mjs`](test/render.test.mjs) | Renderer tests, run against jsdom |

All rendering happens in the webview; all file and OS access happens in Rust.
The two talk over a handful of commands and four events, which is the entire
API surface between them.

## Security

Parchment renders Markdown you did not write, so the sanitizer is treated as
load-bearing and is covered by tests that gate CI.

Dependencies are scanned on every push and weekly on a schedule — npm
advisories, the RustSec database, `cargo deny` for licences and crate sources,
CodeQL, and secret scanning. Shipped dependencies are held to a stricter
threshold than build tooling, because only 18 of the npm packages in the tree
end up inside the released binary. Dependabot proposes updates weekly; patch and
minor bumps auto-merge once checks pass, majors wait for a human.

To report a vulnerability, see [SECURITY.md](SECURITY.md) — please email rather
than opening a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run validate` runs everything CI
checks: renderer tests with coverage thresholds, the type check, `cargo fmt`,
and `cargo clippy -D warnings`.

## License

MIT. See [LICENSE](LICENSE).
