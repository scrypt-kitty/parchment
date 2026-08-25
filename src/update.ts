/** Update checking.
 *
 *  The request is made by the webview with `fetch`, not by Rust. That keeps
 *  every networking library out of the binary — `otool -L` on the shipped
 *  executable still lists nothing but system frameworks — and confines the
 *  reachable host to one auditable line of CSP in tauri.conf.json.
 *
 *  Parchment never downloads or installs anything itself. It reads the latest
 *  release tag, compares it to its own version, and if there is something newer
 *  it offers to open the release page in your browser. Self-updating desktop
 *  apps fail in ways that leave you with a broken install; a link cannot.
 */

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const LATEST_RELEASE_API =
  "https://api.github.com/repos/scrypt-kitty/parchment/releases/latest";
const RELEASES_PAGE = "https://github.com/scrypt-kitty/parchment/releases/latest";

const ENABLED_KEY = "parchment.updateCheck";
const LAST_CHECK_KEY = "parchment.updateLastCheck";
const DISMISSED_KEY = "parchment.updateDismissed";

/** Automatic checks run at most this often; a manual check always runs. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CheckOutcome =
  | { status: "up-to-date"; current: string }
  | { status: "available"; current: string; latest: string }
  | { status: "skipped" }
  | { status: "failed"; reason: string };

export function isEnabled(): boolean {
  // On by default: absent means enabled, only an explicit "0" turns it off.
  return localStorage.getItem(ENABLED_KEY) !== "0";
}

export function setEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

/** Compares dotted numeric versions. Returns true when `latest` is newer. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split("-")[0] // ignore any prerelease suffix
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * @param manual  a user-initiated check ignores both the interval and any
 *                version the user previously dismissed
 */
export async function check(manual = false): Promise<CheckOutcome> {
  if (!manual) {
    if (!isEnabled()) return { status: "skipped" };
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL_MS) {
      return { status: "skipped" };
    }
  }

  const current = await getVersion();

  let response: Response;
  try {
    response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      // No cookies, no credentials — this is an anonymous read.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    return { status: "failed", reason: `Could not reach GitHub: ${error}` };
  }

  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

  if (!response.ok) {
    // 403 here is almost always GitHub's unauthenticated rate limit.
    return { status: "failed", reason: `GitHub returned ${response.status}` };
  }

  let tag: unknown;
  try {
    tag = ((await response.json()) as { tag_name?: unknown }).tag_name;
  } catch {
    return { status: "failed", reason: "Unreadable response from GitHub" };
  }
  if (typeof tag !== "string") {
    return { status: "failed", reason: "No release tag in the response" };
  }

  const latest = tag.replace(/^v/, "");
  if (!isNewer(latest, current)) return { status: "up-to-date", current };
  if (!manual && localStorage.getItem(DISMISSED_KEY) === latest) {
    return { status: "skipped" };
  }
  return { status: "available", current, latest };
}

export function dismiss(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}

export function openReleasePage(): Promise<void> {
  return openUrl(RELEASES_PAGE).catch(() => undefined);
}
