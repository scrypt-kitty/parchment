import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import { render } from "./render";
import * as toc from "./toc";
import * as find from "./find";
import * as prefs from "./prefs";
import * as recent from "./recent";
import * as update from "./update";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/code.css";

interface Document {
  path: string;
  dir: string;
  name: string;
  content: string;
}

const doc = document.getElementById("doc") as HTMLElement;
const empty = document.getElementById("empty") as HTMLElement;
const scroller = document.getElementById("scroller") as HTMLElement;
const dropOverlay = document.getElementById("drop-overlay") as HTMLElement;
const recentList = document.getElementById("recent") as HTMLElement;
const updateBar = document.getElementById("update-bar") as HTMLElement;
const updateText = document.getElementById("update-text") as HTMLElement;
const reloadBar = document.getElementById("reload-bar") as HTMLElement;
const reloadText = document.getElementById("reload-text") as HTMLElement;

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx", "txt"];

let currentPath: string | null = null;

/* ---------------------------------------------------------------- documents */

async function openPath(path: string, preserveScroll = false): Promise<void> {
  let payload: Document;
  try {
    payload = await invoke<Document>("load_document", { path });
  } catch (error) {
    // A file that has been moved or deleted should leave the history, not sit
    // in it failing forever.
    await syncRecent(recent.forget(path));
    showError(String(error));
    return;
  }

  const ratio =
    preserveScroll && scroller.scrollHeight > scroller.clientHeight
      ? scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)
      : 0;

  const { html, headings } = render(payload.content, payload.dir);
  doc.innerHTML = html;
  clearError();
  if (!preserveScroll) hideReloadBar();
  empty.hidden = true;
  doc.hidden = false;

  currentPath = payload.path;
  await getCurrentWindow().setTitle(payload.name);
  await syncRecent(recent.remember(payload.path, payload.name));
  toc.build(headings, scroller);

  // Restore the reading position after a live reload; jump to top on a new file.
  requestAnimationFrame(() => {
    scroller.scrollTop = preserveScroll ? ratio * (scroller.scrollHeight - scroller.clientHeight) : 0;
    find.refresh();
  });
}

const emptyHint = empty.querySelector("p") as HTMLElement;
const emptyHintHtml = emptyHint.innerHTML;

function showError(message: string): void {
  doc.hidden = true;
  empty.hidden = false;
  emptyHint.textContent = message;
  emptyHint.classList.add("error");
}

function clearError(): void {
  emptyHint.innerHTML = emptyHintHtml;
  emptyHint.classList.remove("error");
}

/* ------------------------------------------------------------ recent files */

/** Keeps the native Open Recent submenu in step with the stored list. */
async function syncRecent(entries: recent.RecentFile[]): Promise<void> {
  recent.render(recentList, (path) => void openPath(path));
  await invoke("set_recent_files", {
    files: entries.map((entry) => ({ path: entry.path, name: entry.name })),
  }).catch(() => undefined);
}

/* ----------------------------------------------------------------- updates */

function showUpdate(latest: string): void {
  updateText.textContent = `Parchment ${latest} is available`;
  updateBar.hidden = false;
  updateBar.dataset.version = latest;
}

async function runUpdateCheck(manual: boolean): Promise<void> {
  const outcome = await update.check(manual);
  if (outcome.status === "available") {
    showUpdate(outcome.latest);
  } else if (manual && outcome.status === "up-to-date") {
    updateText.textContent = `Parchment ${outcome.current} is the latest version`;
    updateBar.hidden = false;
    delete updateBar.dataset.version;
    window.setTimeout(() => (updateBar.hidden = true), 4000);
  } else if (manual && outcome.status === "failed") {
    updateText.textContent = `Update check failed — ${outcome.reason}`;
    updateBar.hidden = false;
    delete updateBar.dataset.version;
  }
}

document.getElementById("update-download")!.addEventListener("click", () => {
  void update.openReleasePage();
});

document.getElementById("update-dismiss")!.addEventListener("click", () => {
  const version = updateBar.dataset.version;
  if (version) update.dismiss(version);
  updateBar.hidden = true;
});

async function pickFile(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof selected === "string") await openPath(selected);
}

function looksLikeMarkdown(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.includes(ext);
}

/* ------------------------------------------------------------------- export */

async function exportHtml(): Promise<void> {
  if (!currentPath) return;
  const suggested = (currentPath.split(/[\\/]/).pop() ?? "document").replace(/\.[^.]+$/, "");
  const target = await saveDialog({
    defaultPath: `${suggested}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!target) return;

  // Inline every stylesheet so the exported file renders standalone, offline.
  const css = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");

  const body = doc.cloneNode(true) as HTMLElement;
  for (const button of body.querySelectorAll(".copy-code")) button.remove();

  const page = `<!doctype html>
<html lang="en" data-theme="${prefs.getTheme()}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(suggested)}</title>
<style>${css}</style>
</head>
<body class="exported"><article class="markdown-body">${body.innerHTML}</article></body>
</html>`;

  try {
    await invoke("write_text_file", { path: target, contents: page });
  } catch (error) {
    showError(String(error));
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/* ------------------------------------------------------------ file changed */

let reloadTimer: number | undefined;

function hideReloadBar(): void {
  window.clearTimeout(reloadTimer);
  reloadBar.hidden = true;
  reloadBar.classList.remove("transient", "fading");
}

/** Shown after an automatic reload: informational, fades on its own. */
function showReloaded(): void {
  window.clearTimeout(reloadTimer);
  reloadText.textContent = "Reloaded from disk";
  reloadBar.classList.add("transient");
  reloadBar.classList.remove("fading");
  reloadBar.hidden = false;
  reloadTimer = window.setTimeout(() => {
    reloadBar.classList.add("fading");
    reloadTimer = window.setTimeout(hideReloadBar, 450);
  }, 1800);
}

/** Shown when automatic reloading is off: waits to be acted on. */
function showFileChanged(): void {
  window.clearTimeout(reloadTimer);
  reloadText.textContent = "File changed on disk";
  reloadBar.classList.remove("transient", "fading");
  reloadBar.hidden = false;
}

async function handleDocumentChanged(path: string): Promise<void> {
  if (path !== currentPath) return;
  if (prefs.autoReloadEnabled()) {
    await openPath(path, true);
    showReloaded();
  } else {
    showFileChanged();
  }
}

document.getElementById("reload-action")!.addEventListener("click", () => {
  hideReloadBar();
  if (currentPath) void openPath(currentPath, true);
});

document.getElementById("reload-dismiss")!.addEventListener("click", hideReloadBar);

/* -------------------------------------------------------------- menu wiring */

async function handleMenu(action: string): Promise<void> {
  if (action.startsWith("recent:")) {
    await openPath(action.slice("recent:".length));
    return;
  }

  switch (action) {
    case "open":
      await pickFile();
      break;
    case "reload":
      if (currentPath) await openPath(currentPath, true);
      break;
    case "export-html":
      await exportHtml();
      break;
    case "print":
      window.print();
      break;
    case "find":
      find.open();
      break;
    case "find-next":
      find.next();
      break;
    case "find-previous":
      find.previous();
      break;
    case "zoom-in":
      prefs.zoomIn();
      break;
    case "zoom-out":
      prefs.zoomOut();
      break;
    case "zoom-reset":
      prefs.zoomReset();
      break;
    case "toggle-theme":
      prefs.cycleTheme();
      break;
    case "check-updates":
      await runUpdateCheck(true);
      break;
    case "toggle-auto-reload": {
      const enabled = !prefs.autoReloadEnabled();
      prefs.setAutoReload(enabled);
      await invoke("set_auto_reload_checked", { enabled }).catch(() => undefined);
      // Leaving a stale "File changed" bar up after switching to automatic
      // would be confusing, and the document is about to be current anyway.
      if (enabled) hideReloadBar();
      break;
    }
    case "toggle-auto-update": {
      const enabled = !update.isEnabled();
      update.setEnabled(enabled);
      await invoke("set_auto_update_checked", { enabled }).catch(() => undefined);
      break;
    }
    case "clear-recent":
      recent.clear();
      await syncRecent([]);
      break;
    case "toggle-toc": {
      const next = !toc.isVisible();
      toc.setVisible(next);
      prefs.setTocEnabled(next);
      break;
    }
  }
}

/* ------------------------------------------------------------ document links */

doc.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;

  const copy = target.closest(".copy-code");
  if (copy) {
    const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
    await navigator.clipboard.writeText(code);
    copy.textContent = "Copied";
    window.setTimeout(() => (copy.textContent = "Copy"), 1200);
    return;
  }

  const link = target.closest("a");
  if (!link) return;
  const href = link.getAttribute("href") ?? "";

  if (href.startsWith("#")) {
    event.preventDefault();
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  event.preventDefault();
  const relative = link.getAttribute("data-relative");
  if (relative) {
    // A link to a sibling Markdown file opens in-app; anything else goes to the OS.
    if (looksLikeMarkdown(relative)) await openPath(relative);
    else await openUrl(`file://${relative}`).catch(() => undefined);
    return;
  }
  if (/^https?:|^mailto:|^tel:/i.test(href)) await openUrl(href).catch(() => undefined);
});

/* ------------------------------------------------------------------ keyboard */

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && find.isOpen()) {
    event.preventDefault();
    find.close();
    return;
  }
  // Ctrl/Cmd+scroll-free zoom shortcuts are also menu accelerators, but the
  // numeric-keypad variants never reach the menu, so handle them here too.
  const accel = event.metaKey || event.ctrlKey;
  if (accel && (event.key === "=" || event.key === "+")) {
    event.preventDefault();
    prefs.zoomIn();
  } else if (accel && event.key === "-") {
    event.preventDefault();
    prefs.zoomOut();
  } else if (accel && event.key === "0") {
    event.preventDefault();
    prefs.zoomReset();
  }
});

/* --------------------------------------------------------------- drag & drop */

async function initDragDrop(): Promise<void> {
  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "over") {
      dropOverlay.hidden = false;
    } else if (event.payload.type === "drop") {
      dropOverlay.hidden = true;
      const file = event.payload.paths.find(looksLikeMarkdown) ?? event.payload.paths[0];
      if (file) void openPath(file);
    } else {
      dropOverlay.hidden = true;
    }
  });
}

/* ---------------------------------------------------------------- bootstrap */

async function main(): Promise<void> {
  prefs.applyZoom();
  prefs.applyTheme();
  toc.setVisible(prefs.tocEnabled());

  await listen<string>("menu-action", (event) => void handleMenu(event.payload));
  await listen<string>("open-file", (event) => void openPath(event.payload));
  await listen<string>("document-changed", (event) => {
    void handleDocumentChanged(event.payload);
  });

  await initDragDrop();

  await syncRecent(recent.list());
  await invoke("set_auto_update_checked", { enabled: update.isEnabled() }).catch(() => undefined);
  await invoke("set_auto_reload_checked", { enabled: prefs.autoReloadEnabled() }).catch(() => undefined);

  // Rust holds any path passed via CLI args or a macOS "Open With" launch that
  // arrived before the webview finished loading.
  const pending = await invoke<string | null>("take_pending_file");
  if (pending) await openPath(pending);

  await getCurrentWindow().show();

  // After the window is up, so a slow or unreachable network never delays the
  // first paint.
  void runUpdateCheck(false);
}

void main();
