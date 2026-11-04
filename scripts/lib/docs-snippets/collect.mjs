/**
 * Collects the docs snippet gate's units: every TypeScript, Go, Python and
 * Java fence under `docs/`, classified, split at its hidden setup, with the
 * page's prelude and, for a TypeScript fence that imports a file the page
 * shows, that file's fence.
 *
 * What a fragment compiles against comes from three places, in order: the
 * gate's convention (the client in scope, preludes.mjs), the page's
 * `prelude` fences of its language (the imports the page shows once), and
 * the fence's own hidden setup (the lines above its `---cut---` marker,
 * split by the site's own function, so the gate and the page agree on what
 * the reader sees).
 *
 * Every line a unit carries keeps its page line, so a compile error names
 * the line a reader sees. A fence the gate cannot classify, a prelude with no
 * fragment to compile through, or a relative import no fence above provides
 * becomes a problem of its own, reported like a compile error at the fence.
 */

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { splitSnippetSetup } from "../../../site/src/lib/snippet-setup.mjs";

import { classify, fenceTitle, isGeneratedPage, scanFences, SOURCE_EXTENSIONS } from "./fences.mjs";

/**
 * A fence's text as page lines: each line with the page line it sits on.
 * @param {string} text the text, with or without a final newline
 * @param {number} firstLine the page line of its first line
 * @returns {{text: string, line: number}[]}
 */
export function pageLines(text, firstLine) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((t, i) => ({ text: t, line: firstLine + i }));
}

/**
 * @param {string} repoRoot
 * @param {string[]} pages repository-relative markdown paths
 */
export function collectUnits(repoRoot, pages) {
  const units = [];
  const skipped = [];
  const problems = [];
  let id = 0;

  for (const page of pages) {
    const src = readFileSync(join(repoRoot, page), "utf8");
    const result = collectPage(page, src, id);
    id += result.units.length;
    units.push(...result.units);
    skipped.push(...result.skipped);
    problems.push(...result.problems);
  }
  return { units, skipped, problems };
}

/**
 * One page's units, numbered from `firstId`. Pure: it reads only `src`.
 * @param {string} page
 * @param {string} src
 * @param {number} [firstId]
 */
export function collectPage(page, src, firstId = 0) {
  const units = [];
  const skipped = [];
  const problems = [];
  const generated = isGeneratedPage(src);
  let fences;
  try {
    fences = scanFences(page, src);
  } catch (err) {
    return { units, skipped, problems: [{ page, line: 0, message: err.message }] };
  }

  /** @type {Map<string, {text: string, line: number}[]>} */
  const preludes = new Map();
  const preludeAt = new Map();
  let id = firstId;
  for (const fence of fences) {
    const c = classify(fence);
    if (c === null) continue;
    const base = { page, line: fence.line, lang: fence.lang, language: c.language, generated };
    if (c.kind === "invalid") {
      problems.push({ page, line: fence.line, message: c.problem });
      continue;
    }
    if (c.kind === "skip") {
      skipped.push({ ...base, reason: c.reason, text: fence.body });
      continue;
    }
    if (c.kind === "prelude") {
      preludes.set(c.language, [...(preludes.get(c.language) ?? []), ...pageLines(fence.body, fence.line + 1)]);
      if (!preludeAt.has(c.language)) preludeAt.set(c.language, fence.line);
      continue;
    }
    let split;
    try {
      split = splitSnippetSetup(fence.lang, fence.body);
    } catch (err) {
      problems.push({ page, line: fence.line, message: err.message });
      continue;
    }
    const setup = split.hiddenLines === 0 ? [] : pageLines(split.setup, fence.line + 1);
    const body = pageLines(split.body, fence.line + 1 + split.hiddenLines);
    // Whether it is a whole program is read from what the reader sees: a
    // setup that declares a type does not make a fragment a file.
    const kind = classify({ ...fence, body: split.body }).kind;
    units.push({ ...base, id: id++, kind, title: fenceTitle(fence), text: fence.body, setup, body, prelude: [], siblings: [] });
  }

  for (const [language, lines] of preludes) {
    const fragments = units.filter((u) => u.language === language && u.kind === "fragment");
    if (fragments.length === 0) {
      problems.push({
        page,
        line: preludeAt.get(language),
        message: `this ${language} prelude has no ${language} fragment on the page to compile through: a prelude is the imports the page's examples share`,
      });
      continue;
    }
    for (const u of fragments) u.prelude = lines;
  }

  for (const u of units) {
    if (u.language !== "typescript") continue;
    for (const spec of relativeImports([...u.setup, ...u.body].map((l) => l.text).join("\n"))) {
      const sibling = siblingFor(units, u, spec);
      if (sibling === null) {
        problems.push({
          page,
          line: u.line,
          message: `imports "${spec}", but no TypeScript fence above it on this page is titled with that file`,
        });
        continue;
      }
      u.siblings.push({ path: sibling.path, id: sibling.unit.id });
    }
  }
  return { units, skipped, problems };
}

/** The relative module specifiers a TypeScript source imports or re-exports. */
export function relativeImports(source) {
  const specs = new Set();
  for (const m of source.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) specs.add(m[1]);
  return [...specs];
}

// The nearest fence above `unit` whose title is the file `spec` names,
// resolved from the unit's own title (or the page's root when it has none):
// `./client.js` names `client.ts` beside it, as a bundler resolves it.
function siblingFor(units, unit, spec) {
  const from = unit.title === "" ? "." : posix.dirname(unit.title);
  const target = posix.normalize(posix.join(from, spec)).replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/, "");
  const above = units.filter((u) => u.language === "typescript" && u.line < unit.line && u.title !== "");
  for (let i = above.length - 1; i >= 0; i--) {
    const title = posix.normalize(above[i].title);
    const stem = SOURCE_EXTENSIONS.typescript.reduce((t, ext) => (t.endsWith(ext) ? t.slice(0, -ext.length) : t), title);
    if (stem === target) return { unit: above[i], path: title };
  }
  return null;
}
