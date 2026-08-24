# Should rendering move from JavaScript to Rust?

**Decision: no. The JavaScript pipeline stays.**

Measured on 2026-08-24, Apple M-series, macOS 15, Node 22.23.2, rustc 1.97.1,
release profile (`opt-level = "s"`, LTO, single codegen unit).

Reproduce with the files in [`benchmarks/`](../benchmarks).

## The question

Parchment ships 18 npm packages inside the released binary, and every one of
them touches untrusted input. Rust has credible equivalents for all three
rendering stages, so the obvious question is whether moving rendering into the
Rust core would reduce the attack surface and speed things up.

| Stage | JavaScript (current) | Rust (candidate) |
|---|---|---|
| Markdown → HTML | markdown-it | comrak |
| Syntax highlighting | highlight.js | syntect |
| Sanitizing | DOMPurify | ammonia |

The intuition is that Rust means fewer dependencies, fewer advisories, and more
speed. Two of those three turned out to be wrong.

## What the numbers actually say

### Dependency count goes up, by a lot

| | Packages pulled in |
|---|---|
| JavaScript: markdown-it + plugins, highlight.js, DOMPurify | **15** |
| Rust: comrak + syntect + ammonia | **141** |

comrak alone brings 88 crates, ammonia 59, syntect 51 (overlapping; 141 union).
markdown-it brings five transitive packages; highlight.js and DOMPurify bring
none at all.

This is the finding that most contradicts the premise. Migrating would multiply
the dependency count by roughly nine.

### Speed: comrak wins at parsing, then syntect gives it back

51 KB document, 200 iterations, mean per render:

| Pipeline | Parse (+highlight) | Full incl. sanitize |
|---|---|---|
| comrak alone | **0.667 ms** | 1.686 ms |
| comrak + syntect | 2.580 ms | 3.962 ms |
| markdown-it + highlight.js | 1.689 ms | see note |

comrak parses about **2.5× faster** than markdown-it. But syntect costs ~1.9 ms
on the same document, which is *more* than markdown-it and highlight.js cost
together. Add highlighting and the Rust pipeline ends up slower at 2.580 ms
versus 1.689 ms.

**Note on the JavaScript sanitize number.** DOMPurify needs a DOM, so measuring
it here means measuring jsdom, which produced 19.5 ms. That number is not in the
table because it would be dishonest to put it there: the app runs DOMPurify in
WKWebView and WebView2, whose DOM implementations are far faster than jsdom's.
The real in-app figure is unmeasured. It is the one gap in this comparison, and
it is the number that would most favour Rust if it turned out to be large.

Either way, both pipelines render a 51 KB document in single-digit milliseconds.
At the sizes people actually read, this difference is invisible.

### Size

| | |
|---|---|
| Rust POC binary | 2.52 MB |
| Current JS bundle | 314 KB raw, 114 KB gzipped |

syntect embeds its syntax definitions and theme data, which is most of that
2.52 MB. Moving rendering to Rust would grow the shipped app, not shrink it.

## The integration problem nobody predicts

The POC produced this:

```html
<pre><code class="language-rust"><span>fn </span><span>main</span><span>() { ... }</span></code></pre>
```

Bare `<span>` elements with no styling. syntect's default output colours code
with inline `style` attributes, and **ammonia strips `style`** — correctly, since
allowing arbitrary inline styles reintroduces a real injection surface.

Making this work means driving syntect's class-based generator and shipping a
matching CSS theme, which is exactly what highlight.js does today, out of the
box. That is not a blocker, but it is a day of fiddly work that the
"just swap the libraries" framing hides.

Output also differs in shape: comrak emits an empty `<a class="anchor">` *before*
heading text, where markdown-it-anchor's configuration produces a different
structure. Every CSS rule and the entire table-of-contents extraction would need
revisiting.

## The argument that does survive

Dependency **count** is the wrong metric; advisory **rate** is the right one.

Every advisory this project has hit came from JavaScript build tooling — vite's
dev server, its bundled esbuild, nanoid. The RustSec equivalents in the current
tree are all informational notices about unmaintained transitive crates, with
one unsoundness finding in glib that is Linux-only and unreachable from
anything Parchment calls.

npm's ecosystem genuinely produces more security churn per package. But note
where the churn lands: **in the tooling, not in the shipped code**. The 18 npm
packages inside the binary have been quiet. markdown-it, highlight.js, and
DOMPurify are mature, narrowly scoped, and heavily used.

DOMPurify in particular is the single most battle-tested HTML sanitizer in
existence, precisely because it is a permanent target for XSS researchers.
ammonia is well built on html5ever, but it does not have that adversarial
history behind it. For the one component whose failure means script execution in
a user's viewer, that track record is worth more than the language it is written
in.

## Conclusion

Migrating would:

- multiply dependencies 15 → 141
- make highlighting slower
- grow the binary by ~2 MB
- require rebuilding the sanitizer configuration, the CSS, and the TOC extraction
- trade the most-audited sanitizer available for a less-tested one

in exchange for a speed difference nobody can perceive, and a reduction in
advisory noise that mostly is not coming from the shipped code anyway.

If this changes, it will be because of one of these:

1. **DOMPurify's real in-webview cost turns out to be significant.** Worth
   measuring inside the app before anything else. It is the open question here.
2. **A serious advisory lands in one of the three shipped rendering packages.**
3. **syntect gets meaningfully faster**, or highlighting moves to a
   precomputed/tree-sitter approach where Rust's advantage returns.

Until then, the JavaScript pipeline stays, and the effort goes into keeping the
sanitizer well tested — which is where the actual risk lives.
