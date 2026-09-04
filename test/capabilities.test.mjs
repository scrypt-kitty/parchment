/**
 * Capability-scope tests.
 *
 * These guard the bug that made every outbound link a dead click: the
 * capability granted `opener:allow-open-url`, which enables the command but
 * carries no URL scope of its own. The plugin's check reduces to
 * `self.allowed.iter().any(...)`, and `.any()` over an empty list is false, so
 * every URL came back ForbiddenUrl.
 *
 * Nothing in the TypeScript suite could see that — the failure lives entirely
 * in JSON that Rust reads — and `openUrl(...).catch(() => undefined)` swallowed
 * the rejection, so the Download button simply did nothing.
 *
 * Checked here rather than in Rust so it runs in `npm test` without a
 * toolchain, beside the frontend call sites it mirrors.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, test } from "./runner.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

const capability = JSON.parse(read("src-tauri/capabilities/default.json"));

/** Every allow-glob attached to the opener's open_url permission. */
function openerAllowGlobs() {
  return capability.permissions
    .filter((p) => typeof p === "object" && p.identifier === "opener:allow-open-url")
    .flatMap((p) => p.allow ?? [])
    .map((entry) => entry.url);
}

const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIAL = ".+^${}()|[]";

/** Mirrors the Rust `glob` crate as the plugin calls it: `*` spans `/`, since
 *  Pattern::matches leaves require_literal_separator off. `[^]` is the
 *  backslash-free spelling of "any character, newlines included". */
function globMatches(glob, url) {
  let pattern = "";
  for (const ch of glob) {
    if (ch === "*") pattern += "[^]*";
    else if (ch === "?") pattern += "[^]";
    else if (REGEX_SPECIAL.includes(ch)) pattern += BACKSLASH + ch;
    else pattern += ch;
  }
  return new RegExp("^" + pattern + "$").test(url);
}

const isAllowed = (url) => openerAllowGlobs().some((g) => globMatches(g, url));

describe("opener capability scope", () => {
  test("grants a non-empty URL allow-list", () => {
    // The regression itself: `opener:allow-open-url` alone leaves the
    // allow-list empty, which denies every URL rather than permitting them.
    const globs = openerAllowGlobs();
    assert.ok(globs.length > 0, "opener:allow-open-url has no scope — every URL will be denied");
  });

  test("allows every scheme the app actually opens", () => {
    // main.ts opens http/https/mailto/tel from document links and file:// for a
    // sibling that is not Markdown; update.ts opens the releases page.
    for (const url of [
      "https://github.com/scrypt-kitty/parchment/releases/latest",
      "http://example.com/page",
      "mailto:someone@example.com",
      "tel:+15555550123",
      "file:///home/user/docs/diagram.png",
      "file://C:/Users/user/docs/diagram.png",
    ]) {
      assert.ok(isAllowed(url), "capability does not allow " + url);
    }
  });

  test("still denies a scheme the app never opens", () => {
    // Proves the matcher discriminates rather than waving everything through.
    assert.equal(isAllowed("ftp://example.com/file"), false);
    assert.equal(isAllowed("javascript:alert(1)"), false);
  });

  test("scope covers every scheme main.ts hands to openUrl", () => {
    // Drift guard: add a scheme to the link handler without scoping it and that
    // link becomes a dead click. Fail here rather than in someone's hands.
    const line = read("src/main.ts")
      .split("\n")
      .find((l) => l.includes(".test(href)") && l.includes("openUrl"));
    assert.ok(line, "could not find the link-scheme guard in main.ts — update this test");

    const body = line.slice(line.indexOf("(/") + 2, line.indexOf("/i."));
    const schemes = body.split("|").map((alt) => {
      const noAnchor = alt.startsWith("^") ? alt.slice(1) : alt;
      return noAnchor.split(":").join("").split("?").join("");
    });
    assert.ok(schemes.length > 0, "parsed no schemes out of main.ts");

    for (const scheme of schemes) {
      const probe =
        scheme === "mailto"
          ? "mailto:a@b.co"
          : scheme === "tel"
            ? "tel:+15555550123"
            : "https://example.com/x";
      assert.ok(isAllowed(probe), "main.ts opens " + scheme + ": but the capability does not allow it");
    }
  });
});
