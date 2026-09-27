// Unit arms for the eval task's verdict schema: the structured-output shape
// the judge is bound to, per scoring mode (stigmer#1293).
//
// Pinned: each mode declares exactly the fields its parser reads, all
// required, and a multi-criteria `name` is limited to the configured
// criteria's names; the schema reaches the LLM call in place of the empty
// object it replaced; converted the way the LLM call converts it, the schema
// accepts a well-formed verdict and refuses a nameless criterion, an
// unconfigured name and a missing field, the shapes a real judge returned
// when the schema declared no fields; a structured multi-criteria verdict
// comes back as named criteria with their weighted score.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

const callLlmAction = vi.fn();
vi.mock("../call-llm.js", () => ({ callLlmAction: (...args: unknown[]) => callLlmAction(...args) }));

const { callEvalAction, verdictSchema } = await import("../call-eval.js");

const CRITERIA = [
  { name: "accurate", description: "matches the source", weight: 3 },
  { name: "concise", description: "short", weight: 1 },
];

beforeEach(() => {
  callLlmAction.mockReset();
});

describe("verdictSchema", () => {
  it("declares the fields each mode's parser reads, all required", () => {
    expect(verdictSchema("EVAL_PASS_FAIL")).toEqual({
      type: "object",
      properties: { pass: { type: "boolean" }, reasoning: { type: "string" } },
      required: ["pass", "reasoning"],
    });
    expect(verdictSchema("EVAL_NUMERIC_SCORE")).toEqual({
      type: "object",
      properties: { score: { type: "number" }, reasoning: { type: "string" } },
      required: ["score", "reasoning"],
    });
    expect(verdictSchema("EVAL_MULTI_CRITERIA", CRITERIA)).toEqual({
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", enum: ["accurate", "concise"] },
              score: { type: "number" },
              reasoning: { type: "string" },
            },
            required: ["name", "score", "reasoning"],
          },
        },
      },
      required: ["criteria"],
    });
  });

  it("refuses an unknown scoring mode", () => {
    expect(() => verdictSchema("EVAL_VIBES")).toThrow("Unknown scoring_mode 'EVAL_VIBES'");
  });

  it("converted as the LLM call converts it, binds the multi-criteria verdict's shape", () => {
    const schema = jsonSchemaToZod(verdictSchema("EVAL_MULTI_CRITERIA", CRITERIA));
    const good = {
      criteria: [
        { name: "accurate", score: 1, reasoning: "right" },
        { name: "concise", score: 0.5, reasoning: "long" },
      ],
    };
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse({}).success, "no criteria at all").toBe(false);
    expect(schema.safeParse({ criteria: [{ criterion: "accurate", score: 1, reasoning: "r" }] }).success, "a nameless criterion").toBe(false);
    expect(schema.safeParse({ criteria: [{ name: "style", score: 1, reasoning: "r" }] }).success, "an unconfigured name").toBe(false);
    expect(schema.safeParse({ criteria: [{ name: "accurate", reasoning: "r" }] }).success, "a missing score").toBe(false);
  });
});

describe("callEvalAction", () => {
  function reply(result: unknown): { result: unknown; model: string; input_tokens: number; output_tokens: number } {
    return { result, model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 20 };
  }

  it("binds the judge to its mode's verdict schema, never an empty object", async () => {
    for (const [mode, result] of [
      ["EVAL_PASS_FAIL", { pass: true, reasoning: "ok" }],
      ["EVAL_NUMERIC_SCORE", { score: 0.5, reasoning: "ok" }],
    ] as const) {
      callLlmAction.mockResolvedValueOnce(reply(result));
      await callEvalAction({ model: "claude-sonnet-4-6", subject: "s", rubric: "r", scoring_mode: mode }, {}, "exec-1");
      expect(callLlmAction.mock.lastCall?.[0].response_schema).toEqual(verdictSchema(mode));
    }
  });

  it("reads a structured multi-criteria verdict as named criteria with their weighted score", async () => {
    callLlmAction.mockResolvedValueOnce(
      reply({
        criteria: [
          { name: "accurate", score: 1, reasoning: "right" },
          { name: "concise", score: 0.5, reasoning: "long" },
        ],
      }),
    );
    const result = await callEvalAction(
      { model: "claude-sonnet-4-6", subject: "s", rubric: "r", scoring_mode: "EVAL_MULTI_CRITERIA", criteria: CRITERIA, threshold: 0 },
      {},
      "exec-2",
    );
    expect(callLlmAction.mock.lastCall?.[0].response_schema).toEqual(verdictSchema("EVAL_MULTI_CRITERIA", CRITERIA));
    expect(result.criteria?.map((c) => c.name)).toEqual(["accurate", "concise"]);
    expect(result.score).toBeCloseTo(0.875, 5);
  });
});
