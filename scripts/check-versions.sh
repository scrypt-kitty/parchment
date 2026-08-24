#!/usr/bin/env bash
#
# The version is stated in four places. They drift silently, and the symptom is
# an installer whose metadata disagrees with the binary inside it — so this is a
# CI gate, not a convention.
#
#   ./scripts/check-versions.sh            all four files must agree
#   ./scripts/check-versions.sh v1.0.1     ...and must equal this tag
#
set -euo pipefail

cd "$(dirname "$0")/.."

pkg=$(node -p "require('./package.json').version")
conf=$(node -p "require('./src-tauri/tauri.conf.json').version")
# Only the version inside [package] — a naive grep would also match a
# dependency pinned to the same string.
cargo=$(awk '
  /^\[package\]/ { in_package = 1; next }
  /^\[/          { in_package = 0 }
  in_package && /^version[[:space:]]*=/ {
    line = $0
    sub(/^version[[:space:]]*=[[:space:]]*"/, "", line)
    sub(/".*$/, "", line)
    print line
    exit
  }
' src-tauri/Cargo.toml)
lock=$(perl -0ne 'print $1 if /name = "parchment"\nversion = "([^"]+)"/' src-tauri/Cargo.lock)

printf 'package.json       %s\n'      "$pkg"
printf 'tauri.conf.json    %s\n'      "$conf"
printf 'Cargo.toml         %s\n'      "$cargo"
printf 'Cargo.lock         %s\n'      "$lock"

fail=0
for value in "$conf" "$cargo" "$lock"; do
  [ "$value" = "$pkg" ] || fail=1
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "error: version mismatch across the four files above." >&2
  echo "Run the bump-version workflow rather than editing them by hand." >&2
  exit 1
fi

# When a tag is supplied, the built artifacts must actually claim to be it.
if [ $# -ge 1 ]; then
  tag=${1#v}
  if [ "$tag" != "$pkg" ]; then
    echo
    echo "error: tag v$tag does not match the committed version $pkg." >&2
    echo "Tag the commit that carries the matching bump." >&2
    exit 1
  fi
  echo
  echo "ok: all four agree at $pkg, and match tag v$tag"
else
  echo
  echo "ok: all four agree at $pkg"
fi
