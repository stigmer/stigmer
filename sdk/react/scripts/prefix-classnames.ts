/**
 * One-shot migration codemod for stigmer/stigmer#454: rewrite every Tailwind
 * utility token authored in @stigmer/react source to carry the `stg:` prefix
 * (`flex` → `stg:flex`), so the built stylesheet emits `.stg\:flex`-shaped
 * selectors that can never collide with a host application's own Tailwind
 * classes.
 *
 * Design principles:
 *
 * - **No regex guessing.** A token is rewritten only if Tailwind's own design
 *   system (loaded with this package's real theme context: the `@theme inline`
 *   block, `@utility` definitions, and `@custom-variant dark` from
 *   `src/styles.css`) parses it as a utility candidate that produces CSS.
 *   The sole exceptions are the `group`/`peer` marker classes (and their
 *   `group/name` forms), which produce no CSS themselves but must be prefixed
 *   because prefixed variants emit `:where(.stg\:group)`-shaped selectors.
 *
 * - **Context-restricted, two tiers.** Tier 1 auto-rewrites string literals in
 *   known class-bearing positions: `className` (and `*ClassName`) JSX
 *   attributes and object properties, `*Classes`/`*_CLASSES` variable
 *   initializers and properties, and arguments of `cn(...)` calls (recursing
 *   through ternaries, `&&`/`||`/`??`, arrays, and template literals). Tier 2
 *   catches class strings *outside* those positions with a strict rule —
 *   every whitespace token must validate — and is gated behind `--tier2`
 *   after a dry-run review.
 *
 * - **Flag, never guess, at interpolation boundaries.** Inside template
 *   literals only whitespace-delimited tokens are rewritten; any fragment
 *   touching a `${...}` boundary is reported for manual review.
 *
 * Usage (from sdk/react/):
 *   npx tsx scripts/prefix-classnames.ts --check     # GUARD: fail on drift
 *   npx tsx scripts/prefix-classnames.ts --dry-run   # report only
 *   npx tsx scripts/prefix-classnames.ts             # tier 1 rewrite
 *   npx tsx scripts/prefix-classnames.ts --tier2     # tier 1 + tier 2 rewrite
 *
 * `--check` is the PERMANENT guard (wired into `npm run lint`): on a fully
 * migrated tree it must find nothing to rewrite and no tier-2 candidates, so
 * any unprefixed Tailwind utility creeping into SDK source fails CI with the
 * exact file, line, and token. The migration and the guard share one
 * detection implementation on purpose — they can never drift apart.
 *
 * The migration's completeness proof was external to this script: a parity
 * check comparing the utility set of the pre-migration build against the
 * prefix-stripped utility set of the post-migration build (recorded in the
 * #454 PR).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- internal API, stable enough for a one-shot migration tool
import { __unstable__loadDesignSystem } from "tailwindcss";

const PREFIX = "stg:";
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(sdkRoot, "src");

const checkMode = process.argv.includes("--check");
const dryRun = process.argv.includes("--dry-run") || checkMode;
const tier2Enabled = process.argv.includes("--tier2");

// ---------------------------------------------------------------------------
// Design system: theme.css + utilities.css + this package's own theme context
// (custom variants, @theme inline, @utility) extracted from src/styles.css.
// Loaded WITHOUT a prefix — we validate the unprefixed token, then prepend.
// ---------------------------------------------------------------------------

function loadStylesContext(): string {
  const stylesCss = readFileSync(join(srcRoot, "styles.css"), "utf8");
  // Drop @source/@import lines (the design system gets theme/utilities content
  // directly below; token/xyflow imports are irrelevant to candidate parsing).
  return stylesCss
    .split("\n")
    .filter((line) => !/^\s*@(source|import)\b/.test(line))
    .join("\n");
}

async function loadDesignSystem() {
  const twDir = dirname(require.resolve("tailwindcss/package.json"));
  const theme = readFileSync(join(twDir, "theme.css"), "utf8");
  const utilities = readFileSync(join(twDir, "utilities.css"), "utf8");
  // tw-animate-css is part of the SDK build (see styles.css), so its
  // utilities (`animate-in`, `fade-in`, ...) must validate as candidates.
  // tw-animate-css exports only a `style` condition, which Node's resolver
  // cannot follow — locate it inside the same node_modules as tailwindcss.
  const twAnimate = readFileSync(
    join(dirname(twDir), "tw-animate-css", "dist", "tw-animate.css"),
    "utf8",
  );
  return __unstable__loadDesignSystem(
    `${theme}\n${utilities}\n${twAnimate}\n${loadStylesContext()}`,
  );
}

type DesignSystem = Awaited<ReturnType<typeof loadDesignSystem>>;

// ---------------------------------------------------------------------------
// Token classification
// ---------------------------------------------------------------------------

/** `group`, `group/name`, `peer`, `peer/name` — CSS-less marker classes that
 * prefixed variants nonetheless resolve against (`:where(.stg\:group)`). */
function isMarkerClass(token: string): boolean {
  return (
    token === "group" ||
    token === "peer" ||
    token.startsWith("group/") ||
    token.startsWith("peer/")
  );
}

const candidateCache = new Map<string, boolean>();

function isUtility(ds: DesignSystem, token: string): boolean {
  const cached = candidateCache.get(token);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    const css = ds.candidatesToCss([token]);
    result = css.length > 0 && css[0] !== null && css[0] !== "";
  } catch {
    result = false;
  }
  candidateCache.set(token, result);
  return result;
}

function shouldPrefix(ds: DesignSystem, token: string): boolean {
  if (token.startsWith(PREFIX)) return false; // idempotent re-runs
  return isMarkerClass(token) || isUtility(ds, token);
}

// ---------------------------------------------------------------------------
// String rewriting
// ---------------------------------------------------------------------------

interface RewriteStats {
  tokensPrefixed: number;
  literalsChanged: number;
  flagged: string[];
  tier2Hits: string[];
  /** file:line + literal for every would-be rewrite (populated in --check). */
  violations: string[];
}

/** Rewrite a whitespace-separated class list, preserving all whitespace. */
function rewriteClassList(
  ds: DesignSystem,
  text: string,
  stats: RewriteStats,
): string {
  return text.replace(/\S+/g, (token) => {
    if (shouldPrefix(ds, token)) {
      stats.tokensPrefixed++;
      return PREFIX + token;
    }
    return token;
  });
}

/**
 * Tier 2 qualification: a string literal OUTSIDE known class contexts is
 * treated as a class list only when every token validates (utility, marker,
 * or already prefixed) and the string doesn't look like prose or an
 * identifier — at least one token must contain `-`, `:`, `[`, or `/`, or the
 * string must contain 2+ tokens that are all utilities.
 */
function qualifiesAsTier2(ds: DesignSystem, text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // A single fully-bracketed token is NOT sufficient evidence of a class
  // string: Tailwind's arbitrary-property syntax makes almost any `[a:b]`
  // string parse as a utility, which false-positives on console log tags
  // (`"[stgm:perf:keys]"`) and CSS attribute selectors (`"[class*=...]"`).
  if (tokens.length === 1 && /^\[.*\]$/.test(tokens[0])) return false;
  const allValid = tokens.every(
    (t) => t.startsWith(PREFIX) || isMarkerClass(t) || isUtility(ds, t),
  );
  if (!allValid) return false;
  // Only a candidate if rewriting would actually change something —
  // fully-prefixed strings are already conformant, not drift.
  if (!tokens.some((t) => shouldPrefix(ds, t))) return false;
  const hasStructuralToken = tokens.some((t) => /[-:[/]/.test(t));
  return hasStructuralToken || tokens.length >= 2;
}

// ---------------------------------------------------------------------------
// AST context detection
// ---------------------------------------------------------------------------

function isClassBearingName(name: string): boolean {
  return (
    name === "className" ||
    name.endsWith("ClassName") ||
    name.endsWith("Classes") ||
    name.endsWith("_CLASSES") ||
    name === "CLASSES"
  );
}

/**
 * Explicit suppression: a comment containing `prefix-classnames-ignore` on
 * the enclosing statement (or any ancestor up to it) exempts its strings from
 * BOTH rewriting and the `--check` guard. For the rare literals that look
 * like utilities but are not CSS classes at all — the `VisualClass`
 * node-shape taxonomy (`"container"`), and the host-simulation class strings
 * in `styles-host-isolation.layout.test.tsx`, which must stay unprefixed to
 * mean anything.
 */
function isSuppressed(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const text = sourceFile.getFullText();
  let current: ts.Node | undefined = node;
  // Walk the full ancestor chain: a marker on ANY enclosing construct
  // (statement, function, class) suppresses everything inside it. Stopping
  // at the innermost statement would miss function-level markers — a string
  // in a JSX return sits inside a ReturnStatement, while the marker comment
  // leads the enclosing FunctionDeclaration.
  while (current && !ts.isSourceFile(current)) {
    const ranges = ts.getLeadingCommentRanges(text, current.getFullStart());
    if (
      ranges?.some((r) => text.slice(r.pos, r.end).includes("prefix-classnames-ignore"))
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Is this node a string-ish literal in a Tier 1 class-bearing position? */
function inTier1Context(node: ts.Node): boolean {
  let current: ts.Node = node;
  let parent = current.parent;
  while (parent) {
    // className="..."  /  contentClassName={cond ? "..." : "..."}
    if (ts.isJsxAttribute(parent)) {
      const name = parent.name.getText();
      return isClassBearingName(name);
    }
    // { className: "..." }  /  { rowClasses: "..." }
    if (ts.isPropertyAssignment(parent) && parent.initializer !== undefined) {
      // Only when the literal is (part of) the VALUE, not a computed key.
      if (parent.name === current) return false;
      const name = ts.isIdentifier(parent.name)
        ? parent.name.text
        : ts.isStringLiteral(parent.name)
          ? parent.name.text
          : "";
      if (isClassBearingName(name)) return true;
      // Not class-named: keep walking up (the object may itself sit inside
      // a cn() call or a className attribute).
    }
    // const labelClasses = "..."
    if (ts.isVariableDeclaration(parent) && parent.initializer !== undefined) {
      if (ts.isIdentifier(parent.name) && isClassBearingName(parent.name.text)) {
        return true;
      }
    }
    // cn("...", cond && "...", [ ... ])
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (calleeName === "cn") return true;
      // Other calls end the walk: a string argument to some other function is
      // not a class context (unless caught by an outer context, which cannot
      // happen through a call boundary).
      return false;
    }
    // Transparent wrappers we walk through.
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isBinaryExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isAsExpression(parent)
    ) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-file processing
// ---------------------------------------------------------------------------

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

function processFile(
  ds: DesignSystem,
  filePath: string,
  stats: RewriteStats,
): boolean {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits: Edit[] = [];
  const rel = relative(sdkRoot, filePath);

  function handleLiteralText(
    node: ts.Node,
    text: string,
    quoteStart: number,
    tier1: boolean,
  ): void {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!tier1) {
      if (!tier2Enabled) {
        if (qualifiesAsTier2(ds, text)) {
          stats.tier2Hits.push(`${rel}:${line}: ${JSON.stringify(text)}`);
        }
        return;
      }
      if (!qualifiesAsTier2(ds, text)) return;
      stats.tier2Hits.push(`${rel}:${line}: ${JSON.stringify(text)}`);
    }
    const rewritten = rewriteClassList(ds, text, stats);
    if (rewritten !== text) {
      stats.literalsChanged++;
      stats.violations.push(`${rel}:${line}: ${JSON.stringify(text)}`);
      edits.push({
        start: quoteStart,
        end: quoteStart + text.length,
        replacement: rewritten,
      });
    }
  }

  function handleTemplateChunk(
    node: ts.Node,
    text: string,
    textStart: number,
    tier1: boolean,
    touchesStart: boolean,
    touchesEnd: boolean,
  ): void {
    if (!tier1) return; // tier 2 never applies inside template chunks
    // Split into tokens; tokens touching an interpolation boundary without
    // intervening whitespace are fragments — flag them instead of rewriting.
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    let out = "";
    let changed = false;
    const parts = text.split(/(\s+)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (/^\s*$/.test(part)) {
        out += part;
        continue;
      }
      const isFirst = i === 0;
      const isLast = i === parts.length - 1;
      if ((isFirst && touchesStart) || (isLast && touchesEnd)) {
        if (part.length > 0) {
          stats.flagged.push(
            `${rel}:${line}: template fragment touching \${} boundary: ${JSON.stringify(part)}`,
          );
        }
        out += part;
        continue;
      }
      if (shouldPrefix(ds, part)) {
        stats.tokensPrefixed++;
        out += PREFIX + part;
        changed = true;
      } else {
        out += part;
      }
    }
    if (changed) {
      stats.literalsChanged++;
      stats.violations.push(`${rel}:${line}: ${JSON.stringify(text)} (template)`);
      edits.push({ start: textStart, end: textStart + text.length, replacement: out });
    }
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      isSuppressed(node, sourceFile)
    ) {
      return;
    }
    if (ts.isStringLiteral(node)) {
      handleLiteralText(node, node.text, node.getStart() + 1, inTier1Context(node));
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      handleLiteralText(node, node.text, node.getStart() + 1, inTier1Context(node));
    } else if (ts.isTemplateExpression(node)) {
      const tier1 = inTier1Context(node);
      // Head: `text${  — end touches an interpolation.
      const head = node.head;
      handleTemplateChunk(
        node,
        head.text,
        head.getStart() + 1,
        tier1,
        /* touchesStart */ false,
        /* touchesEnd */ true,
      );
      node.templateSpans.forEach((span, idx) => {
        const lit = span.literal;
        const isTail = idx === node.templateSpans.length - 1 && ts.isTemplateTail(lit);
        handleTemplateChunk(
          node,
          lit.text,
          lit.getStart() + 1,
          tier1,
          /* touchesStart */ true,
          /* touchesEnd */ !isTail,
        );
      });
      // Spans' expressions still need visiting (nested literals).
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (edits.length === 0 || dryRun) return edits.length > 0;

  // Apply bottom-up so offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let output = sourceText;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  writeFileSync(filePath, output);
  return true;
}

// ---------------------------------------------------------------------------
// Walk + report
// ---------------------------------------------------------------------------

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const require = (await import("node:module")).createRequire(import.meta.url);

const ds = await loadDesignSystem();
const stats: RewriteStats = {
  tokensPrefixed: 0,
  literalsChanged: 0,
  flagged: [],
  tier2Hits: [],
  violations: [],
};

const files = collectFiles(srcRoot);
let filesChanged = 0;
for (const file of files) {
  if (processFile(ds, file, stats)) filesChanged++;
}

if (checkMode) {
  const problems = [
    ...stats.violations.map((v) => `unprefixed utility: ${v}`),
    ...stats.tier2Hits.map((v) => `unprefixed class string (tier 2): ${v}`),
    ...stats.flagged,
  ];
  if (problems.length > 0) {
    console.error(
      `prefix-classnames --check: ${problems.length} problem(s).\n` +
        `Every Tailwind utility in @stigmer/react source must carry the ` +
        `\`stg:\` prefix (stigmer/stigmer#454 isolation contract).\n` +
        `Fix by hand or run: npx tsx scripts/prefix-classnames.ts --tier2\n`,
    );
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log(
    `prefix-classnames --check: OK (${files.length} files, no unprefixed utilities)`,
  );
  process.exit(0);
}

console.log(`mode: ${dryRun ? "dry-run" : "write"}${tier2Enabled ? " +tier2" : ""}`);
console.log(`files scanned: ${files.length}`);
console.log(`files with rewrites: ${filesChanged}`);
console.log(`literals changed: ${stats.literalsChanged}`);
console.log(`tokens prefixed: ${stats.tokensPrefixed}`);
if (stats.tier2Hits.length > 0) {
  console.log(`\ntier-2 candidates (${stats.tier2Hits.length})${tier2Enabled ? " [REWRITTEN]" : " [NOT rewritten — review, then re-run with --tier2]"}:`);
  for (const hit of stats.tier2Hits) console.log("  " + hit);
}
if (stats.flagged.length > 0) {
  console.log(`\nflagged for manual review (${stats.flagged.length}):`);
  for (const f of stats.flagged) console.log("  " + f);
}
