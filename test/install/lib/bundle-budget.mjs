/**
 * The arithmetic of the library size budgets (test/bundle-budgets.json),
 * which test/install/smoke-budgets.mjs measures: what an entry makes an app
 * download at once, what weighs most in it, and how each figure stands
 * against its ceiling. Pure, so the rules are pinned by
 * bundle-budget.test.mjs without a bundler; plain Node, importing nothing,
 * as the install layer requires (test/README.md).
 *
 * A JavaScript entry is bundled as an app's bundler splits it, so what loads
 * at once (the entry's chunk and every chunk it imports statically) is apart
 * from what loads later (chunks reached only by a dynamic `import()`); the
 * budget holds the eager part, the lazy total is reported. Sizes are gzip
 * bytes.
 *
 * A bundle here is the chunk report the smoke's Vite build writes: per
 * chunk, its file, whether it is the entry, the chunks it imports
 * statically, and its modules (repository-relative ids) with the bytes
 * each renders into the chunk.
 */

/** How far under its ceiling an entry may fall before the smoke says to lower it. */
export const LOWER_NOTICE = 0.1;

/**
 * Reads the budgets file: `{ "budgets": { "<entry>": <gzip bytes>, ... } }`.
 * Returns the ceilings by entry, or throws with what is wrong.
 */
export function readBudgets(text) {
  const data = JSON.parse(text);
  const budgets = data?.budgets;
  if (budgets === null || typeof budgets !== "object" || Array.isArray(budgets)) {
    throw new Error("the budgets file is `{ \"budgets\": { \"<entry>\": <gzip bytes> } }`");
  }
  const out = new Map();
  for (const [entry, bytes] of Object.entries(budgets)) {
    if (!Number.isInteger(bytes) || bytes <= 0) throw new Error(`${entry}'s budget is ${JSON.stringify(bytes)}, not a positive whole number of gzip bytes`);
    out.set(entry, bytes);
  }
  return out;
}

/**
 * The chunks an entry loads at once: the entry chunk and every chunk it
 * reaches through static imports. `chunks` is the report's list; the result
 * is a set of their files. Throws when the report has no single entry.
 */
export function eagerChunks(chunks) {
  const entries = chunks.filter((chunk) => chunk.isEntry);
  if (entries.length !== 1) throw new Error(`the bundle has ${entries.length} entry chunks, not one`);
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !byFile.has(file)) return;
    seen.add(file);
    for (const imported of byFile.get(file).imports ?? []) visit(imported);
  };
  visit(entries[0].file);
  return seen;
}

/**
 * Where an input file's bytes are counted: a dependency by its package's
 * name (`mermaid`, `@base-ui/react`), a workspace source by its package and
 * first folder (`sdk/react/src/session`).
 */
export function ownerOf(input) {
  const parts = input.split("/");
  const at = parts.lastIndexOf("node_modules");
  if (at >= 0) {
    const name = parts[at + 1] ?? input;
    return name.startsWith("@") ? `${name}/${parts[at + 2] ?? ""}` : name;
  }
  const src = parts.indexOf("src");
  return src >= 0 ? parts.slice(0, Math.min(src + 2, parts.length - 1)).join("/") : parts.slice(0, -1).join("/") || input;
}

/**
 * The `count` owners that weigh most in the chunks named by `files`, heaviest
 * first: the bytes each owner's modules render into them, before minifying.
 * An owner that renders nothing (an entry that only re-exports) is left out.
 */
export function heaviest(chunks, files, count = 10) {
  const weight = new Map();
  for (const chunk of chunks) {
    if (!files.has(chunk.file)) continue;
    for (const [id, bytes] of Object.entries(chunk.modules ?? {})) {
      const owner = ownerOf(id);
      weight.set(owner, (weight.get(owner) ?? 0) + bytes);
    }
  }
  return [...weight].filter(([, bytes]) => bytes > 0).map(([owner, bytes]) => ({ owner, bytes })).sort((a, b) => b.bytes - a.bytes || a.owner.localeCompare(b.owner)).slice(0, count);
}

/** Bytes as a reader says them: `612.4 KB`, `980 B`. */
export function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Each measured entry against its ceiling. `over` and the two lists of
 * entries without a partner fail; `lower` are entries more than
 * LOWER_NOTICE under their ceiling, said, never failing.
 */
export function judgeBudgets(measured, budgets) {
  const over = [];
  const lower = [];
  for (const [entry, bytes] of measured) {
    const ceiling = budgets.get(entry);
    if (ceiling === undefined) continue;
    if (bytes > ceiling) over.push({ entry, bytes, ceiling });
    else if (bytes < ceiling * (1 - LOWER_NOTICE)) lower.push({ entry, bytes, ceiling });
  }
  return {
    over,
    lower,
    unbudgeted: [...measured.keys()].filter((entry) => !budgets.has(entry)),
    unmeasured: [...budgets.keys()].filter((entry) => !measured.has(entry)),
  };
}
