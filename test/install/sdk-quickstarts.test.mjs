// Holds what the language SDKs' pages show a developer: the quick start and
// the key. Run via `npm run test:scripts`.
//
// Each of the Go, Python and Java quick starts is one runnable file
// (sdk/go/examples/quickstart/main.go, sdk/python/examples/quickstart.py,
// sdk/java/examples/Quickstart.java), which smoke-sdk-quickstarts.mjs runs
// against `stigmer up`. Its README's "Quick Start" and its SDK page's "Run an
// agent" show it, and are pinned here byte-equal to it, so the code a
// developer copies is the code that ran.
//
// Stigmer issues API keys that start with `stk_`
// (backend/services/stigmer-server/src/domain/apikey/keymaterial.ts), and its
// verifier claims no other shape. An example, doc comment or test value that
// reads `sk_live_…` teaches a key Stigmer never issues; a reader who pastes a
// real key over it learns nothing, and one who searches for the shape finds
// someone else's product. The sweep reads every tracked file under `sdk/` and
// `docs/` and the root README, generated reference pages included (they are
// fixed at their source comment and regenerated), and names each hit.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { firstFence } from "./lib/doc-steps.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** `sk_` at the start of a token: `"sk_live_…"`, `` `sk_` ``, never `task_` or `stk_`. */
const STRIPE_SHAPED_KEY = "(^|[^A-Za-z0-9_])sk_";

/** Every `path:line: text` in the tracked text files whose line matches `pattern` (`-I`: a binary file is never a hit). */
function trackedHits(pattern, pathspecs) {
  try {
    return execFileSync("git", ["grep", "-InE", pattern, "--", ...pathspecs], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if (error.status === 1) return [];
    throw error;
  }
}

test("SDK-02 no example shows a key Stigmer never issues", () => {
  const hits = trackedHits(STRIPE_SHAPED_KEY, ["sdk", "docs", "README.md"]);
  assert.deepEqual(hits, [], `keys read "stk_…"; these lines show another shape:\n${hits.join("\n")}`);
});

const read = (path) => readFileSync(`${ROOT}${path}`, "utf8");

const QUICK_STARTS = [
  { name: "Go", language: "go", file: "sdk/go/examples/quickstart/main.go", readme: "sdk/go/README.md", page: "docs/sdk/go.mdx" },
  { name: "Python", language: "python", file: "sdk/python/examples/quickstart.py", readme: "sdk/python/README.md", page: "docs/sdk/python.mdx" },
  { name: "Java", language: "java", file: "sdk/java/examples/Quickstart.java", readme: "sdk/java/README.md", page: "docs/sdk/java.mdx" },
];

for (const quickStart of QUICK_STARTS) {
  test(`the ${quickStart.name} README's quick start and the SDK page's "Run an agent" are the quick start file`, () => {
    const file = read(quickStart.file);
    assert.equal(firstFence(read(quickStart.readme), "Quick Start", quickStart.language), file, `${quickStart.readme} "Quick Start" differs from ${quickStart.file}`);
    assert.equal(firstFence(read(quickStart.page), "Run an agent", quickStart.language), file, `${quickStart.page} "Run an agent" differs from ${quickStart.file}`);
  });
}
