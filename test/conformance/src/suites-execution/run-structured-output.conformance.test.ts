// Conformance suite for Run structured output: with a
// spec.structured_output_schema, what the agent's final text becomes as the
// turn's stigmer.agent.structured_output in the session's log.
// Domain: agentic / agentexecution — the typed result an SDK consumer reads
// instead of prose.
//
// The runner has three sources for the value: the engine's own structured
// response (the primary path a live model populates), and, when that is
// absent — which it always is under the mock's plain text turns — the turn
// runtime's two extraction tiers over the final AI message
// (harness/run-turn.ts): tier 1, text extraction (shared/extract-json.ts:
// whole text, then the LAST parseable code fence, then the last balanced
// brace object; trailing commas repaired before every parse); and when tier 1
// finds nothing, tier 2, ONE more LLM call that asks a model to extract the
// value through function calling (shared/extract-structured-output.ts) —
// on both harnesses, since the turn runtime owns the epilogue. What this suite
// pins is the extraction contract a consumer can rely on, read through the
// session's log (support/turn.ts):
// - pure JSON, fenced JSON, and JSON inside prose all populate the field
//   (tier 1; the mock is asked exactly one turn);
// - when several fences appear the LAST one wins (the runner's prompt asks for
//   the result as the final response; intermediate debug output comes first);
// - a trailing comma is repaired, not a failure;
// - prose with no JSON is handed to tier 2: the extractor's reply populates
//   the field, and the mock sees that second call — a tool named `extract`,
//   no agent system prompt — and nothing more;
// - an extraction miss never fails a run: when the extractor itself answers
//   in prose (no tool call), the field stays absent and the run COMPLETED;
// - without a schema the field is never populated and tier 2 is never asked;
// - the schema itself round-trips on spec.structured_output_schema as submitted.
// - on Claude, the engine's own answer tool (`StructuredOutput`) is the
//   primary path, and its answer is the turn's structured output.
//
// Deliberately NOT asserted: whether the fallback validates the value against
// the schema (extra fields, a missing required field, a wrong type). The
// fallback does no validation today, and pinning that would bless the absence
// of validation as contract; the question is filed as a runner issue.
import type { JsonObject } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse, type AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { uniqueName } from "../support/naming";
import { messagesOf, turnOfRun } from "../support/turn";
import { CLAUDE_ARM, claudeTurnsOnly } from "../support/engine-arms";
import { createTarget, type TargetProfile } from "../targets";

// Collection-time capability read: whether this target runs Claude turns.
const collectionTarget = createTarget();

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The schemas the arms submit — plain JSON Schema objects, carried as a
// google.protobuf.Struct on spec.structured_output_schema.
const SUMMARY_SCORE_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    summary: { type: "string", description: "A brief summary" },
    score: { type: "number", description: "A numeric score from 1 to 10" },
  },
  required: ["summary", "score"],
};
const NESTED_ARRAY_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, count: { type: "number" } }, required: ["name", "count"] },
    },
  },
  required: ["items"],
};
const NULLABLE_FIELD_SCHEMA: JsonObject = {
  type: "object",
  properties: { name: { type: "string" }, notes: { type: ["string", "null"] } },
  required: ["name"],
};
const COHORTS_ARRAY_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    cohorts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, size: { type: "number" }, action_needed: { type: "boolean" } },
        required: ["name", "size", "action_needed"],
      },
    },
  },
  required: ["cohorts"],
};

// One execution whose single agent turn is `finalText`, with (or without) a
// schema. `extractorTurn` is the reply queued for tier 2 — the second call the
// runner makes only when `finalText` carries no JSON; an arm that expects tier
// 1 to succeed queues none, and the mock's `consumed()` proves which tier ran.
async function runWithSchema(
  finalText: string,
  schema: JsonObject | undefined,
  extractorTurn?: AnthropicMessageBody,
): Promise<Run> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: uniqueName("agent-so"),
      instructions: "Answer the question. When a schema is given, return the result as JSON as your final response.",
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  mock.enqueue(anthropicText(finalText));
  if (extractorTurn) mock.enqueue(extractorTurn);
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("run-so"),
      agentRef: agentRefOf(agent),
      message: "Analyze the word hello.",
      autoApproveAll: true,
      ...(schema !== undefined ? { structuredOutputSchema: schema, runConfig: { maxToolRounds: 10 } } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `the run should complete; reached ${RunPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(RunPhase.RUN_COMPLETED);
  return final;
}

// The turn's structured output, folded from its stigmer.agent.structured_output
// event. protobuf-es carries a google.protobuf.Struct field as a plain
// JsonObject, so it compares as values with no unwrapping.
async function structuredOutputOf(final: Run): Promise<JsonObject | undefined> {
  return (await turnOfRun(clients, final)).structuredOutput;
}

describe("Run structured output — extraction from the final message", () => {
  it("a pure JSON final message populates structured_output with the schema's keys", async () => {
    const final = await runWithSchema(`{"summary": "Test analysis of hello", "score": 8}`, SUMMARY_SCORE_SCHEMA);
    expect(await structuredOutputOf(final)).toEqual({ summary: "Test analysis of hello", score: 8 });
  });

  it("JSON inside a code fence is extracted", async () => {
    const final = await runWithSchema(
      'Here is my analysis:\n\n```json\n{"summary": "Analysis of world", "score": 7}\n```\n\nHope that helps!',
      SUMMARY_SCORE_SCHEMA,
    );
    expect(await structuredOutputOf(final)).toEqual({ summary: "Analysis of world", score: 7 });
  });

  it("fenced JSON inside prose is extracted with its values intact", async () => {
    const final = await runWithSchema(
      'Based on my analysis, here is the result:\n\n```json\n{"summary": "v2 baseline test", "score": 10}\n```\n\nThis output was extracted from text.',
      SUMMARY_SCORE_SCHEMA,
    );
    expect(await structuredOutputOf(final)).toEqual({ summary: "v2 baseline test", score: 10 });
  });

  it("with several fences the LAST parseable one wins (debug output first, result last)", async () => {
    const final = await runWithSchema(
      "Here are two results:\n\n```json\n{\"debug\": true, \"version\": \"1.0\"}\n```\n\nAnd the actual result:\n\n```json\n{\"summary\": \"actual result\", \"score\": 8}\n```",
      SUMMARY_SCORE_SCHEMA,
    );
    const output = await structuredOutputOf(final);
    expect(output).toEqual({ summary: "actual result", score: 8 });
    expect(output, "the debug fence was not the one picked").not.toHaveProperty("debug");
  });

  it("a trailing comma is repaired before parsing", async () => {
    const final = await runWithSchema(`{"summary": "test result", "score": 5, }`, SUMMARY_SCORE_SCHEMA);
    expect(await structuredOutputOf(final)).toEqual({ summary: "test result", score: 5 });
  });

  it("a nested array of objects round-trips as a list of objects", async () => {
    const final = await runWithSchema(
      `{"items": [{"name": "Go", "count": 85}, {"name": "Python", "count": 92}, {"name": "Rust", "count": 75}]}`,
      NESTED_ARRAY_SCHEMA,
    );
    expect(await structuredOutputOf(final)).toEqual({
      items: [
        { name: "Go", count: 85 },
        { name: "Python", count: 92 },
        { name: "Rust", count: 75 },
      ],
    });
  });

  it("a pure JSON final message is tier 1's: the mock is asked exactly the agent's one turn", async () => {
    await runWithSchema(`{"summary": "one turn", "score": 1}`, SUMMARY_SCORE_SCHEMA);
    expect(mock.consumed(), "no extraction call follows a text extraction that succeeded").toBe(1);
  });

  it("prose with no JSON is handed to tier 2: the extractor's function call populates structured_output", async () => {
    const final = await runWithSchema(
      "# Blue Color Analysis\n\nBlue is a primary color associated with calm and serenity.\n\n## Key Points\n\n- Often used in corporate branding\n- Score: approximately 8 out of 10 for positive associations",
      SUMMARY_SCORE_SCHEMA,
      anthropicToolUse("toolu_extract_1", "extract", { summary: "Blue: calm, serene, corporate", score: 8 }),
    );
    expect(await structuredOutputOf(final)).toEqual({ summary: "Blue: calm, serene, corporate", score: 8 });
    expect(mock.consumed(), "the agent's turn, then exactly one extraction call").toBe(2);

    // The second call is the extractor's, not another agent turn: it binds the
    // one function-calling tool `extract`, and its system prompt is the
    // extractor's own sentence, not the agent's instructions.
    const extraction = mock.requests().at(-1)?.body as { tools?: Array<{ name: string }>; system?: unknown } | undefined;
    expect(extraction?.tools?.map((t) => t.name), "the extractor binds the schema as one tool").toEqual(["extract"]);
    const extractorSystem = JSON.stringify(extraction?.system ?? "");
    expect(extractorSystem).toContain("Extract the structured data");
    expect(extractorSystem, "the extractor is not the agent").not.toContain("Answer the question");
    expect(
      messagesOf(await turnOfRun(clients, final)),
      "the extraction call is not a message of the transcript",
    ).toHaveLength(1);
  });

  it("an extraction miss never fails a run: an extractor that answers in prose leaves structured_output absent and the run COMPLETED", async () => {
    const final = await runWithSchema(
      "Blue is a primary color associated with calm and serenity.",
      SUMMARY_SCORE_SCHEMA,
      anthropicText("I cannot express that as the requested structure."),
    );
    expect(await structuredOutputOf(final), "an extraction miss is not a failure and not a guess").toBeUndefined();
    expect(mock.consumed(), "tier 2 was asked once and not retried").toBe(2);
  });

  it("without a schema, structured_output is absent even when the final message is JSON, and tier 2 is never asked", async () => {
    const final = await runWithSchema(`{"summary": "hello", "score": 5}`, undefined);
    expect(await structuredOutputOf(final)).toBeUndefined();
    expect(mock.consumed()).toBe(1);
  });
});

describe("Run structured output — the schema round-trips on the spec", () => {
  const schemas: Array<[string, JsonObject, string]> = [
    ["SummaryScore", SUMMARY_SCORE_SCHEMA, `{"summary": "hello", "score": 5}`],
    ["NestedArray", NESTED_ARRAY_SCHEMA, `{"items": [{"name": "Go", "count": 1}]}`],
    ["NullableField", NULLABLE_FIELD_SCHEMA, `{"name": "Test"}`],
    ["CohortsArray", COHORTS_ARRAY_SCHEMA, `{"cohorts": [{"name": "A", "size": 1, "action_needed": false}]}`],
  ];

  for (const [name, schema, answer] of schemas) {
    it(`[rpc:RunCommandController.create] spec.structured_output_schema is persisted with type and properties intact (${name})`, async () => {
      const final = await runWithSchema(answer, schema);
      const persisted = final.spec?.structuredOutputSchema;
      expect(persisted, `schema ${name} must survive creation`).toBeDefined();
      expect(persisted!.type).toBe("object");
      expect(persisted!.properties).toEqual(schema.properties);
      expect(persisted!.required).toEqual(schema.required);
    });
  }
});

// On Claude the engine answers a schema through the tool it adds for one
// (`StructuredOutput`), the primary path, and that answer is the turn's
// stigmer.agent.structured_output. The turn is scripted by conversation
// (support/engine-arms.ts).
describe("Run structured output — on Claude", () => {
  beforeEach(claudeTurnsOnly(collectionTarget.capabilities));
  it("a Claude turn answers the schema through the engine's own StructuredOutput tool, and the answer is the turn's structured output", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-so-claude"), instructions: "Answer the question in the schema it gives." }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const task = uniqueName("Analyze the word hello");
    CLAUDE_ARM.script(mock, task, [
      { kind: "call", id: `toolu_${uniqueName("answer").replace(/-/g, "_")}`, name: "StructuredOutput", input: { summary: "a greeting", score: 7 } },
      { kind: "text", text: "" },
    ]);
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("run-so-claude"), agentRef: agentRefOf(agent), message: task, autoApproveAll: true, structuredOutputSchema: SUMMARY_SCORE_SCHEMA, sessionSpec: { harness: CLAUDE_ARM.harness } }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, `the Claude turn: ${final.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    expect(await structuredOutputOf(final), "the engine's answer is the turn's").toEqual({ summary: "a greeting", score: 7 });
    expect(CLAUDE_ARM.loopRequests(mock).some((request) => JSON.stringify(request.body).includes('"name":"extract"')), "no extraction call was needed").toBe(false);
  });
});
