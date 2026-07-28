import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findClockReads,
  findAuthoredInstants,
  findCrossTourImports,
  findScaleFactors,
  findCssScaleFactors,
  findStepsArray,
  validateTimeline,
  extractScenarEmbedIds,
  extractStills,
  collectShotNames,
  KNOWN_STEP0_OFFENDERS,
  READER_OFFSET_WINDOW,
  REPLICA_METRIC_PAIRS,
} from "./verify-scenar-tours.mjs";

// ---------------------------------------------------------------------------
// findClockReads
// ---------------------------------------------------------------------------

test("findClockReads flags Date.now(), Math.random(), and bare new Date()", () => {
  const source = [
    "const a = Date.now();",
    "const b = Math.random();",
    "const c = new Date();",
  ].join("\n");
  const violations = findClockReads(source);
  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map((v) => v.line),
    [1, 2, 3],
  );
});

test("findClockReads allows a frozen literal new Date(...)", () => {
  // Check 1 owns the CLOCK: a Date built from literals reads nothing live,
  // so it passes here. All three of these forms are rejected by check 5
  // (findAuthoredInstants) instead — they author an instant that competes
  // with the tour world's anchor. The two checks partition new Date(...)
  // between them; nothing is double-reported.
  const source = [
    'export const FROZEN = new Date("2026-07-20T09:30:00Z");',
    "export const EPOCH = new Date(0);",
    "export const PARTS = new Date(2026, 6, 20);",
  ].join("\n");
  assert.deepEqual(findClockReads(source), []);
});

test("findClockReads flags new Date(...) with a non-literal argument", () => {
  const source = "const d = new Date(FROZEN.getTime() + 2400);";
  const violations = findClockReads(source);
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /literal/);
});

test("findClockReads ignores clock reads inside string literals", () => {
  // Displayed terminal/code text — the exact false positive that rules out a
  // regex scan (create-agent-tour/steps.ts renders this line as data).
  const source = [
    "const CODE = [",
    "  '  name: `session-${Date.now()}`,',",
    '  "const r = Math.random();",',
    "];",
  ].join("\n");
  assert.deepEqual(findClockReads(source), []);
});

test("findClockReads allows samples.* factories — they are frozen in the SDK", () => {
  // Once samples.* stopped reading the live clock (frozen at SAMPLE_INSTANT,
  // locked by sdk/react's own suite), the gate's per-factory denylist was
  // deleted. A tour may call any factory freely.
  const source = [
    'const tc = samples.toolCall("get_order", "{}");',
    "const key = samples.apiKey();",
    'const msg = samples.humanMessage("hi");',
    "const srv = samples.mcpServer({});",
  ].join("\n");
  assert.deepEqual(findClockReads(source), []);
});

test("findClockReads still flags a live clock passed into a factory call", () => {
  // Deleting the denylist is only safe because the general clock rules remain:
  // smuggling Date.now()/new Date() through a factory argument is still caught.
  const source = [
    'const tc = samples.toolCall("x", new Date().toISOString());',
    "const key = samples.apiKey({ createdAt: Date.now() });",
  ].join("\n");
  const violations = findClockReads(source);
  assert.equal(violations.length, 2);
  assert.match(violations[0].reason, /new Date/);
  assert.match(violations[1].reason, /Date\.now/);
});

test("findClockReads parses TSX without mistaking JSX for comparisons", () => {
  const source = [
    "export function renderStep(data: Step) {",
    "  return <div inert>{data.label}</div>;",
    "}",
  ].join("\n");
  assert.deepEqual(findClockReads(source, "index.tsx"), []);
});

// ---------------------------------------------------------------------------
// findAuthoredInstants
// ---------------------------------------------------------------------------

test("findAuthoredInstants flags the three literals the anchor migration removed", () => {
  // The reproduction cases, verbatim from the tree before 2026-07-25: the
  // _shared discovered-at Date (the shipped "Jul 19 in Honolulu" bug) and
  // connect-tools-tour's hand-written tool-call span. Reverting any of them
  // fails here.
  const source = [
    'export const ORDER_MGMT_DISCOVERED_AT = new Date("2026-07-20T09:30:00Z");',
    'const RETURN_STARTED_AT = "2026-07-20T09:31:00.000Z";',
    'const RETURN_COMPLETED_AT = "2026-07-20T09:31:02.400Z";',
  ].join("\n");
  const violations = findAuthoredInstants(source);
  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map((v) => v.line),
    [1, 2, 3],
  );
  for (const v of violations) assert.match(v.reason, /sample(Instant|Date)/);
});

test("findAuthoredInstants flags an instant even when it is in-window", () => {
  // The rule is "derive, don't author" — not "author safely". A literal that
  // happens to render one date today still forks the tour world's clock and
  // is left behind if the demo day is ever refreshed.
  const source = 'const AT = "2026-07-20T11:00:00.000Z";';
  assert.equal(findAuthoredInstants(source).length, 1);
});

test("findAuthoredInstants closes the two Date forms the determinism check permits", () => {
  const source = ["const PARTS = new Date(2026, 6, 20);", "const EPOCH = new Date(0);"].join("\n");
  const violations = findAuthoredInstants(source);
  assert.equal(violations.length, 2);
  // Each names WHY it is not a usable absolute instant.
  assert.match(violations[0].reason, /LOCAL time/);
  assert.match(violations[1].reason, /epoch/);
});

test("findAuthoredInstants reports new Date(\"...\") once, not twice", () => {
  // The construction is the violation; the instant string inside it must not
  // be reported a second time.
  const source = 'const D = new Date("2026-07-20T09:30:00Z");';
  assert.equal(findAuthoredInstants(source).length, 1);
});

test("findAuthoredInstants leaves non-literal new Date(...) to the determinism check", () => {
  // Check 1's case — but an authored instant nested inside its argument is
  // still this check's to find.
  const clockRead = "const d = new Date(FROZEN.getTime() + 2400);";
  assert.deepEqual(findAuthoredInstants(clockRead), []);
  assert.equal(findClockReads(clockRead).length, 1);

  const nested = 'const d = new Date(Date.parse("2026-07-20T09:30:00Z") + 2400);';
  assert.equal(findAuthoredInstants(nested).length, 1);
});

test("findAuthoredInstants ignores the displayed-text cases that exist in the tree today", () => {
  // Verbatim from shipped tours: a date-only value in a rendered JSON
  // payload (connect-tools-tour), token-expiry labels where the instant is
  // embedded in prose (platform-client-token-flow, authentication-flow-
  // playback), and displayed code text (create-agent-tour). All render as
  // literal text, identically for every reader — flagging them is the
  // false-positive class this check's anchored full-match rule exists to
  // avoid. Date-only strings are safe because parsing them is separately
  // forbidden by the Date-construction rule.
  const source = [
    'const result = { estimated_refund_date: "2026-04-07" };',
    'const check = { detail: "exp 2026-04-18T13:00:00Z", status: "pass" };',
    "const CODE = ['  name: `session-${Date.now()}`,'];",
  ].join("\n");
  assert.deepEqual(findAuthoredInstants(source), []);
});

test("findAuthoredInstants accepts derivation from the anchor", () => {
  const source = [
    'import { sampleInstant, sampleDate } from "@stigmer/react/test";',
    "const RETURN_STARTED_AT = sampleInstant();",
    "const RETURN_COMPLETED_AT = sampleInstant(2_400);",
    "const DISCOVERED = sampleDate();",
  ].join("\n");
  assert.deepEqual(findAuthoredInstants(source), []);
});

test("findAuthoredInstants flags a no-substitution template instant and parses TSX", () => {
  const source = [
    "export function renderStep(data: Step) {",
    "  return <time dateTime={`2026-07-20T09:30:00Z`}>{data.label}</time>;",
    "}",
  ].join("\n");
  const violations = findAuthoredInstants(source, "index.tsx");
  assert.equal(violations.length, 1);
});

test("the reader offset window boundaries are the documented policy", () => {
  // UTC−11:00 (Midway) … UTC+12:45 (Chatham, southern winter): every
  // inhabited zone except Tongatapu and Kiritimati. Mirrored by the anchor's
  // property test in sdk/react/src/test/__tests__/samples.test.ts — a silent
  // widening or narrowing fails one side or the other.
  assert.equal(READER_OFFSET_WINDOW.westOffsetMinutes, -11 * 60);
  assert.equal(READER_OFFSET_WINDOW.eastOffsetMinutes, 12 * 60 + 45);
});

// ---------------------------------------------------------------------------
// findCrossTourImports
// ---------------------------------------------------------------------------

test("findCrossTourImports allows same-tour and _shared imports", () => {
  const source = [
    'import { tourSteps } from "./steps";',
    'import { AppShell } from "../_shared/AppShell";',
    'import "../_shared/AppShell.css";',
  ].join("\n");
  assert.deepEqual(findCrossTourImports(source, "my-tour/index.tsx"), []);
});

test("findCrossTourImports allows _shared from a .scenar subdir and escapes out of tours/", () => {
  // Both shapes exist today: every providers.tsx reaches _shared two levels
  // up, and _shared/stigmer-preview.tsx imports the compiled SDK stylesheet
  // from outside tours/ entirely.
  const source = [
    'import { createStigmerPreview } from "../../_shared/stigmer-preview";',
    'import "../../../sdk/react/dist/styles.css";',
  ].join("\n");
  assert.deepEqual(
    findCrossTourImports(source, "my-tour/.scenar/providers.tsx"),
    [],
  );
});

test("findCrossTourImports ignores bare package specifiers", () => {
  const source = [
    'import type { ScenarioStep } from "@scenar/react";',
    'import { motion } from "framer-motion";',
  ].join("\n");
  assert.deepEqual(findCrossTourImports(source, "my-tour/steps.ts"), []);
});

test("findCrossTourImports flags the exact import the ManagementShell hoist removed", () => {
  // The reversion case: before the shell moved to _shared/ (2026-07), this
  // was the only way a second tour could reach it — with CI fully green.
  const source =
    'import { ManagementShell } from "../sso-login-playback/shared/ManagementShell";';
  const violations = findCrossTourImports(source, "quickstart-tour/index.tsx");
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /sso-login-playback/);
  assert.match(violations[0].reason, /_shared/);
});

test("findCrossTourImports flags export-from and dynamic import() forms", () => {
  const source = [
    'export { tourSteps } from "../other-tour/steps";',
    'const mod = await import("../other-tour/index");',
    "export { local };", // no module specifier — must be skipped, not crash
  ].join("\n");
  const violations = findCrossTourImports(source, "my-tour/steps.ts");
  assert.equal(violations.length, 2);
  assert.deepEqual(
    violations.map((v) => v.line),
    [1, 2],
  );
});

test("findCrossTourImports flags _shared depending on a tour", () => {
  // The dependency direction is one-way: tours consume _shared, never the
  // reverse — shared chrome importing tour internals couples every consumer.
  const source = 'import { tourSteps } from "../create-agent-tour/steps";';
  const violations = findCrossTourImports(source, "_shared/fixtures.ts");
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /invert the dependency/);
});

// ---------------------------------------------------------------------------
// findStepsArray
// ---------------------------------------------------------------------------

test("findStepsArray mirrors pack's duck-typed discovery", () => {
  const steps = [{ delayMs: 0, data: {} }];
  const mod = {
    OTHER_LINES: ["a", "b"], // string array — no collision
    TERMINAL: [{ type: "prompt", text: "x" }], // objects without delayMs
    tourSteps: steps,
  };
  assert.equal(findStepsArray(mod), steps);
  assert.equal(findStepsArray({ empty: [] }), null);
});

// ---------------------------------------------------------------------------
// validateTimeline
// ---------------------------------------------------------------------------

const goodStep = (overrides = {}) => ({
  delayMs: 2500,
  data: {},
  ...overrides,
});

test("validateTimeline passes a well-formed timeline (narration optional)", () => {
  const steps = [
    goodStep({ delayMs: 0 }), // silent, interaction-free step 0
    goodStep({
      narration: "spoken",
      interactions: [
        { atPercent: 0, type: "set_cursor", target: "x" },
        { atPercent: 1, type: "clear_cursor" },
      ],
    }),
  ];
  assert.deepEqual(validateTimeline(steps), []);
});

test("validateTimeline rejects step-0 interactions by default", () => {
  const steps = [
    goodStep({
      delayMs: 0,
      interactions: [{ atPercent: 0.5, type: "set_cursor", target: "x" }],
    }),
  ];
  const violations = validateTimeline(steps);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].step, 0);
  assert.match(violations[0].reason, /before Play/);
});

test("validateTimeline grandfathers step-0 interactions when allowed", () => {
  const steps = [
    goodStep({
      delayMs: 0,
      interactions: [{ atPercent: 0.5, type: "set_cursor", target: "x" }],
    }),
  ];
  assert.deepEqual(
    validateTimeline(steps, { allowStep0Interactions: true }),
    [],
  );
});

test("validateTimeline rejects out-of-range atPercent and bad delayMs", () => {
  const steps = [
    goodStep({ delayMs: 0 }),
    goodStep({
      delayMs: -100,
      interactions: [{ atPercent: 1.4, type: "set_cursor", target: "x" }],
    }),
  ];
  const violations = validateTimeline(steps);
  assert.equal(violations.length, 2);
  assert.match(violations[0].reason, /delayMs/);
  assert.match(violations[1].reason, /atPercent/);
});

// ---------------------------------------------------------------------------
// extractScenarEmbedIds
// ---------------------------------------------------------------------------

test("extractScenarEmbedIds finds single-line and Prettier-split tags", () => {
  const mdx = [
    '<ScenarEmbed id="create-agent-tour" title="Create an agent walkthrough" />',
    "",
    "<ScenarEmbed",
    '  id="mcp-server-creation-tour"',
    '  title="MCP server creation walkthrough"',
    "/>",
  ].join("\n");
  assert.deepEqual(extractScenarEmbedIds(mdx), [
    "create-agent-tour",
    "mcp-server-creation-tour",
  ]);
});

test("extractScenarEmbedIds ignores usage examples in fenced code blocks", () => {
  const mdx = [
    "Some prose.",
    "",
    "```mdx",
    '<ScenarEmbed id="your-tour-slug" title="Example" />',
    "```",
    "",
    '<ScenarEmbed id="real-tour" />',
  ].join("\n");
  assert.deepEqual(extractScenarEmbedIds(mdx), ["real-tour"]);
});

test("extractScenarEmbedIds ignores id attributes on other components", () => {
  const mdx = '<Tabs id="sdk-language">x</Tabs>\n<Step id="payment_confirmed" />';
  assert.deepEqual(extractScenarEmbedIds(mdx), []);
});

// ---------------------------------------------------------------------------
// extractStills / collectShotNames (invariant 8)
// ---------------------------------------------------------------------------

test("extractStills finds single-line and Prettier-split tags, attributes in any order", () => {
  const mdx = [
    '<Still id="agent-detail-tour/agent-detail" alt="The Agent detail page." />',
    "",
    "<Still",
    '  alt="The workflow run detail."',
    '  id="workflow-tour/run-detail"',
    "/>",
  ].join("\n");
  assert.deepEqual(extractStills(mdx), [
    { id: "agent-detail-tour/agent-detail", alt: "The Agent detail page.", selfClosing: true },
    { id: "workflow-tour/run-detail", alt: "The workflow run detail.", selfClosing: true },
  ]);
});

test("extractStills ignores usage examples in fenced code blocks", () => {
  const mdx = [
    "Place a still like this:",
    "",
    "```mdx",
    '<Still id="your-tour/your-shot" alt="Example" />',
    "```",
    "",
    '<Still id="real-tour/real-shot" alt="A real one." />',
  ].join("\n");
  assert.deepEqual(extractStills(mdx), [
    { id: "real-tour/real-shot", alt: "A real one.", selfClosing: true },
  ]);
});

test("extractStills reports missing attributes as null and non-self-closing form", () => {
  const mdx = ['<Still id="tour/shot" />', '<Still alt="No id." />', '<Still id="tour/shot" alt="Paired form."></Still>'].join(
    "\n",
  );
  assert.deepEqual(extractStills(mdx), [
    { id: "tour/shot", alt: null, selfClosing: true },
    { id: null, alt: "No id.", selfClosing: true },
    { id: "tour/shot", alt: "Paired form.", selfClosing: false },
  ]);
});

test("extractStills does not match other components or prose", () => {
  const mdx = '<ScenarEmbed id="a-tour" />\nThe still shows the console.\n<StillLife id="x/y" alt="z" />';
  assert.deepEqual(extractStills(mdx), []);
});

test("collectShotNames reads declared shots in step order, skipping empty and absent", () => {
  const steps = [
    { delayMs: 1000 },
    { delayMs: 2000, shot: "opening" },
    { delayMs: 3000, shot: "" },
    { delayMs: 4000, shot: "finale" },
  ];
  assert.deepEqual(collectShotNames(steps), ["opening", "finale"]);
});

// ---------------------------------------------------------------------------
// findScaleFactors / findCssScaleFactors (invariant 6)
// ---------------------------------------------------------------------------

test("findScaleFactors flags zoom JSX props and zoom style properties", () => {
  const source = [
    'const a = <BrowserView url="x" contentKey="k" zoom={0.9}>{c}</BrowserView>;',
    'const b = <div style={{ zoom: 0.82 }}>{c}</div>;',
    'const c2 = <div style={{ "zoom": DEMO_CONTENT_ZOOM }}>{c}</div>;',
  ].join("\n");
  const violations = findScaleFactors(source, "index.tsx");
  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map((v) => v.line),
    [1, 2, 3],
  );
});

test("findScaleFactors ignores the word zoom in comments, strings, and other identifiers", () => {
  const source = [
    "// the embed's CSS zoom does not apply to the top layer",
    'const label = "zoom: 0.9";',
    "const zoomLevel = compute();", // a variable, not a property
    "useZoom(zoomLevel);",
  ].join("\n");
  assert.deepEqual(findScaleFactors(source, "index.tsx"), []);
});

test("findCssScaleFactors flags zoom declarations and transform scale, not text-transform or comments", () => {
  const css = [
    "/* the old shell used zoom: 0.55 here */",
    ".a { zoom: 0.9; }",
    ".b { transform: translateX(2px) scale(1.5); }",
    ".c { text-transform: uppercase; }",
    ".d { transform: rotate(360deg); }",
    ".e { --scenar-shell-height: 728px; }",
  ].join("\n");
  const violations = findCssScaleFactors(css);
  assert.deepEqual(
    violations.map((v) => v.line),
    [2, 3],
  );
});

// ---------------------------------------------------------------------------
// REPLICA_METRIC_PAIRS (invariant 7)
// ---------------------------------------------------------------------------

test("replica metric pairs name real, existing facts on both sides", () => {
  // The tripwire only works if the needles are real: every pair must point
  // at files that exist and contain the fact today. (The gate run itself
  // asserts the same; this locks the pair shapes against refactors of the
  // constant.)
  assert.ok(REPLICA_METRIC_PAIRS.length >= 4);
  for (const pair of REPLICA_METRIC_PAIRS) {
    assert.ok(pair.fact && pair.replica && pair.replicaNeedle && pair.real && pair.realNeedle);
    assert.ok(pair.replica.startsWith("demos/tours/_shared/"));
    // The real side is the product: the console app or the SDK organisms it
    // renders (SessionView's residual geometry pins against sdk/react since
    // scenar-cloud DD-010 moved the session frame into the SDK itself).
    assert.ok(
      pair.real.startsWith("client-apps/web/") || pair.real.startsWith("sdk/react/"),
    );
  }
});

// ---------------------------------------------------------------------------
// KNOWN_STEP0_OFFENDERS
// ---------------------------------------------------------------------------

test("the step-0 grandfather set only shrinks", () => {
  // Debt tracker, not an allowlist — and the debt is paid: the five
  // grandfathered playbacks were re-choreographed on 2026-07-26 (step-0
  // cursors removed; the rendered PulseHighlight chrome carries the
  // attention cue). The set must stay empty: a tour that needs a step-0
  // interaction is a tour whose choreography is wrong, because step-0
  // timers arm under the poster and fire before Play.
  assert.deepEqual([...KNOWN_STEP0_OFFENDERS], []);
});
