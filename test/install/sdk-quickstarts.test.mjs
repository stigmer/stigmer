// Holds what the language SDKs' pages show a developer about keys. Run via
// `npm run test:scripts`.
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
import { fileURLToPath } from "node:url";

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
