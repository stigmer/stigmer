import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findClockReads,
  findCrossTourImports,
  findStepsArray,
  validateTimeline,
  extractScenarEmbedIds,
  KNOWN_STEP0_OFFENDERS,
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
// KNOWN_STEP0_OFFENDERS
// ---------------------------------------------------------------------------

test("the step-0 grandfather set only shrinks", () => {
  // Debt tracker, not an allowlist: entries are removed by re-choreographing
  // the tour, never added or swapped. Exact membership — a size bound would
  // let a new offender hide behind a retired one. If this fires because a
  // NEW tour was added to the set, fix the tour instead; if it fires because
  // an entry was retired, delete the slug here too (that friction is the
  // ratchet).
  assert.deepEqual(
    [...KNOWN_STEP0_OFFENDERS].sort(),
    [
      "authentication-flow-playback",
      "multi-tenant-setup-playback",
      "platform-client-token-flow",
      "provision-grant-playback",
      "sso-login-playback",
    ],
  );
});
