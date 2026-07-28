/**
 * Drift-locks between a docs listing and the tour fixture that depicts it.
 *
 * Some tour depictions — stills and embeds — sit directly under a docs code
 * fence with the promise "here's how this looks in the console"; the
 * depiction is only honest while the fixture and the listing agree. This
 * suite pins each such pair, the same class of lock as
 * `verify-scenar-tours.mjs` invariant 7 (replica CSS ↔ real console layout):
 * edit one side and the root test suite (`npm test` → `node --test
 * scripts/*.test.mjs`) fails until the other side moves with it.
 *
 * Two lock shapes, chosen by what the shapes allow: byte-identical when the
 * fence and the fixture are the same text (skills.mdx ↔ SKILL_MD), and
 * value-by-value when structured constants are quoted inside a larger
 * listing (review-payloads.mdx ↔ article-review.ts's gate identity).
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
      "have drifted — the tour's still sits directly under the listing, so they " +
      "must stay byte-identical. Update both together.",
  );
});

test("review-payloads.mdx workflow YAML matches article-review.ts's gate identity", async () => {
  const { register } = await import("tsx/esm/api");
  register();
  const identity = await import(
    pathToFileURL(join(root, "demos/tours/_shared/article-review.ts")).href
  );

  const listing = extractFence(
    "docs/guides/workflows/review-payloads.mdx",
    "name: editorial_review",
  );

  // The page quotes the gate's identity inside a larger task block, so this
  // lock is value-by-value, not byte-identical. Values are matched as whole
  // YAML lines (trimmed, list dash stripped) — a substring check would let a
  // drift like `article-diff` → `article-diff-v2` pass unnoticed. Its
  // boundary: the outcome *labels* ("Approve", "Request changes") are display
  // strings that never appear in the YAML and are not locked here — the
  // page's stills are their only depiction.
  const listingLines = listing
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""));
  const expected = [
    ["TASK_NAME", `name: ${identity.TASK_NAME}`],
    ["REVIEW_PROMPT", `prompt: "${identity.REVIEW_PROMPT}"`],
    ["UI_HINT", `ui_hint: ${identity.UI_HINT}`],
    ...identity.OUTCOMES.map((outcome) => [
      `outcome "${outcome.name}"`,
      `name: ${outcome.name}`,
    ]),
  ];
  for (const [what, expectedLine] of expected) {
    assert.ok(
      listingLines.includes(expectedLine),
      `docs/guides/workflows/review-payloads.mdx's editorial_review fence and ` +
        `demos/tours/_shared/article-review.ts have drifted: no line reads ` +
        `${JSON.stringify(expectedLine)} (${what}). The page's stills depict ` +
        `this exact gate — update both sides together.`,
    );
  }
});
