/** Preferences live in the webview's localStorage — no config file, no network,
 *  nothing to sync. */

export type Theme = "system" | "light" | "dark";

const ZOOM_KEY = "parchment.zoom";
const THEME_KEY = "parchment.theme";
const TOC_KEY = "parchment.toc";

const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.4];
const DEFAULT_STEP = ZOOM_STEPS.indexOf(1);

let zoomStep = clampStep(Number(localStorage.getItem(ZOOM_KEY) ?? DEFAULT_STEP));
let theme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";

function clampStep(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STEP;
  return Math.min(ZOOM_STEPS.length - 1, Math.max(0, Math.round(value)));
}

export function applyZoom(): void {
  document.documentElement.style.setProperty("--zoom", String(ZOOM_STEPS[zoomStep]));
}

export function zoomIn(): void {
  zoomStep = clampStep(zoomStep + 1);
  localStorage.setItem(ZOOM_KEY, String(zoomStep));
  applyZoom();
}

export function zoomOut(): void {
  zoomStep = clampStep(zoomStep - 1);
  localStorage.setItem(ZOOM_KEY, String(zoomStep));
  applyZoom();
}

export function zoomReset(): void {
  zoomStep = DEFAULT_STEP;
  localStorage.setItem(ZOOM_KEY, String(zoomStep));
  applyZoom();
}

export function getTheme(): Theme {
  return theme;
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => {
  if (theme === "system") applyTheme();
});

/** "system" is resolved to a concrete value here rather than in CSS, so the
 *  stylesheets only ever have to express two themes instead of four states. */
export function applyTheme(): void {
  const resolved = theme === "system" ? (darkQuery.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = theme;
}

/** Cycles system -> light -> dark, matching the View menu item. */
export function cycleTheme(): Theme {
  theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  localStorage.setItem(THEME_KEY, theme);
  applyTheme();
  return theme;
}

export function setTheme(next: Theme): void {
  theme = next;
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
}

export function tocEnabled(): boolean {
  return localStorage.getItem(TOC_KEY) === "1";
}

export function setTocEnabled(enabled: boolean): void {
  localStorage.setItem(TOC_KEY, enabled ? "1" : "0");
}
