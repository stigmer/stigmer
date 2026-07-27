/**
 * Drift-locks between a docs listing and the tour fixture that depicts it.
 *
 * Some tour embeds sit directly under a docs code fence with the promise
 * "here's how this looks in the console" — the depiction is only honest while
 * the fixture and the listing are the same bytes. This suite pins each such
 * pair, the same class of lock as `verify-scenar-tours.mjs` invariant 7
 * (replica CSS ↔ real console layout): edit one side and the root test suite
 * (`npm test` → `node --test scripts/*.test.mjs`) fails until the other side
 * moves with it.
 *
 * Pairs are keyed on fence *content* (a marker string), never fence position,
 * so docs restructuring cannot silently re-point a lock at the wrong listing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

test("skills.mdx SKILL.md listing matches skill-detail-tour's SKILL_MD byte for byte", async () => {
  // Import the tour timeline exactly the way the verify gate and `scenar
  // narrate` do — plain Node with the tsx loader.
  const { register } = await import("tsx/esm/api");
  register();
  const steps = await import(
    pathToFileURL(join(root, "demos/tours/skill-detail-tour/steps.ts")).href
  );

  const listing = extractFence("docs/concepts/skills.mdx", "name: return-policy");
  assert.equal(
    steps.SKILL_MD,
    listing,
    "docs/concepts/skills.mdx's SKILL.md fence and skill-detail-tour's SKILL_MD " +
      "have drifted — the embed sits directly under the listing, so they must " +
      "stay byte-identical. Update both together.",
  );
});
