#!/usr/bin/env node

/**
 * Static verification gate for the Scenar tours in `demos/tours/` and the
 * docs pages that embed them.
 *
 * Three invariants, each of which has already produced (or nearly produced)
 * a shipped defect:
 *
 * 1. DETERMINISM (scenar-cloud DD-006). A packed tour must render identical
 *    pixels on every replay and every video-export frame, so tour fixtures
 *    must never read the live clock. `Date.now()`, `Math.random()`, and
 *    non-literal `new Date(...)` are forbidden under `demos/tours/`;
 *    `new Date("2026-07-20T09:30:00Z")` with literal arguments is the
 *    blessed frozen-instant form. The `@stigmer/react/test` `samples.*`
 *    factories need no denylist here: they are frozen at `SAMPLE_INSTANT` by
 *    construction and their own suite (`sdk/react/src/test/__tests__/
 *    samples.test.ts`) locks that in, so a tour can call any of them freely.
 *
 * 2. TIMELINE SHAPE. Every `atPercent` must be within [0, 1], and step 0
 *    must carry no interactions — the packed embed arms step-0 interactions
 *    at mount (under the poster), so they fire before Play. Five tours
 *    ported from the docs site predate that rule and are grandfathered in
 *    KNOWN_STEP0_OFFENDERS below. (Captions no longer exist — @scenar/core
 *    0.5.0 removed the field — so narration is the only per-step prose.)
 *
 *    The timeline check dynamically imports each tour's `steps.ts` under the
 *    tsx loader — exactly how `scenar narrate` loads it — so it also proves
 *    the narrate import-discipline rule mechanically: a `steps.ts` that
 *    drags in browser-only modules fails here before it fails in narrate.
 *
 * 3. EMBED IDS RESOLVE. Every `<ScenarEmbed id="...">` in `docs/**` must
 *    name a real `demos/tours/<id>/` directory. Nothing else checks this at
 *    any layer — the component string-concatenates a URL, so a typo ships a
 *    blank iframe to production with CI fully green.
 *
 * Like scripts/verify-esm-node.mjs, checks are AST-based (TypeScript parser
 * via createRequire, no new dependency) rather than regex, so string
 * literals and comments can never be mistaken for code — e.g. the displayed
 * terminal text '`session-${Date.now()}`' in create-agent-tour is data, not
 * a clock read.
 *
 * Usage:
 *   node scripts/verify-scenar-tours.mjs
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOURS_DIR = join(root, "demos", "tours");
const DOCS_DIR = join(root, "docs");

/**
 * Tours that shipped with step-0 interactions before the rule existed — the
 * Path-B playbacks ported from the docs site. Their step-0 `set_cursor`
 * arms under the poster (the engine quirk the rule guards against), so they
 * are debt, not exceptions: remove an entry only by re-choreographing that
 * tour (move the cursor beat into step 1), never by adding to this set.
 */
export const KNOWN_STEP0_OFFENDERS = new Set([
  "authentication-flow-playback",
  "multi-tenant-setup-playback",
  "platform-client-token-flow",
  "provision-grant-playback",
  "sso-login-playback",
]);

function isLiteralArg(arg) {
  return (
    ts.isStringLiteral(arg) ||
    ts.isNumericLiteral(arg) ||
    ts.isNoSubstitutionTemplateLiteral(arg)
  );
}

/**
 * Scan one source file for live-clock reads and denylisted sample factories.
 * Returns violation objects: `{ line, reason }` (line is 1-based).
 */
export function findClockReads(sourceText, fileName = "module.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];

  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node) => {
    // Date.now() / Math.random()
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const obj = node.expression.expression.text;
      const method = node.expression.name.text;
      if (obj === "Date" && method === "now") {
        violations.push({
          line: lineOf(node),
          reason:
            "Date.now() reads the live clock — freeze the instant as a " +
            'literal, e.g. new Date("2026-07-20T09:30:00Z") (DD-006)',
        });
      } else if (obj === "Math" && method === "random") {
        violations.push({
          line: lineOf(node),
          reason:
            "Math.random() makes the tour render differently per replay — " +
            "use a fixed value (DD-006)",
        });
      }
    }

    // new Date() with no argument, or any non-literal argument
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      const args = node.arguments ?? [];
      if (args.length === 0 || !args.every(isLiteralArg)) {
        violations.push({
          line: lineOf(node),
          reason:
            "new Date(...) without literal arguments reads the live clock — " +
            'freeze the instant, e.g. new Date("2026-07-20T09:30:00Z") (DD-006)',
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/**
 * Find the timeline in a `steps.ts` module the same way `scenar pack` and
 * `scenar narrate` do: the first exported array whose first element carries
 * a `delayMs` key. Returns null when no export matches.
 */
export function findStepsArray(mod) {
  for (const val of Object.values(mod)) {
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      typeof val[0] === "object" &&
      val[0] !== null &&
      "delayMs" in val[0]
    ) {
      return val;
    }
  }
  return null;
}

/**
 * Validate a tour timeline's shape. Narration is deliberately NOT required:
 * silent steps are a design tool (sparse narration is common — a step can
 * ride the previous step's audio or its own delayMs).
 * Returns violation objects: `{ step, reason }`.
 */
export function validateTimeline(steps, { allowStep0Interactions = false } = {}) {
  const violations = [];

  steps.forEach((step, i) => {
    if (typeof step.delayMs !== "number" || step.delayMs < 0) {
      violations.push({
        step: i,
        reason: `delayMs is ${JSON.stringify(step.delayMs)} — must be a number >= 0`,
      });
    }
    const interactions = step.interactions ?? [];
    for (const [j, interaction] of interactions.entries()) {
      const at = interaction.atPercent;
      if (typeof at !== "number" || at < 0 || at > 1) {
        violations.push({
          step: i,
          reason: `interaction ${j}: atPercent is ${JSON.stringify(at)} — must be within [0, 1]`,
        });
      }
    }
    if (i === 0 && interactions.length > 0 && !allowStep0Interactions) {
      violations.push({
        step: 0,
        reason:
          `${interactions.length} interaction(s) on step 0 — the packed embed ` +
          "arms step-0 interactions at mount (under the poster), so they fire " +
          "before Play; move them to step 1",
      });
    }
  });

  return violations;
}

/**
 * Extract every `<ScenarEmbed id="...">` id from MDX source. Fenced code
 * blocks are stripped first so a documented usage example can never count
 * as a real embed. The tag may span lines (Prettier splits props), which
 * `[^>]*` accommodates since a character class matches newlines.
 */
export function extractScenarEmbedIds(mdxText) {
  const withoutCodeFences = mdxText.replace(/```[\s\S]*?```/g, "");
  const ids = [];
  const tagRe = /<ScenarEmbed\b([^>]*)>/g;
  for (const match of withoutCodeFences.matchAll(tagRe)) {
    const idMatch = match[1].match(/\bid="([^"]+)"/);
    if (idMatch) ids.push(idMatch[1]);
  }
  return ids;
}

function listFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "narration") continue;
      out.push(...listFiles(full, predicate));
    } else if (predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function listTourDirs() {
  return readdirSync(TOURS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => e.name)
    .sort();
}

async function main() {
  let total = 0;
  const fail = (label, details) => {
    total += details.length;
    console.log(`  FAIL ${label} (${details.length})`);
    for (const d of details) console.log(`       ${d}`);
  };

  console.log("\nverify-scenar-tours: checking demos/tours + docs embeds\n");

  // --- 1. Determinism: no live-clock reads anywhere under demos/tours ------
  const sourceFiles = listFiles(
    TOURS_DIR,
    (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
  );
  const clockViolations = [];
  for (const file of sourceFiles) {
    for (const v of findClockReads(readFileSync(file, "utf8"), file)) {
      clockViolations.push(`${relative(root, file)}:${v.line}: ${v.reason}`);
    }
  }
  if (clockViolations.length === 0) {
    console.log(`  ok  determinism (${sourceFiles.length} source files)`);
  } else {
    fail("determinism", clockViolations);
  }

  // --- 2. Timeline shape: import each steps.ts the way narrate does --------
  // tsx is registered programmatically (it is a root devDependency) so the
  // import path is byte-identical to `scenar narrate`'s plain-Node loader.
  const { register } = await import("tsx/esm/api");
  register();

  const tours = listTourDirs();
  const timelineViolations = [];
  for (const tour of tours) {
    const stepsPath = join(TOURS_DIR, tour, "steps.ts");
    if (!existsSync(stepsPath)) {
      timelineViolations.push(
        `${tour}: no steps.ts — narrate and pack both require it by that exact name`,
      );
      continue;
    }
    let mod;
    try {
      mod = await import(pathToFileURL(stepsPath).href);
    } catch (err) {
      timelineViolations.push(
        `${tour}: steps.ts failed to import under plain Node (tsx) — scenar ` +
          `narrate will fail the same way. Keep steps.ts to pure modules ` +
          `(protos, test samples, @scenar/react types): ${err.message}`,
      );
      continue;
    }
    const steps = findStepsArray(mod);
    if (!steps) {
      timelineViolations.push(
        `${tour}: no exported array with a delayMs-bearing first element — ` +
          `pack discovers the timeline by that shape`,
      );
      continue;
    }
    for (const v of validateTimeline(steps, {
      allowStep0Interactions: KNOWN_STEP0_OFFENDERS.has(tour),
    })) {
      timelineViolations.push(`${tour}: step ${v.step}: ${v.reason}`);
    }
  }
  if (timelineViolations.length === 0) {
    console.log(`  ok  timeline shape (${tours.length} tours)`);
  } else {
    fail("timeline shape", timelineViolations);
  }

  // --- 3. Embed ids: every <ScenarEmbed id> resolves to a real tour --------
  const mdxFiles = listFiles(DOCS_DIR, (name) => name.endsWith(".mdx"));
  const tourSet = new Set(tours);
  const embedViolations = [];
  let embedCount = 0;
  for (const file of mdxFiles) {
    for (const id of extractScenarEmbedIds(readFileSync(file, "utf8"))) {
      embedCount += 1;
      if (!tourSet.has(id)) {
        embedViolations.push(
          `${relative(root, file)}: <ScenarEmbed id="${id}"> has no ` +
            `demos/tours/${id}/ — this ships a blank iframe at ` +
            `https://stigmer.ai/demos/${id}/`,
        );
      }
    }
  }
  if (embedViolations.length === 0) {
    console.log(`  ok  embed ids (${embedCount} embeds across docs/)`);
  } else {
    fail("embed ids", embedViolations);
  }

  if (total > 0) {
    console.error(`\nverify-scenar-tours: FAIL — ${total} violation(s).\n`);
    process.exit(1);
  }
  console.log(`\nverify-scenar-tours: OK — ${tours.length} tours are clean.\n`);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
