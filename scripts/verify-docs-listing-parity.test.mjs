/**
 * Drift-locks between a docs listing and the repository file it quotes.
 *
 * A guide that prints a file for the reader to save and build quotes the
 * file in the repository that a release lane builds, byte for byte
 * (runners.mdx ↔ deploy/runner-layer/Dockerfile, which
 * release.sandbox-cloud joins onto foreign bases on every change), so the
 * command the guide prints is the one proven to work. Edit one side and the
 * root test suite (`npm test` → `node --test scripts/*.test.mjs`) fails until
 * the other side moves with it.
 *
 * Pairs are keyed on fence *content* (a marker string), never fence position,
 * so docs restructuring cannot silently re-point a lock at the wrong listing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Extract the content of the unique fenced code block in `mdxPath` that
 * contains `marker`. Content excludes the fence lines themselves and carries
 * no trailing newline. Fails loudly on zero or multiple matches — a lock that
 * matches twice is not a lock.
 */
function extractFence(mdxPath, marker) {
  const source = readFileSync(join(root, mdxPath), "utf8");
  const fences = [...source.matchAll(/^```[^\n]*\n([\s\S]*?)\n```$/gm)].map(
    (m) => m[1],
  );
  const matches = fences.filter((content) => content.includes(marker));
  assert.equal(
    matches.length,
    1,
    `${mdxPath}: expected exactly one code fence containing ${JSON.stringify(marker)}, found ${matches.length}`,
  );
  return matches[0];
}

test("runners.mdx's runner layer Dockerfile is deploy/runner-layer/Dockerfile byte for byte", () => {
  const listing = extractFence(
    "docs/guides/self-hosting/runners.mdx",
    "COPY --from=runner-layer /runner /runner",
  );
  const file = readFileSync(join(root, "deploy/runner-layer/Dockerfile"), "utf8");
  assert.equal(
    listing,
    file.replace(/\n$/, ""),
    "docs/guides/self-hosting/runners.mdx's runner layer Dockerfile and " +
      "deploy/runner-layer/Dockerfile have drifted — the guide tells operators " +
      "to build that file, and the sandbox image lane builds the repository's " +
      "copy, so they must stay byte-identical. Update both together.",
  );
});
