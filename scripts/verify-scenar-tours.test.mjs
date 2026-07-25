import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findClockReads,
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

test("findClockReads flags denylisted sample factories but not others", () => {
  const source = [
    'const tc = samples.toolCall("get_order", "{}");',
    "const key = samples.apiKey();",
    'const msg = samples.humanMessage("hi");', // clock-reading but unrendered
    "const srv = samples.mcpServer({});", // clock-free
  ].join("\n");
  const violations = findClockReads(source);
  assert.equal(violations.length, 2);
  assert.match(violations[0].reason, /duration chip/);
  assert.match(violations[1].reason, /createdAt/);
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
  // the tour, never added. If this assertion fires because a NEW tour was
  // added to the set, fix the tour instead.
  assert.ok(KNOWN_STEP0_OFFENDERS.size <= 5);
});
