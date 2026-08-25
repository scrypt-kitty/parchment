/** Recently opened documents.
 *
 *  Paths only — never contents. The list lives in localStorage next to the
 *  other preferences, so it never leaves the machine.
 */

const KEY = "parchment.recent";
const LIMIT = 12;

export interface RecentFile {
  path: string;
  name: string;
  /** Epoch millis, used for ordering and the relative label. */
  openedAt: number;
}

export function list(): RecentFile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentFile =>
        typeof entry?.path === "string" &&
        typeof entry?.name === "string" &&
        typeof entry?.openedAt === "number",
    );
  } catch {
    // A corrupt entry should cost you the history, not the app.
    return [];
  }
}

function save(entries: RecentFile[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
}

/** Records a document, moving it to the front if it was already known. */
export function remember(path: string, name: string): RecentFile[] {
  const entries = [{ path, name, openedAt: Date.now() }, ...list().filter((e) => e.path !== path)];
  save(entries);
  return entries.slice(0, LIMIT);
}

/** Drops an entry — used when a file has been moved or deleted. */
export function forget(path: string): RecentFile[] {
  const entries = list().filter((e) => e.path !== path);
  save(entries);
  return entries;
}

export function clear(): void {
  localStorage.removeItem(KEY);
}

/** "just now" / "3 hours ago" / "12 Aug" — short enough for a narrow list. */
function relativeTime(then: number): string {
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} hr ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)} d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Shortens a path for display: the parent directory and the filename. */
export function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

/**
 * Renders the list shown on the empty state.
 *
 * @param onOpen invoked with the path of the entry that was activated
 */
export function render(container: HTMLElement, onOpen: (path: string) => void): void {
  const entries = list();
  container.textContent = "";
  container.hidden = entries.length === 0;
  if (!entries.length) return;

  const heading = document.createElement("div");
  heading.className = "recent-head";
  heading.textContent = "Recent";
  container.appendChild(heading);

  for (const entry of entries.slice(0, 8)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "recent-row";
    row.title = entry.path;

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = entry.name;

    const where = document.createElement("span");
    where.className = "recent-path";
    where.textContent = shortenPath(entry.path);

    const when = document.createElement("span");
    when.className = "recent-when";
    when.textContent = relativeTime(entry.openedAt);

    row.append(name, where, when);
    row.addEventListener("click", () => onOpen(entry.path));
    container.appendChild(row);
  }
}
