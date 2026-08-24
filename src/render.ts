import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";

/** Custom URI scheme registered in Rust. It only serves files that live inside
 *  the directory of the document currently open, so a malicious document cannot
 *  read arbitrary paths off disk. */
const ASSET_SCHEME = "mdasset";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  // The return type is annotated because this callback refers to `md` while
  // `md` is still being initialised; without it the inference is circular.
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through to plain escaping */
      }
    }
    return md.utils.escapeHtml(code);
  },
})
  .use(anchor, {
    permalink: anchor.permalink.linkInsideHeader({
      symbol: "#",
      placement: "before",
      class: "heading-anchor",
      ariaHidden: true,
    }),
    slugify: slug,
  })
  .use(taskLists, { label: true, labelAfter: true });

/** GitHub-compatible heading slugs, so `#some-heading` links written in the
 *  source document resolve the same way they do on github.com.
 *
 *  The ranges are General Punctuation and Supplemental Punctuation; they are
 *  written as escapes rather than literal characters because the literal form
 *  reads as an innocent-looking range that silently swallows every ASCII
 *  letter and digit. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, "")
    .replace(/\s+/g, "-");
}

/** Sanitizer must let our own asset scheme through; DOMPurify rejects unknown
 *  protocols by default. `http://<scheme>.localhost` is the Windows form that
 *  `convertFileSrc` produces. */
const URI_ALLOWLIST = new RegExp(
  `^(?:(?:https?|mailto|tel|${ASSET_SCHEME}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`,
  "i",
);

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    // In-document anchors stay internal; everything else is handed to the OS
    // browser by the click handler in main.ts.
    if (!href.startsWith("#")) node.setAttribute("data-external", "true");
  }
});

export interface RenderResult {
  html: string;
  headings: { level: number; text: string; id: string }[];
}

/**
 * Render Markdown to sanitized HTML.
 *
 * @param source   raw Markdown text
 * @param baseDir  absolute directory of the document, used to resolve relative
 *                 image and link paths. Empty string disables resolution.
 */
export function render(source: string, baseDir: string): RenderResult {
  const { body, frontmatter } = splitFrontmatter(source);
  const rawHtml = md.render(body);

  const clean = DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: URI_ALLOWLIST,
    ADD_ATTR: ["target", "data-external", "id", "align"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcset", "formaction"],
  });

  const holder = document.createElement("div");
  holder.innerHTML = clean;

  if (frontmatter) holder.prepend(frontmatterTable(frontmatter));
  if (baseDir) resolveRelativePaths(holder, baseDir);
  addCodeCopyButtons(holder);

  const headings = [...holder.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => {
    const label = h.cloneNode(true) as HTMLElement;
    label.querySelector(".heading-anchor")?.remove();
    return {
      level: Number(h.tagName[1]),
      text: (label.textContent ?? "").trim(),
      id: h.id,
    };
  });

  return { html: holder.innerHTML, headings };
}

/** YAML frontmatter is metadata, not prose — render it as a small table above
 *  the document instead of letting it leak in as a stray `---` heading. */
function splitFrontmatter(source: string): { body: string; frontmatter: string | null } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { body: source, frontmatter: null };
  return { body: source.slice(match[0].length), frontmatter: match[1] };
}

function frontmatterTable(yaml: string): HTMLElement {
  const dl = document.createElement("dl");
  dl.className = "frontmatter";
  for (const line of yaml.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep < 1 || /^\s/.test(line)) continue;
    const dt = document.createElement("dt");
    dt.textContent = line.slice(0, sep).trim();
    const dd = document.createElement("dd");
    dd.textContent = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    dl.append(dt, dd);
  }
  return dl;
}

/** Rewrite relative `src`/`href` values to absolute custom-scheme URLs so the
 *  webview can load images that sit next to the document. */
function resolveRelativePaths(root: HTMLElement, baseDir: string): void {
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || isAbsoluteUrl(src)) continue;
    img.setAttribute("src", convertFileSrc(joinPath(baseDir, src), ASSET_SCHEME));
    img.setAttribute("loading", "lazy");
  }
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href")!;
    if (href.startsWith("#") || isAbsoluteUrl(href)) continue;
    // Keep the raw relative path; main.ts opens sibling .md files in-app.
    a.setAttribute("data-relative", joinPath(baseDir, href));
  }
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/");
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const cleaned = decodeURI(rel.split(/[?#]/)[0]).replace(/^\.\//, "");
  const parts = `${dir}${sep}${cleaned}`.split(/[\\/]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === ".." && out.length > 1) out.pop();
    else out.push(part);
  }
  return out.join(sep);
}

function addCodeCopyButtons(root: HTMLElement): void {
  for (const pre of root.querySelectorAll("pre")) {
    if (!pre.querySelector("code")) continue;
    const button = document.createElement("button");
    button.className = "copy-code";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    pre.appendChild(button);
  }
}
