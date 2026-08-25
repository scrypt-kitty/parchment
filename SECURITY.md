# Security Policy

## Reporting a vulnerability

Email **benthco@gmail.com**. Please do not open a public issue for anything
exploitable — send it privately first and it will be fixed before it is
described in public.

Include whatever you have: a description, the version, and ideally a Markdown
file that triggers it. A proof-of-concept document is worth more than a
paragraph.

You can expect an acknowledgement within a few days. This is a volunteer
project, not a company with an on-call rota, so please read that as a good-faith
intention rather than a contractual SLA. You will be credited in the release
notes unless you would rather not be.

## Supported versions

The latest release is the supported version. Fixes ship forward, not as
backports to older tags.

## What is worth reporting

Parchment renders untrusted Markdown from files you did not write. The
interesting attack surface is anything that lets a **document** escape the page
it is rendered in:

- HTML or script surviving sanitization and executing in the webview
- A path in a document reaching a file outside the document's own directory
  through the `mdasset://` scheme
- A link that reaches the network, or opens something without your say-so
- Anything that causes the app to write outside a path you chose in a dialog

Those are real bugs. Please report them.

## What is already known, and why it is not a finding

- **Unsigned releases.** Builds are unsigned, so macOS Gatekeeper and Windows
  SmartScreen warn on first launch. This is a funding problem, not an oversight.
- **Unmaintained transitive crates.** `cargo audit` reports around 17
  informational advisories — the gtk-rs GTK3 bindings behind the Linux webview,
  `unic-*` under `tauri-codegen`, `proc-macro-error`. All are transitive through
  Tauri and cannot be fixed here by changing a version. The pipeline is
  configured to fail on vulnerabilities and on unmaintained crates that this
  project chooses directly, and to report the rest without failing. See
  [`src-tauri/deny.toml`](src-tauri/deny.toml).

- **RUSTSEC-2024-0429, unsoundness in `glib::VariantStrIter`.** Reaches the tree
  as `tauri → gtk 0.18 → atk → glib 0.18.5`, and only on Linux — glib does not
  appear in the macOS or Windows dependency graphs at all. The fix is glib 0.20,
  which requires gtk-rs 0.20 and therefore an upstream Tauri release; it cannot
  be applied from this repository. The Dependabot alert is dismissed as
  tolerable risk with that reasoning recorded, and will resolve on its own when
  Tauri moves to gtk-rs 0.20.
- **Development-tooling advisories.** Vite, its dev server, and the test
  toolchain do not ship inside the app. Of the npm packages in the tree, 18 are
  bundled into the released binary and the rest are build-time only. CI holds
  shipped dependencies to a stricter bar than tooling — see
  [`.github/workflows/security.yml`](.github/workflows/security.yml).

## How the app limits its own blast radius

- **One network request, and only one.** Once a day the app asks GitHub for the
  latest release tag, so it can tell you an update exists. It sends no
  identifiers and nothing about your files, and it never downloads or installs
  anything — a newer version just opens the release page in your browser.
  *Check for Updates Automatically* turns it off entirely. No analytics, no
  crash reporting, no update payloads.
- **No HTTP client is linked.** The check is made by the webview's `fetch`, so
  `otool -L` on the binary still lists nothing but system frameworks. The
  reachable host is fixed by CSP to `api.github.com` alone. Note that on macOS
  the request is issued by the shared `com.apple.WebKit.Networking.xpc` service,
  so per-process socket tools will not attribute it to `parchment` either way —
  read the CSP rather than trusting `lsof`.
- **A deliberately small permission set.** Declared in
  [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json):
  open a file dialog, save a file dialog, open a URL in the browser, set the
  window title. No filesystem plugin, no shell, no HTTP.
- **Documents cannot read your disk.** Images are served over a private
  `mdasset://` scheme that canonicalizes both the request and the document's
  directory, then refuses anything that does not sit inside it — so `../`
  sequences and symlinks cannot climb out.
- **Markdown is sanitized before it reaches the DOM,** by DOMPurify, with a URI
  allowlist. This is covered by tests in
  [`test/render.test.mjs`](test/render.test.mjs); a regression there fails CI.
