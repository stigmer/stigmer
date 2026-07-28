#!/usr/bin/env node

/**
 * Static verification gate for the Scenar tours in `demos/tours/` and the
 * docs pages that embed them.
 *
 * Eight invariants, each of which has already produced (or nearly produced)
 * a shipped defect:
 *
 * 1. DETERMINISM (scenar-cloud DD-006). A packed tour must render identical
 *    pixels on every replay and every video-export frame, so tour fixtures
 *    must never read the live clock. `Date.now()`, `Math.random()`, bare
 *    `new Date()`, and `new Date(...)` with non-literal arguments are
 *    forbidden under `demos/tours/`. The `@stigmer/react/test` `samples.*`
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
 * 4. TOUR BOUNDARIES. A tour may import from itself and from `_shared/`,
 *    never from another tour — and `_shared/` may never import from a tour.
 *    demos/README.md's hoisting rule ("hoist only when a second tour
 *    genuinely depicts the same thing") only works with this counterpart
 *    enforced: before ManagementShell was hoisted (2026-07), a second tour
 *    could have imported it straight out of sso-login-playback/ with CI
 *    fully green, silently coupling the two tours' lifecycles.
 *
 * 5. AUTHORED INSTANTS. Tours derive instants from the tour world's one
 *    clock — `SAMPLE_INSTANT` via `sampleInstant()`/`sampleDate()` from
 *    `@stigmer/react/test` — they never author their own. Components format
 *    dates in the reader's local time, and no UTC instant renders one
 *    calendar date in every zone (real offsets span 25 hours against a
 *    24-hour day), so which instants are safe to depict is decided once, at
 *    the anchor, against the reader offset window (READER_OFFSET_WINDOW
 *    below). A hand-written literal re-takes that decision ad hoc: the
 *    shipped "Discovered Jul 20" chip read "Jul 19" in Honolulu for exactly
 *    that reason. This check also closes two forms the determinism check
 *    deliberately leaves to it: `new Date(2026, 6, 20)` (LOCAL-time
 *    construction — a different instant in every zone) and `new Date(0)`
 *    (an epoch whose rendered date drifts inside the window).
 *
 * 6. SCALE FACTORS (scenar-cloud DD-008). One scale factor per rendered
 *    frame, owned by the viewport boundary: tours author content at real
 *    application metrics and never apply their own `zoom` (props, style
 *    objects, or CSS) or `transform: scale()`. Composed factors are what
 *    made the pre-2026-07 tours read as shrunken mockups instead of screen
 *    recordings — a single live frame composited four of them.
 *
 * 7. REPLICA METRICS. The `_shared` shells transcribe the real console
 *    sidebar's metrics; each REPLICA_METRIC_PAIRS entry pins one fact on
 *    both sides so drift in either direction fails here instead of
 *    shipping (the drift class that produced the 112px/10px sidebar whose
 *    "New Session" wrapped onto two lines).
 *
 * 8. STILL REFERENCES (docs-revamp DD-02). Every `<Still id="<scenario>/
 *    <shot>">` in `docs/**` must name a real `demos/tours/<scenario>/`
 *    whose steps.ts declares that `shot`, and must carry non-empty alt
 *    text (DD-01's text-fallback bar — MDX is never typechecked, so the
 *    component's required prop cannot enforce it). This check runs from
 *    both sides: ci.docs covers docs-only changes, ci.frontend covers
 *    demos-only changes — so removing a shot a page references fails CI
 *    exactly like referencing a shot that never existed. It is also what
 *    keeps a replaced tour alive: once a page's embed becomes a still,
 *    the `<Still>` id may be the tour's only reference in the repo, and
 *    deleting the "unused" tour would silently 404 the shipped image.
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
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { collectShotNames, findStepsArray } from "./tour-shots.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOURS_DIR = join(root, "demos", "tours");
const DOCS_DIR = join(root, "docs");

/**
 * Tours that shipped with step-0 interactions before the rule existed.
 * Emptied 2026-07-26: the five grandfathered Path-B playbacks were
 * re-choreographed (their step-0 `set_cursor` removed — the rendered
 * PulseHighlight chrome carries the attention cue). The set stays as the
 * mechanism so the rule reads the same, but its test asserts emptiness:
 * never add to it — fix the tour instead.
 */
export const KNOWN_STEP0_OFFENDERS = new Set([]);

function isLiteralArg(arg) {
  return (
    ts.isStringLiteral(arg) ||
    ts.isNumericLiteral(arg) ||
    ts.isNoSubstitutionTemplateLiteral(arg)
  );
}

/**
 * Scan one source file for live-clock reads.
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
            "Date.now() reads the live clock — derive from the tour world's " +
            "anchor instead: sampleInstant(deltaMs) from @stigmer/react/test " +
            "(DD-006)",
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
            "derive from the tour world's anchor instead: sampleDate(deltaMs) " +
            "from @stigmer/react/test (DD-006)",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/**
 * The reader offset window: the range of fixed UTC offsets across which a
 * depicted calendar date must render identically. UTC−11:00 (Midway,
 * American Samoa) through UTC+12:45 (Chatham Islands in southern winter)
 * covers every inhabited zone except Tongatapu (+13:00, ~100k) and
 * Kiritimati (+14:00, ~6k), which are documented as out of scope — real
 * offsets span 25 hours against a 24-hour day, so no instant can satisfy
 * them all.
 *
 * Fixed offsets rather than IANA zone names, deliberately: Chatham moves to
 * +13:45 in southern summer, which paired with Midway spans 24.75 hours and
 * makes the window unsatisfiable for part of the year. Fixed offsets keep
 * one rule that holds year-round, and need no Intl/ICU.
 *
 * The window is enforced where the one instant lives — `SAMPLE_INSTANT`'s
 * property test in `sdk/react/src/test/__tests__/samples.test.ts` mirrors
 * these boundaries — while this gate makes the anchor the *only* instant by
 * rejecting authored literals (check 5). Note the limits of the guarantee:
 * the window stabilises the rendered calendar date, not the format a
 * locale-unpinned formatter picks, and not a rendered time of day.
 */
export const READER_OFFSET_WINDOW = {
  /** UTC−11:00 — Midway, American Samoa. */
  westOffsetMinutes: -11 * 60,
  /** UTC+12:45 — Chatham Islands in southern winter. */
  eastOffsetMinutes: 12 * 60 + 45,
};

/**
 * A string that is exactly a full ISO-8601 instant: date, time, and an
 * explicit Z or offset. Deliberately NOT matched: date-only strings
 * ("2026-04-07") and instants embedded in prose ("exp 2026-04-18T13:00:00Z")
 * — both are displayed text that renders identically everywhere, and a bare
 * date is only hazardous once parsed, which the Date-construction rule
 * below forbids on its own. connect-tools-tour's tool-result JSON and the
 * Path-B playbacks' token-expiry labels are live examples of both.
 */
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** "UTC−11:00" / "UTC+12:45" for violation messages. */
function formatUtcOffset(offsetMinutes) {
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.trunc(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${offsetMinutes < 0 ? "\u2212" : "+"}${hh}:${mm}`;
}

const READER_WINDOW_LABEL = `${formatUtcOffset(READER_OFFSET_WINDOW.westOffsetMinutes)}\u2026${formatUtcOffset(READER_OFFSET_WINDOW.eastOffsetMinutes)}`;

/**
 * Scan one source file for authored instants: hand-written moments in time
 * that compete with the tour world's one clock (`SAMPLE_INSTANT`). Two
 * forms are flagged:
 *
 * - A string (or no-substitution template) literal that is *exactly* a full
 *   ISO-8601 instant, wherever it appears — a proto timestamp field, a
 *   `new Date(...)` argument, displayed text. Even an instant that happens
 *   to render safely today belongs on the anchor, so the fixture world
 *   moves together if the demo day is ever refreshed.
 * - A `Date` constructed from literal arguments — the complement of the
 *   determinism check, which owns the non-literal/zero-argument forms
 *   (those read the clock; these author an instant). `new Date(2026, 6, 20)`
 *   is LOCAL-time construction, a different instant in every zone;
 *   `new Date(0)` is an epoch whose rendered date drifts inside the window;
 *   `new Date("...")` authors the instant its argument spells.
 *
 * The remedy is always the same and every message names it: derive from the
 * anchor with `sampleInstant(deltaMs)` / `sampleDate(deltaMs)` from
 * `@stigmer/react/test`.
 *
 * @param sourceText file contents
 * @param fileName used only to select TS vs TSX parsing
 * @returns violation objects `{ line, reason }` (line is 1-based)
 */
export function findAuthoredInstants(sourceText, fileName = "module.ts") {
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

  const derive = (helper) =>
    `derive from the tour world's anchor instead: ${helper}(deltaMs) from ` +
    `@stigmer/react/test (date-stable across ${READER_WINDOW_LABEL})`;

  const visit = (node) => {
    // new Date(<literals>) — the forms the determinism check permits.
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      const args = node.arguments ?? [];
      if (args.length > 0 && args.every(isLiteralArg)) {
        let why;
        if (args.length > 1) {
          why =
            `new Date(${args.map((a) => a.getText(sourceFile)).join(", ")}) ` +
            "constructs from LOCAL time — a different instant in every zone";
        } else if (ts.isNumericLiteral(args[0])) {
          why = `new Date(${args[0].text}) is an epoch instant whose rendered date drifts across readers`;
        } else {
          why = `new Date(${args[0].getText(sourceFile)}) authors an instant`;
        }
        violations.push({ line: lineOf(node), reason: `${why} — ${derive("sampleDate")}` });
        return; // args are literals; nothing further to find inside
      }
    }

    // A literal that IS an instant (anchored full match, see ISO_INSTANT_RE).
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ISO_INSTANT_RE.test(node.text)
    ) {
      violations.push({
        line: lineOf(node),
        reason:
          `authored instant "${node.text}" — the tour world has one clock; ` +
          derive("sampleInstant"),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/**
 * Scan one source file under `demos/tours/` for imports that cross a tour
 * boundary. A tour may import from itself and from `_shared/`, never from
 * another tour; `_shared/` may never import from a tour. Relative imports
 * that escape `tours/` entirely are allowed (`_shared/stigmer-preview.tsx`
 * legitimately reaches the compiled SDK stylesheet), and bare package
 * specifiers are ignored. Covers static `import`, `export ... from`, and
 * dynamic `import("...")` — a static-only rule would be trivially bypassed.
 * Type-only imports are flagged like any other: the coupling is the same.
 *
 * @param sourceText file contents
 * @param tourRelativePath path relative to `demos/tours/`, POSIX separators
 *        (e.g. `"sso-login-playback/index.tsx"`)
 * @returns violation objects `{ line, reason }` (line is 1-based)
 */
/**
 * Scan one TS/TSX source file for authored scale factors — invariant 6.
 *
 * A screen recording has exactly one scale factor: the app lays out at real
 * size and the viewport boundary scales it. Any `zoom` prop or `zoom` style
 * property inside a tour composes a second factor and turns the depiction
 * back into a shrunken mockup (the pre-2026-07-26 tours composed up to four).
 * AST-based: `zoom` as a JSX attribute or an object-literal property is a
 * violation; the word appearing in comments or displayed strings is not.
 */
export function findScaleFactors(sourceText, fileName = "module.ts") {
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
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "zoom") {
      violations.push({
        line: lineOf(node),
        reason:
          "zoom prop authored in a tour — one scale factor per frame: author " +
          "at real metrics and let the viewport boundary scale (DD-008)",
      });
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "zoom"
    ) {
      violations.push({
        line: lineOf(node),
        reason:
          "zoom style property authored in a tour — one scale factor per " +
          "frame: author at real metrics and let the viewport boundary scale " +
          "(DD-008)",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/**
 * Scan one CSS file for authored scale factors — invariant 6's CSS half.
 * Comment-stripped line scan (tour CSS is plain hand-written CSS): a `zoom:`
 * declaration or a `transform: ... scale(...)` is a second scale factor.
 * (`text-transform` and animation keyframe rotations are not matched.)
 */
export function findCssScaleFactors(cssText) {
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const violations = [];
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(^|[^-\w])zoom\s*:/.test(line)) {
      violations.push({
        line: i + 1,
        reason:
          "zoom declaration authored in tour CSS — one scale factor per frame (DD-008)",
      });
    }
    if (/(^|[^-\w])transform\s*:[^;}]*\bscale\(/.test(line)) {
      violations.push({
        line: i + 1,
        reason:
          "transform: scale() authored in tour CSS — one scale factor per frame (DD-008)",
      });
    }
  }
  return violations;
}

/**
 * Replica-metrics tripwire — invariant 7.
 *
 * The tour shells transcribe the real console sidebar's metrics (280px
 * `w-70`, 14px `text-sm` rows). Each pair names one fact on both sides;
 * if either side stops containing its needle, the replica and the console
 * have drifted and the shells must be re-derived (then these needles
 * updated) — the drift this guards produced the shipped 112px/10px
 * caricature this rule replaced.
 */
export const REPLICA_METRIC_PAIRS = [
  {
    fact: "sidebar width (console `w-70` = 280px)",
    replica: "demos/tours/_shared/AppShell.css",
    replicaNeedle: "width: 280px",
    real: "client-apps/web/src/domain/_shared/layout/AppShell.tsx",
    realNeedle: '"w-70"',
  },
  {
    fact: "nav label size (console `text-sm` = 14px)",
    replica: "demos/tours/_shared/AppShell.css",
    replicaNeedle: "font-size: 14px",
    real: "client-apps/web/src/domain/_shared/layout/Sidebar.tsx",
    realNeedle: "text-sm font-medium",
  },
  {
    fact: "management sidebar width (console `w-70` = 280px)",
    replica: "demos/tours/_shared/ManagementShell.css",
    replicaNeedle: "width: 280px",
    real: "client-apps/web/src/domain/_shared/layout/AppShell.tsx",
    realNeedle: '"w-70"',
  },
  {
    fact: "management nav label size (console `text-sm` = 14px)",
    replica: "demos/tours/_shared/ManagementShell.css",
    replicaNeedle: "font-size: 14px",
    real: "client-apps/web/src/domain/_shared/layout/ManagementSidebar.tsx",
    realNeedle: "text-sm font-medium",
  },
  // SessionView renders the SDK's own SessionViewerLayout (scenar-cloud
  // DD-010), so the split and chip geometry need no pairs — there is no
  // replica. These two pin the geometry the demo still owns around it.
  {
    fact: "launcher column width (NewSessionViewer `max-w-2xl` = 42rem)",
    replica: "demos/tours/_shared/SessionView.css",
    replicaNeedle: "max-width: 42rem",
    real: "sdk/react/src/session/NewSessionViewer.tsx",
    realNeedle: "max-w-2xl",
  },
  {
    fact: "thread reading column (SessionViewer passes contentColumn=center)",
    replica: "demos/tours/_shared/SessionView.tsx",
    replicaNeedle: 'contentColumn="center"',
    real: "sdk/react/src/session/SessionViewer.tsx",
    realNeedle: 'contentColumn="center"',
  },
];

export function findCrossTourImports(sourceText, tourRelativePath) {
  const sourceFile = ts.createSourceFile(
    tourRelativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    tourRelativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];

  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const owner = tourRelativePath.split("/")[0];
  const fileDir = posix.dirname(tourRelativePath);

  const checkSpecifier = (specifierNode) => {
    const specifier = specifierNode.text;
    if (!specifier.startsWith(".")) return; // bare package specifier
    const resolved = posix.normalize(posix.join(fileDir, specifier));
    if (resolved.startsWith("..")) return; // escapes tours/ entirely
    const targetOwner = resolved.split("/")[0];
    if (targetOwner === owner || targetOwner === "_shared") return;
    violations.push({
      line: lineOf(specifierNode),
      reason:
        owner === "_shared"
          ? `_shared must not depend on a tour — "${specifier}" reaches into ` +
            `${targetOwner}/; invert the dependency (the tour imports from _shared)`
          : `imports across tours — "${specifier}" reaches into ${targetOwner}/; ` +
            `hoist the module to _shared/ instead (demos/README.md)`,
    });
  };

  const visit = (node) => {
    // import ... from "x" / export ... from "x" (export { y } has no specifier)
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier);
    }

    // dynamic import("x") with a literal specifier
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      checkSpecifier(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
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

/**
 * Extract every `<Still>` tag from MDX source, fence-stripped like
 * `extractScenarEmbedIds` (a documented usage example must never count).
 * Attributes come back raw — null when absent — so the caller owns the
 * failure policy and its messages. `selfClosing` is reported because the
 * markdown-export unwrap (site/src/lib/llms-pages.ts) only rewrites the
 * self-closing form: a `<Still …></Still>` would render on the site but
 * ship a dangling tag in every text export, which is exactly the drift
 * this gate exists to prevent.
 */
export function extractStills(mdxText) {
  const withoutCodeFences = mdxText.replace(/```[\s\S]*?```/g, "");
  const stills = [];
  const tagRe = /<Still\b([^>]*)>/g;
  for (const match of withoutCodeFences.matchAll(tagRe)) {
    const attrs = match[1];
    stills.push({
      id: attrs.match(/\bid="([^"]*)"/)?.[1] ?? null,
      alt: attrs.match(/\balt="([^"]*)"/)?.[1] ?? null,
      selfClosing: attrs.trimEnd().endsWith("/"),
    });
  }
  return stills;
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
  // Shot names per successfully-imported tour, harvested from the same
  // dynamic imports this check performs — check 8 resolves <Still> ids
  // against it. A tour that fails to import is absent, not empty: check 8
  // skips those instead of stacking a misleading "no such shot" on top of
  // the import failure reported here.
  const shotsByTour = new Map();
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
    shotsByTour.set(tour, new Set(collectShotNames(steps)));
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

  // --- 4. Tour boundaries: no imports across tours --------------------------
  const boundaryViolations = [];
  for (const file of sourceFiles) {
    const tourRelativePath = relative(TOURS_DIR, file).split(sep).join("/");
    for (const v of findCrossTourImports(readFileSync(file, "utf8"), tourRelativePath)) {
      boundaryViolations.push(`${relative(root, file)}:${v.line}: ${v.reason}`);
    }
  }
  if (boundaryViolations.length === 0) {
    console.log(`  ok  tour boundaries (${sourceFiles.length} source files)`);
  } else {
    fail("tour boundaries", boundaryViolations);
  }

  // --- 5. Authored instants: tours derive instants, they never author them --
  const instantViolations = [];
  for (const file of sourceFiles) {
    for (const v of findAuthoredInstants(readFileSync(file, "utf8"), file)) {
      instantViolations.push(`${relative(root, file)}:${v.line}: ${v.reason}`);
    }
  }
  if (instantViolations.length === 0) {
    console.log(`  ok  authored instants (${sourceFiles.length} source files)`);
  } else {
    fail("authored instants", instantViolations);
  }

  // --- 6. Scale factors: one per frame, owned by the viewport boundary ------
  const cssFiles = listFiles(TOURS_DIR, (name) => name.endsWith(".css"));
  const scaleViolations = [];
  for (const file of sourceFiles) {
    for (const v of findScaleFactors(readFileSync(file, "utf8"), file)) {
      scaleViolations.push(`${relative(root, file)}:${v.line}: ${v.reason}`);
    }
  }
  for (const file of cssFiles) {
    for (const v of findCssScaleFactors(readFileSync(file, "utf8"))) {
      scaleViolations.push(`${relative(root, file)}:${v.line}: ${v.reason}`);
    }
  }
  if (scaleViolations.length === 0) {
    console.log(
      `  ok  scale factors (${sourceFiles.length + cssFiles.length} source + css files)`,
    );
  } else {
    fail("scale factors", scaleViolations);
  }

  // --- 7. Replica metrics: the shells still match the console they mirror ---
  const replicaViolations = [];
  for (const pair of REPLICA_METRIC_PAIRS) {
    const replicaText = readFileSync(join(root, pair.replica), "utf8");
    const realText = readFileSync(join(root, pair.real), "utf8");
    if (!realText.includes(pair.realNeedle)) {
      replicaViolations.push(
        `${pair.real}: no longer contains ${JSON.stringify(pair.realNeedle)} — ` +
          `the console changed its ${pair.fact}; re-derive the tour shell ` +
          `metrics from it, then update REPLICA_METRIC_PAIRS`,
      );
    }
    if (!replicaText.includes(pair.replicaNeedle)) {
      replicaViolations.push(
        `${pair.replica}: no longer contains ${JSON.stringify(pair.replicaNeedle)} — ` +
          `the tour shell drifted from the console's ${pair.fact}`,
      );
    }
  }
  if (replicaViolations.length === 0) {
    console.log(`  ok  replica metrics (${REPLICA_METRIC_PAIRS.length} facts)`);
  } else {
    fail("replica metrics", replicaViolations);
  }

  // --- 8. Still references: every <Still> resolves to a declared shot -------
  const stillViolations = [];
  let stillCount = 0;
  for (const file of mdxFiles) {
    const rel = relative(root, file);
    for (const still of extractStills(readFileSync(file, "utf8"))) {
      stillCount += 1;
      const label = still.id === null ? "<Still>" : `<Still id="${still.id}">`;
      if (!still.selfClosing) {
        stillViolations.push(
          `${rel}: ${label} must be self-closing (<Still id="…" alt="…" />) — ` +
            `the markdown-export unwrap rewrites only that form, so this one ` +
            `would ship a dangling tag in llms-full.txt and the .md exports`,
        );
      }
      if (still.alt === null || still.alt.trim() === "") {
        stillViolations.push(
          `${rel}: ${label} has no alt text — a still must describe its screen ` +
            `for readers of the markdown exports (docs/STYLE.md; DD-01's ` +
            `text-fallback requirement)`,
        );
      }
      const idMatch = still.id === null ? null : /^([^/]+)\/([^/]+)$/.exec(still.id);
      if (!idMatch) {
        stillViolations.push(
          `${rel}: ${label} — id must be "<scenario>/<shot>": the tour directory ` +
            `under demos/tours/ and a shot name declared in its steps.ts`,
        );
        continue;
      }
      const [, scenario, shot] = idMatch;
      if (!shotsByTour.has(scenario)) {
        // An import failure in check 2 already reports the broken tour;
        // only a genuinely absent directory is this check's finding.
        if (!tourSet.has(scenario)) {
          stillViolations.push(
            `${rel}: ${label} — no demos/tours/${scenario}/. If that tour was ` +
              `"replaced" by this still, it must stay in the repo: the tour is ` +
              `the still's source scenario (docs/STYLE.md)`,
          );
        }
        continue;
      }
      const declared = shotsByTour.get(scenario);
      if (!declared.has(shot)) {
        stillViolations.push(
          `${rel}: ${label} — ${scenario} declares no shot "${shot}" ` +
            `(declared: ${[...declared].join(", ") || "none"}). Set ` +
            `shot: "${shot}" on the step to capture in ` +
            `demos/tours/${scenario}/steps.ts`,
        );
      }
    }
  }
  if (stillViolations.length === 0) {
    console.log(`  ok  still references (${stillCount} stills across docs/)`);
  } else {
    fail("still references", stillViolations);
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
