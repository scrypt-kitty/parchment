/**
 * Renderer tests.
 *
 * `render.ts` is browser code, so it runs against the shared jsdom document in
 * setup.mjs. Node 22
 * strips the TypeScript types on import, so the source is loaded directly —
 * no bundling step, which means coverage maps straight onto src/render.ts.
 *
 * Tauri's `convertFileSrc` delegates to an injected global, stubbed here with
 * the same URL shape the real webview produces.
 */
import assert from "node:assert/strict";

import "./setup.mjs";
import { describe, test } from "./runner.mjs";

const { render } = await import("../src/render.ts");

const html = (source, dir = "/docs") => render(source, dir).html;

describe("headings and anchors", () => {
  test("generates GitHub-compatible slugs", () => {
    const { headings } = render("## Getting Started\n\n### API Reference (v2)\n", "");
    assert.deepEqual(
      headings.map((h) => h.id),
      ["getting-started", "api-reference-v2"],
    );
  });

  test("heading text excludes the injected permalink glyph", () => {
    const { headings } = render("## Getting Started\n", "");
    assert.equal(headings[0].text, "Getting Started");
  });

  test("reports heading levels for the sidebar", () => {
    const { headings } = render("# A\n\n## B\n\n#### C\n", "");
    assert.deepEqual(
      headings.map((h) => h.level),
      [1, 2, 4],
    );
  });

  test("disambiguates repeated headings", () => {
    const { headings } = render("## Notes\n\n## Notes\n", "");
    assert.notEqual(headings[0].id, headings[1].id);
  });
});

describe("GitHub-flavored markdown", () => {
  test("renders tables", () => {
    const out = html("| a | b |\n|---|---|\n| 1 | 2 |\n");
    assert.match(out, /<table>/);
    assert.match(out, /<th>a<\/th>/);
    assert.match(out, /<td>2<\/td>/);
  });

  test("renders task lists with checkbox state", () => {
    const out = html("- [x] done\n- [ ] todo\n");
    const boxes = out.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    assert.equal(boxes.length, 2);
    // Attribute order is not guaranteed, so test each tag rather than the string.
    assert.equal(boxes.filter((tag) => /\bchecked\b/.test(tag)).length, 1);
    assert.ok(boxes.every((tag) => /\bdisabled\b/.test(tag)), "checkboxes stay read-only");
    assert.match(out, /class="[^"]*task-list-item/);
  });

  test("renders strikethrough and autolinks", () => {
    assert.match(html("~~gone~~"), /<s>gone<\/s>/);
    assert.match(html("see https://example.com now"), /<a href="https:\/\/example\.com"/);
  });

  test("highlights fenced code with a known language", () => {
    const out = html("```js\nconst x = 1;\n```\n");
    assert.match(out, /class="hljs-keyword"/);
  });

  test("leaves untagged code blocks unhighlighted but escaped", () => {
    const out = html("```\n<b>not bold</b>\n```\n");
    assert.doesNotMatch(out, /hljs-/);
    assert.match(out, /&lt;b&gt;/);
  });

  test("adds a copy button to code blocks", () => {
    assert.match(html("```\nx\n```\n"), /class="copy-code"/);
  });
});

describe("sanitization", () => {
  test("strips script tags", () => {
    const out = html('<script>alert("xss")</script>\n\nafter');
    assert.doesNotMatch(out, /<script/i);
    assert.doesNotMatch(out, /alert/);
  });

  test("strips inline event handlers", () => {
    const out = html('<img src="x" onerror="alert(1)">');
    assert.doesNotMatch(out, /onerror/i);
  });

  test("never emits a javascript: link", () => {
    // markdown-it refuses the scheme outright, so the source stays literal text
    // and no anchor is produced at all. Either way, nothing is clickable.
    const out = html("[click](javascript:alert(1))");
    assert.doesNotMatch(out, /href\s*=\s*["']?\s*javascript:/i);
    assert.doesNotMatch(out, /<a\b/i);
  });

  test("never emits a data: link", () => {
    const out = html("[click](data:text/html;base64,PHNjcmlwdD4=)");
    assert.doesNotMatch(out, /href\s*=\s*["']?\s*data:/i);
  });

  test("strips iframes and forms", () => {
    const out = html('<iframe src="https://evil.test"></iframe><form action="/x"></form>');
    assert.doesNotMatch(out, /<iframe/i);
    assert.doesNotMatch(out, /<form/i);
  });

  test("keeps safe inline html", () => {
    assert.match(html("press <kbd>Cmd</kbd>"), /<kbd>Cmd<\/kbd>/);
    assert.match(html("<details><summary>more</summary>body</details>"), /<details>/);
  });
});

describe("path resolution", () => {
  test("rewrites relative images onto the private asset scheme", () => {
    const out = html("![alt](assets/pic.png)", "/docs");
    assert.match(out, /mdasset:\/\/localhost\//);
    assert.match(out, new RegExp(encodeURIComponent("/docs/assets/pic.png")));
  });

  test("normalizes parent-directory segments", () => {
    const out = html("![alt](../img/pic.png)", "/docs/guide");
    assert.match(out, new RegExp(encodeURIComponent("/docs/img/pic.png")));
  });

  test("leaves absolute image urls untouched", () => {
    const out = html("![alt](https://example.com/pic.png)");
    assert.match(out, /src="https:\/\/example\.com\/pic\.png"/);
    assert.doesNotMatch(out, /mdasset/);
  });

  test("tags relative links so the app can open sibling documents", () => {
    const out = html("[next](chapter-2.md)", "/docs");
    assert.match(out, /data-relative="\/docs\/chapter-2\.md"/);
  });

  test("leaves in-document anchors alone", () => {
    const out = html("[top](#getting-started)");
    assert.match(out, /href="#getting-started"/);
    assert.doesNotMatch(out, /data-relative/);
  });
});

describe("frontmatter", () => {
  test("renders yaml frontmatter as a metadata list", () => {
    const out = html("---\ntitle: Hello\nauthor: Ada\n---\n\n# Body\n");
    assert.match(out, /class="frontmatter"/);
    assert.match(out, /<dt>title<\/dt>/);
    assert.match(out, /<dd>Hello<\/dd>/);
    assert.doesNotMatch(out, /<hr>/);
  });

  test("leaves a lone horizontal rule alone", () => {
    assert.match(html("above\n\n---\n\nbelow"), /<hr>/);
  });
});
