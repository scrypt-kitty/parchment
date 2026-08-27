# Parchment

A fast, private, open-source Markdown viewer for macOS, Windows, and Linux.

Open a `.md` file and read it. That's the whole product. No editor, no account,
no sync, no telemetry — and unlike the closed-source viewers in this category,
you can read every line that runs on your machine.

![GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)

## Install

### Homebrew (macOS)

```sh
brew install --cask scrypt-kitty/tap/parchment
xattr -dr com.apple.quarantine /Applications/Parchment.app
```

### Direct download

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

### Verifying your download

Every release carries a `SHA256SUMS` file and a signed build provenance
attestation.

Check the file arrived intact:

```sh
# Download SHA256SUMS from the release, alongside your artifact
sha256sum --check --ignore-missing SHA256SUMS
```

That proves the bytes are the ones the pipeline published. It does not prove
the pipeline itself was honest — the same run produced both the binary and the
checksums. For that, verify the provenance attestation, which is signed by
GitHub's OIDC identity and names the workflow, commit, and runner that built
the artifact:

```sh
gh attestation verify Parchment_1.0.1_aarch64.dmg --repo scrypt-kitty/parchment
```

A pass means the file was built by this repository's release workflow from a
specific commit, and not substituted afterwards.

If you would rather not trust a prebuilt binary at all, building from source
takes two commands — see [Building](#building).

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

- **Live reload** — edit in your editor, the view updates and holds your scroll
  position, with a brief notice so you can see it happened. *View → Reload
  Automatically* switches this to a "File changed" prompt if you would rather
  the document never move while you are reading it
- **Find** (<kbd>⌘F</kbd>) with match count and next/previous
- **Table of contents** sidebar (<kbd>⌘\\</kbd>) that tracks the section you're in
- **Zoom** (<kbd>⌘+</kbd> / <kbd>⌘−</kbd> / <kbd>⌘0</kbd>), remembered between launches
- **Appearance** (<kbd>⇧⌘L</kbd>) cycling system → light → dark
- **Export to a standalone HTML file** with styles inlined, and **Print**
- **Recent files** on the start screen and under *File → Open Recent*
- **Update notice** when a newer release exists — off-switch included, and it
  never installs anything itself

## Privacy

Parchment makes exactly one kind of network request: once a day, it asks GitHub
for the latest release tag so it can tell you an update exists. That is the
whole of it. No analytics, no crash reporting, no account, no phoning home with
what you read.

**Turn it off** in *Check for Updates Automatically* (the Parchment menu on macOS, Help
elsewhere) and the app makes no requests at all, ever.

What the check does, precisely:

- A single anonymous `GET` to `https://api.github.com/repos/scrypt-kitty/parchment/releases/latest`
- Sends no cookies, no credentials, no identifiers, and nothing about your files
- Reads one field, `tag_name`, and compares it to the running version
- **Never downloads or installs anything.** If there is a newer version it
  offers to open the release page in your browser, and you take it from there.
  Self-updating desktop apps fail in ways that leave you with a broken install

GitHub necessarily sees your IP address and the fact that a Parchment
installation checked in, in the same way it would if you loaded the releases
page yourself. If that is not acceptable, turn the check off — or install
through a package manager, which never triggers it.

The request is made by the webview's own `fetch`, not by Rust, so no HTTP client
is compiled into the binary:

```sh
otool -L /Applications/Parchment.app/Contents/MacOS/parchment   # system frameworks only
```

**Per-process socket tools will not show you this request, and that is not
evidence of anything.** On macOS WKWebView hands its networking to a shared
system service, so the connection belongs to
`com.apple.WebKit.Networking.xpc` — parented to `launchd`, shared with every
other WebKit app — rather than to `parchment`. `lsof -c parchment` prints
nothing whether the check is enabled or disabled. Use a network filter such as
Little Snitch, or `tcpdump`, if you want to watch it directly.

What *is* app-specific and checkable is the policy baked into the binary. The
webview may reach exactly one host, and you can read that out of the shipped
app:

```sh
strings -a /Applications/Parchment.app/Contents/MacOS/parchment \
  | grep -o "connect-src[^\"]*"
```

`connect-src` names `api.github.com` and nothing else, so neither a document nor
a compromised renderer can reach anywhere else. The single call site is
[`src/update.ts`](src/update.ts); with the check disabled it is never reached.

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

Rendering stays in JavaScript rather than moving into the Rust core. That was
measured rather than assumed — see
[`docs/rendering-engine-comparison.md`](docs/rendering-engine-comparison.md),
which found the Rust equivalents would multiply dependencies 15 → 141, make
highlighting slower, and trade the most-audited HTML sanitizer available for a
less-tested one.

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

GPL-3.0-or-later. See [LICENSE](LICENSE).

Copyleft is deliberate. This exists because the good Markdown viewers are
closed-source; a licence that let someone take it and close it again would
defeat the point. Fork it, change it, ship it — just keep it open.
