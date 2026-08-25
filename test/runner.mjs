/**
 * A very small test runner.
 *
 * Not `node:test`: the renderer needs a DOM in place before any test runs, and
 * node:test quietly drops suites registered after a top-level `await` on some
 * Node versions — which once reduced the renderer file to four of its tests
 * while still reporting success. This prints its own totals, so a silent drop
 * is visible.
 */

const suites = [];
let current = null;

export function describe(name, body) {
  current = { name, tests: [] };
  suites.push(current);
  body();
}

export function test(name, body) {
  if (!current) throw new Error(`test("${name}") called outside a describe block`);
  current.tests.push({ name, body });
}

/** Runs everything registered so far and exits with a non-zero code on failure. */
export function run() {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const { name, body } of suite.tests) {
      try {
        body();
        passed += 1;
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failures.push({ suite: suite.name, name, error });
        console.log(`  ✗ ${name}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const { suite, name, error } of failures) {
    console.log(`\n${suite} › ${name}\n${error.message}`);
  }
  process.exit(failures.length ? 1 : 0);
}
