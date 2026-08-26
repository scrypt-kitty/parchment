# Packaging

Where Parchment can be installed from, and what state each channel is in.

| Channel | Status | Install |
|---|---|---|
| **Homebrew** | **Working** | `brew install --cask scrypt-kitty/tap/parchment` |
| **winget** | Manifests ready, not submitted | — |
| **Flathub** | Metadata ready, build work outstanding | — |
| Direct download | Working | [Releases](https://github.com/scrypt-kitty/parchment/releases/latest) |

## Homebrew — done

Lives in [scrypt-kitty/homebrew-tap](https://github.com/scrypt-kitty/homebrew-tap).

```sh
brew install --cask scrypt-kitty/tap/parchment
xattr -dr com.apple.quarantine /Applications/Parchment.app   # unsigned build
```

A tap rather than a PR to `homebrew-cask`, because the official repository
applies [notability requirements](https://docs.brew.sh/Acceptable-Casks#rejected-casks)
— roughly 30 forks, 30 watchers, or 75 stars — that a new project does not meet.
A tap installs identically. Submitting upstream is worth doing once the project
qualifies.

The cask updates itself: a scheduled workflow in the tap polls this repository's
releases and rewrites the version and both checksums, taking them from the
release's own `SHA256SUMS`. It polls rather than being pushed to, so it needs no
cross-repository token.

## winget — manifests ready

[`winget/`](winget) holds a complete v1.6.0 manifest set for 1.1.0.

To submit, fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
and copy the three files to
`manifests/s/scrypt-kitty/Parchment/1.1.0/`, or let `wingetcreate` do it:

```powershell
wingetcreate submit --token <github-pat> packaging/winget
```

Two things to know before submitting:

- **Only the NSIS installer is listed.** The MSI would also need its
  `ProductCode` GUID, which can only be read out of the `.msi` itself — with
  `msiinfo` from msitools, or on Windows. A placeholder there fails validation,
  so the MSI is omitted rather than guessed at.
- **The installers are unsigned.** winget accepts unsigned packages, but
  SmartScreen will still warn users on first run until the project has
  reputation or a signing certificate.

Automating resubmission on each release needs a PAT with fork and PR rights, as
`GITHUB_TOKEN` cannot push to a fork in another org.

## Flathub — metadata ready, build work outstanding

[`flathub/`](flathub) holds
[`io.github.scrypt_kitty.Parchment.metainfo.xml`](flathub/io.github.scrypt_kitty.Parchment.metainfo.xml),
which is worth having regardless of Flathub: GNOME Software and KDE Discover
read AppStream metadata for the `.deb` too.

What is genuinely not done, stated plainly rather than stubbed out:

1. **Offline dependency vendoring.** Flathub builds have no network access, so
   both dependency trees must be vendored into the manifest ahead of time —
   `flatpak-cargo-generator.py` for the ~300 crates and `flatpak-node-generator`
   for npm. This is the bulk of the work and produces a large generated sources
   file.
2. **App ID change.** Flathub wants `io.github.scrypt_kitty.Parchment` for a
   project without its own domain; the app currently identifies as
   `io.parchment.viewer`. The Linux `.desktop` file and the metainfo must agree
   with whichever is chosen.
3. **Screenshots.** Flathub requires at least one, with a caption, at a URL that
   resolves. The metainfo references `docs/screenshots/`, which does not exist
   yet.
4. **Submission.** A PR to [flathub/flathub](https://github.com/flathub/flathub)
   on a `new-pr` branch, then review.

Until that is done, Linux users have the `.deb` and the AppImage from the
releases page, both of which work today.

## Verifying any download

Every release publishes `SHA256SUMS` and a signed build provenance attestation:

```sh
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify <file> --repo scrypt-kitty/parchment
```
