/**
 * Update-check and recent-files tests.
 *
 * Both modules read localStorage and `update.ts` reaches for Tauri APIs at
 * import time, so setup.mjs is imported first to install the shared DOM and
 * Tauri stub.
 */
import assert from "node:assert/strict";

import "./setup.mjs";
import { describe, test } from "./runner.mjs";

const update = await import("../src/update.ts");
const recent = await import("../src/recent.ts");

describe("version comparison", () => {
  test("detects a newer patch, minor, and major", () => {
    assert.equal(update.isNewer("1.0.2", "1.0.1"), true);
    assert.equal(update.isNewer("1.1.0", "1.0.9"), true);
    assert.equal(update.isNewer("2.0.0", "1.9.9"), true);
  });

  test("treats an identical version as up to date", () => {
    assert.equal(update.isNewer("1.0.1", "1.0.1"), false);
  });

  test("never offers a downgrade", () => {
    assert.equal(update.isNewer("1.0.0", "1.0.1"), false);
    assert.equal(update.isNewer("0.9.9", "1.0.0"), false);
  });

  test("tolerates a leading v on either side", () => {
    assert.equal(update.isNewer("v1.0.2", "1.0.1"), true);
    assert.equal(update.isNewer("v1.0.1", "v1.0.1"), false);
  });

  test("compares numerically, not lexically", () => {
    // The bug this guards: "1.0.10" < "1.0.9" as strings.
    assert.equal(update.isNewer("1.0.10", "1.0.9"), true);
    assert.equal(update.isNewer("1.10.0", "1.9.0"), true);
  });

  test("ignores a prerelease suffix on the release tag", () => {
    assert.equal(update.isNewer("1.0.2-beta.1", "1.0.1"), true);
    assert.equal(update.isNewer("1.0.1-rc.1", "1.0.1"), false);
  });

  test("handles a short or malformed version without throwing", () => {
    assert.equal(update.isNewer("2", "1.0.0"), true);
    assert.equal(update.isNewer("", "1.0.0"), false);
  });
});

describe("update preference", () => {
  test("is on when nothing has been stored", () => {
    localStorage.clear();
    assert.equal(update.isEnabled(), true);
  });

  test("turns off and back on", () => {
    update.setEnabled(false);
    assert.equal(update.isEnabled(), false);
    update.setEnabled(true);
    assert.equal(update.isEnabled(), true);
  });
});

describe("recent files", () => {
  test("records a document and returns it first", () => {
    localStorage.clear();
    recent.remember("/docs/a.md", "a.md");
    recent.remember("/docs/b.md", "b.md");
    assert.deepEqual(
      recent.list().map((e) => e.name),
      ["b.md", "a.md"],
    );
  });

  test("moves a repeat visit to the front without duplicating it", () => {
    localStorage.clear();
    recent.remember("/docs/a.md", "a.md");
    recent.remember("/docs/b.md", "b.md");
    recent.remember("/docs/a.md", "a.md");
    const paths = recent.list().map((e) => e.path);
    assert.deepEqual(paths, ["/docs/a.md", "/docs/b.md"]);
    assert.equal(new Set(paths).size, paths.length);
  });

  test("caps the history so it cannot grow without bound", () => {
    localStorage.clear();
    for (let i = 0; i < 40; i++) recent.remember(`/docs/${i}.md`, `${i}.md`);
    assert.ok(recent.list().length <= 12, `kept ${recent.list().length}`);
  });

  test("forgets a file that no longer opens", () => {
    localStorage.clear();
    recent.remember("/docs/gone.md", "gone.md");
    recent.remember("/docs/here.md", "here.md");
    recent.forget("/docs/gone.md");
    assert.deepEqual(
      recent.list().map((e) => e.name),
      ["here.md"],
    );
  });

  test("survives a corrupt stored value instead of throwing", () => {
    localStorage.setItem("parchment.recent", "{not json");
    assert.deepEqual(recent.list(), []);
    localStorage.setItem("parchment.recent", '[{"bogus":true}]');
    assert.deepEqual(recent.list(), []);
  });

  test("shortens long paths for display", () => {
    assert.equal(recent.shortenPath("/a/b/c/d/notes.md"), "…/d/notes.md");
    assert.equal(recent.shortenPath("/notes.md"), "notes.md");
  });
});

/* ------------------------------------------------------------ check() paths */

/** Installs a fetch stub for one call and returns a restore function. */
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

const ok = (tag) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ tag_name: tag }),
});

/** check() is async; the runner is synchronous, so results are resolved up
 *  front and asserted below. */
const outcomes = {};

localStorage.clear();
outcomes.newer = await (async () => {
  const restore = stubFetch(ok("v9.9.9"));
  try {
    return await update.check(true);
  } finally {
    restore();
  }
})();

localStorage.clear();
outcomes.same = await (async () => {
  const restore = stubFetch(ok("v1.0.1"));
  try {
    return await update.check(true);
  } finally {
    restore();
  }
})();

localStorage.clear();
outcomes.rateLimited = await (async () => {
  const restore = stubFetch(async () => ({ ok: false, status: 403 }));
  try {
    return await update.check(true);
  } finally {
    restore();
  }
})();

localStorage.clear();
outcomes.offline = await (async () => {
  const restore = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    return await update.check(true);
  } finally {
    restore();
  }
})();

localStorage.clear();
outcomes.garbage = await (async () => {
  const restore = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    return await update.check(true);
  } finally {
    restore();
  }
})();

localStorage.clear();
update.setEnabled(false);
outcomes.disabled = await update.check(false);
update.setEnabled(true);

localStorage.clear();
outcomes.throttled = await (async () => {
  const restore = stubFetch(ok("v9.9.9"));
  try {
    await update.check(false); // first automatic check records the timestamp
    return await update.check(false); // second should be skipped
  } finally {
    restore();
  }
})();

localStorage.clear();
outcomes.dismissed = await (async () => {
  const restore = stubFetch(ok("v9.9.9"));
  try {
    update.dismiss("9.9.9");
    return await update.check(false);
  } finally {
    restore();
  }
})();

describe("update check", () => {
  test("reports a newer release", () => {
    assert.equal(outcomes.newer.status, "available");
    assert.equal(outcomes.newer.latest, "9.9.9");
  });

  test("reports up to date when the tag matches", () => {
    assert.equal(outcomes.same.status, "up-to-date");
  });

  test("fails gracefully on a rate limit rather than throwing", () => {
    assert.equal(outcomes.rateLimited.status, "failed");
    assert.match(outcomes.rateLimited.reason, /403/);
  });

  test("fails gracefully when the network is unreachable", () => {
    assert.equal(outcomes.offline.status, "failed");
    assert.match(outcomes.offline.reason, /Could not reach GitHub/);
  });

  test("fails gracefully when the response has no tag", () => {
    assert.equal(outcomes.garbage.status, "failed");
  });

  test("makes no request at all when disabled", () => {
    // fetch was never stubbed here; a request would have thrown.
    assert.equal(outcomes.disabled.status, "skipped");
  });

  test("throttles automatic checks to one per interval", () => {
    assert.equal(outcomes.throttled.status, "skipped");
  });

  test("stays quiet about a version the user dismissed", () => {
    assert.equal(outcomes.dismissed.status, "skipped");
  });
});

describe("recent files rendering", () => {
  test("renders rows and hides itself when empty", () => {
    localStorage.clear();
    const host = document.createElement("div");

    recent.render(host, () => {});
    assert.equal(host.hidden, true, "hidden with no history");

    recent.remember("/docs/alpha.md", "alpha.md");
    recent.remember("/docs/beta.md", "beta.md");
    recent.render(host, () => {});
    assert.equal(host.hidden, false);
    assert.equal(host.querySelectorAll(".recent-row").length, 2);
    assert.match(host.textContent, /beta\.md/);
  });

  test("activating a row reports the path back", () => {
    localStorage.clear();
    recent.remember("/docs/alpha.md", "alpha.md");
    const host = document.createElement("div");
    let opened = null;
    recent.render(host, (path) => (opened = path));
    host.querySelector(".recent-row").dispatchEvent(new window.Event("click"));
    assert.equal(opened, "/docs/alpha.md");
  });

  test("clear empties the history", () => {
    recent.remember("/docs/x.md", "x.md");
    recent.clear();
    assert.deepEqual(recent.list(), []);
  });
});
