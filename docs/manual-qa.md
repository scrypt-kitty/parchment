# Manual QA

Most of Parchment is covered by `npm test` and the Rust jobs in CI. This file
lists what is left: behaviour that only appears in a built app, driving a real
webview against a real OS. Run it before tagging a release.

Build first:

```
npm run bundle       # or: npm start, for a dev build
```

## Things CI cannot check at all

CI builds the app on three platforms but never launches it, so nothing below is
exercised by a green pipeline.

### Outbound links

The capability scope is asserted in `test/capabilities.test.mjs`, but only the
static JSON. That the plugin then honours it is not observable without a window.

- [ ] Open a document containing an `https://` link. Click it. **A browser
      opens.** If nothing happens, the opener scope is denying the URL — that is
      the 1.1.0/1.2.0 bug, and it fails silently because every call site ends in
      `.catch(() => undefined)`.
- [ ] Click a `mailto:` link. A mail client opens.
- [ ] Put a non-Markdown sibling file next to a document (say `diagram.png`),
      link to it, click it. It opens in the OS viewer, via a `file://` URL.
- [ ] Link to a sibling `.md` file. It opens **in Parchment**, not the browser.

### The update banner

- [ ] *Check for Updates…* while on an older version. The banner appears.
- [ ] Click **Download**. The releases page opens in a browser. This is the
      exact button that was dead in 1.1.0 and 1.2.0.
- [ ] Click the **✕**. The banner dismisses and does not return for that version.
- [ ] Turn *Check for Updates Automatically* off, restart. No network request is
      made — verify with a proxy or `netstat` if you want to be sure.

### Wide view

- [ ] *View → Wide View* (<kbd>⇧⌘\</kbd> / <kbd>Ctrl+Shift+\</kbd>). The column
      cap drops and the document uses the window width; side padding remains.
- [ ] Toggle it back. The 900px column returns.
- [ ] Restart. The setting survived.
- [ ] Turn it on, then *File → Export as HTML…*. Open the export in a browser —
      it renders wide, matching the window it was exported from.
- [ ] With the table of contents open, wide view still lays out correctly beside
      the sidebar.

### Platform integration

- [ ] Double-click a `.md` file in the file manager — it opens in Parchment.
- [ ] Launch with a path argument: `parchment README.md`.
- [ ] On macOS, "Open With → Parchment" on a file while the app is closed.
- [ ] Drag a file onto the window.
- [ ] Print (<kbd>⌘P</kbd>) — the preview shows the document at full width with
      no chrome, no copy buttons.

### Live reload

- [ ] Open a document, edit it in another editor, save. The view updates, scroll
      position holds, a brief notice appears.
- [ ] Repeat with an editor that writes-then-renames (vim, VS Code). Still works
      — this is the case the watcher watches the parent directory to catch.
- [ ] *View → Reload Automatically* off: a "File changed on disk" bar appears
      instead and the document does not move until Reload is clicked.

## After a release

- [ ] `gh attestation verify <asset> --repo scrypt-kitty/parchment` resolves.
- [ ] The winget manifest's `InstallerSha256` matches the published
      `SHA256SUMS`. `packaging/README.md` covers the update flow.
