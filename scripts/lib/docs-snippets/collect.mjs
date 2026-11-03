/**
 * Collects the docs snippet gate's units: every TypeScript, Go, Python and
 * Java fence under `docs/`, classified, with its prelude resolved.
 *
 * A fence the gate cannot classify (an empty `no-compile=` reason, a
 * `compile=` naming no prelude) becomes a problem of its own, reported like a
 * compile error at the fence's line.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { classify, isGeneratedPage, scanFences } from "./fences.mjs";
import { preludeFor } from "./preludes.mjs";

/** Where a generator writes the preludes of the pages it generates, beside them. */
export const GENERATED_PRELUDES_FILE = "snippet-preludes.json";

/**
 * @param {string} repoRoot
 * @param {string[]} pages repository-relative markdown paths
 * @returns {{units: object[], skipped: object[], problems: {page: string, line: number, message: string}[]}}
 */
export function collectUnits(repoRoot, pages) {
  const units = [];
  const skipped = [];
  const problems = [];
  const generatedPreludes = new Map();
  let id = 0;

  for (const page of pages) {
    const src = readFileSync(join(repoRoot, page), "utf8");
    const generated = isGeneratedPage(src);
    const pagePreludes = generatedPreludesFor(repoRoot, page, generatedPreludes);
    let fences;
    try {
      fences = scanFences(page, src);
    } catch (err) {
      problems.push({ page, line: 0, message: err.message });
      continue;
    }
    for (const fence of fences) {
      const c = classify(fence);
      if (c === null) continue;
      const base = { page, line: fence.line, lang: fence.lang, language: c.language, generated };
      if (c.kind === "invalid") {
        problems.push({ page, line: fence.line, message: c.problem });
        continue;
      }
      if (c.kind === "skip") {
        skipped.push({ ...base, reason: c.reason });
        continue;
      }
      let prelude = null;
      let preludeName = null;
      if (c.kind === "fragment") {
        try {
          const resolved = preludeFor(page, c.language, c.prelude, pagePreludes?.[c.language]);
          prelude = resolved.prelude;
          preludeName = resolved.name;
        } catch (err) {
          problems.push({ page, line: fence.line, message: err.message });
          continue;
        }
      }
      units.push({ ...base, id: id++, kind: c.kind, prelude, preludeName, body: fence.body, meta: fence.meta });
    }
  }
  return { units, skipped, problems };
}

// A generated page's preludes, from the generator's file beside it (keyed by
// the page's file name), or undefined for a page no generator prelude covers.
function generatedPreludesFor(repoRoot, page, cache) {
  const dir = dirname(page);
  if (!cache.has(dir)) {
    const file = join(repoRoot, dir, GENERATED_PRELUDES_FILE);
    cache.set(dir, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
  }
  const table = cache.get(dir);
  if (table === null) return undefined;
  return table.pages?.[relative(dir, page)] ?? table.default;
}
