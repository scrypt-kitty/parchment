/**
 * Shared test environment.
 *
 * All suites run in one process, so they must share a single DOM and a single
 * Tauri stub. When each file installed its own, whichever imported last won and
 * silently changed the behaviour the earlier suites were asserting against.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.DocumentFragment = dom.window.DocumentFragment;
globalThis.trustedTypes = undefined;

// Mirrors the URL shape the real webview produces, so path-resolution
// assertions test the same strings users would get.
// jsdom does not implement matchMedia, and prefs.ts calls it at module scope to
// resolve the "system" theme. Reports light; tests may replace it.
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

/** Version reported by the stubbed `getVersion()`; tests may reassign it. */
export const app = { version: "1.0.1" };

dom.window.__TAURI_INTERNALS__ = {
  invoke: async (command) => (command === "plugin:app|version" ? app.version : undefined),
  convertFileSrc: (path, scheme = "asset") =>
    `${scheme}://localhost/${encodeURIComponent(path)}`,
};

export { dom };
