# Rendering benchmarks

Backs [`docs/rendering-engine-comparison.md`](../docs/rendering-engine-comparison.md).

## JavaScript pipeline

markdown-it + highlight.js + DOMPurify, i.e. what the app actually ships.

```sh
node benchmarks/bench-js.mjs benchmarks/corpus-large.md 200
```

Timings go to stderr, rendered HTML to stdout. The DOMPurify figure it reports
is measured against jsdom and is **not** representative of the app, which runs
in WKWebView or WebView2 — see the write-up.

## Rust pipeline

comrak + syntect + ammonia. Kept as a single source file rather than a crate in
this repository, so it does not become a build target for something that was
evaluated and rejected.

```sh
mkdir -p /tmp/render-poc/src
cp benchmarks/render-poc.rs /tmp/render-poc/src/main.rs
cat > /tmp/render-poc/Cargo.toml <<'EOF'
[package]
name = "render-poc"
version = "0.1.0"
edition = "2021"

[dependencies]
comrak = "0.39"
ammonia = "4"
syntect = { version = "5", default-features = false, features = ["default-fancy"] }

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
EOF
cargo build --release --manifest-path /tmp/render-poc/Cargo.toml
/tmp/render-poc/target/release/render-poc benchmarks/corpus-large.md 200

# comrak's parsing cost with syntect taken out of the path
PARCHMENT_NO_HIGHLIGHT=1 /tmp/render-poc/target/release/render-poc \
  benchmarks/corpus-large.md 200
```

## Corpora

- `corpus-small.md` (350 B) — feature coverage: tables, task lists, fenced code
  in two languages, frontmatter, inline HTML.
- `corpus-large.md` (51 KB) — 40 sections of prose with periodic code blocks,
  tables, and lists. Deterministic; generated with a fixed seed.

Neither is a real-world document. `corpus-large.md` is prose-heavy, which
flatters parsers and understates highlighting cost relative to a document that
is mostly code.
