/**
 * JavaScript rendering benchmark, mirroring the Rust POC.
 *
 * Reports the markdown-it + highlight.js stage separately from the DOMPurify
 * stage. Only the first number is comparable to the Rust POC: DOMPurify needs a
 * DOM, and jsdom's DOM is far slower than the WKWebView/WebView2 DOM the app
 * actually runs in. Treating the jsdom sanitize cost as the app's cost would
 * badly misrepresent the JavaScript pipeline.
 */
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/common";

const [file, iterationsArg] = process.argv.slice(2);
const iterations = Number(iterationsArg ?? 100);
const source = readFileSync(file, "utf8");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { default: DOMPurify } = await import("dompurify");

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through */
      }
    }
    return md.utils.escapeHtml(code);
  },
})
  .use(anchor, { permalink: anchor.permalink.linkInsideHeader({ symbol: "#", placement: "before" }) })
  .use(taskLists, { label: true, labelAfter: true });

// Warm up: first pass pays for JIT and highlight.js language registration.
const warm = md.render(source);
DOMPurify.sanitize(warm);

let t0 = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) md.render(source);
const parseMs = Number(process.hrtime.bigint() - t0) / 1e6 / iterations;

t0 = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) DOMPurify.sanitize(md.render(source));
const fullMs = Number(process.hrtime.bigint() - t0) / 1e6 / iterations;

console.error(`input_bytes\t${Buffer.byteLength(source)}`);
console.error(`output_bytes\t${Buffer.byteLength(warm)}`);
console.error(`iterations\t${iterations}`);
console.error(`parse_highlight_ms\t${parseMs.toFixed(3)}`);
console.error(`full_pipeline_jsdom_ms\t${fullMs.toFixed(3)}`);
console.log(warm);
