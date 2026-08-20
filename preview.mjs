/**
 * Renders a Markdown file to a standalone HTML page using the app's own
 * pipeline and stylesheets. Handy for eyeballing typography changes without
 * launching the app.
 *
 *   node preview.mjs <file.md> [out.html] [--dark]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

const [source, output = "preview.html"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dark = process.argv.includes("--dark");

if (!source) {
  console.error("usage: node preview.mjs <file.md> [out.html] [--dark]");
  process.exit(1);
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.DocumentFragment = dom.window.DocumentFragment;
// The preview is opened straight from disk, so point images at plain relative
// paths instead of the app's custom scheme.
dom.window.__TAURI_INTERNALS__ = { convertFileSrc: (path) => pathToFileURL(path).href };

const { render } = await import("./src/render.ts");

const absolute = resolve(source);
const { html } = render(readFileSync(absolute, "utf8"), dirname(absolute));

const css = ["src/styles/app.css", "src/styles/markdown.css", "src/styles/code.css"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

writeFileSync(
  output,
  `<!doctype html>
<html lang="en" data-theme="${dark ? "dark" : "light"}">
<head><meta charset="utf-8"><title>${absolute}</title><style>${css}</style></head>
<body class="exported"><article class="markdown-body">${html}</article></body>
</html>`,
);

console.log(`wrote ${output}`);
