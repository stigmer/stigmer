// Conformance suite for AgentExecution structured output: with a
// structured_output_schema on execution_config, what the agent's final text
// becomes on status.structured_output.
// Domain: agentic / agentexecution — the typed result a workflow's agent_call
// or an SDK consumer reads instead of prose.
//
// The runner has two sources for the value: deepagents' structuredResponse
// (the primary path a live model populates) and, when that is absent — which
// it always is under the mock's plain text turns — extraction from the final
// AI message (shared/extract-json.ts: whole text, then the LAST parseable code
// fence, then the last balanced brace object; trailing commas repaired before
// every parse). What this suite pins is the extraction contract a consumer can
// rely on, read through status:
// - pure JSON, fenced JSON, and JSON inside prose all populate the field;
// - when several fences appear the LAST one wins (the runner's prompt asks for
//   the result as the final response; intermediate debug output comes first);
// - a trailing comma is repaired, not a failure;
// - prose with no JSON leaves the field absent and the run COMPLETED — an
//   extraction miss never fails a run;
// - without a schema the field is never populated;
// - the schema itself round-trips on spec.execution_config as submitted.
//
// Deliberately NOT asserted (entry 20260910.02, ruling 1): whether the
// fallback validates the value against the schema (extra fields, a missing
// required field, a wrong type). The fallback does no validation today, and
// pinning that would bless the absence of validation as contract; the question
// is filed as a runner issue. DD-001; replaces the Go offline suite's
// structured_output_offline_test.go hard arms.
import type { JsonObject } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

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
// google.protobuf.Struct on execution_config.structured_output_schema.
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

// One execution whose single text turn is `finalText`, with (or without) a schema.
async function runWithSchema(finalText: string, schema: JsonObject | undefined): Promise<AgentExecution> {
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
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-so"),
      agentId: agent.metadata!.id,
      message: "Analyze the word hello.",
      autoApproveAll: true,
      ...(schema !== undefined ? { executionConfig: { structuredOutputSchema: schema, maxToolRounds: 10 } } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `the run should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  return final;
}

// protobuf-es carries a google.protobuf.Struct field as a plain JsonObject, so
// status.structured_output compares as values with no unwrapping.
function structuredOutputOf(final: AgentExecution): JsonObject | undefined {
  return final.status?.structuredOutput;
}

describe("AgentExecution structured output — extraction from the final message", () => {
  it("a pure JSON final message populates structured_output with the schema's keys", async () => {
    const final = await runWithSchema(`{"summary": "Test analysis of hello", "score": 8}`, SUMMARY_SCORE_SCHEMA);
    expect(structuredOutputOf(final)).toEqual({ summary: "Test analysis of hello", score: 8 });
  });

  it("JSON inside a code fence is extracted", async () => {
    const final = await runWithSchema(
      'Here is my analysis:\n\n```json\n{"summary": "Analysis of world", "score": 7}\n```\n\nHope that helps!',
      SUMMARY_SCORE_SCHEMA,
    );
    expect(structuredOutputOf(final)).toEqual({ summary: "Analysis of world", score: 7 });
  });

  it("fenced JSON inside prose is extracted with its values intact", async () => {
    const final = await runWithSchema(
      'Based on my analysis, here is the result:\n\n```json\n{"summary": "v2 baseline test", "score": 10}\n```\n\nThis output was extracted from text.',
      SUMMARY_SCORE_SCHEMA,
    );
    expect(structuredOutputOf(final)).toEqual({ summary: "v2 baseline test", score: 10 });
  });

  it("with several fences the LAST parseable one wins (debug output first, result last)", async () => {
    const final = await runWithSchema(
      "Here are two results:\n\n```json\n{\"debug\": true, \"version\": \"1.0\"}\n```\n\nAnd the actual result:\n\n```json\n{\"summary\": \"actual result\", \"score\": 8}\n```",
      SUMMARY_SCORE_SCHEMA,
    );
    const output = structuredOutputOf(final);
    expect(output).toEqual({ summary: "actual result", score: 8 });
    expect(output, "the debug fence was not the one picked").not.toHaveProperty("debug");
  });

  it("a trailing comma is repaired before parsing", async () => {
    const final = await runWithSchema(`{"summary": "test result", "score": 5, }`, SUMMARY_SCORE_SCHEMA);
    expect(structuredOutputOf(final)).toEqual({ summary: "test result", score: 5 });
  });

  it("a nested array of objects round-trips as a list of objects", async () => {
    const final = await runWithSchema(
      `{"items": [{"name": "Go", "count": 85}, {"name": "Python", "count": 92}, {"name": "Rust", "count": 75}]}`,
      NESTED_ARRAY_SCHEMA,
    );
    expect(structuredOutputOf(final)).toEqual({
      items: [
        { name: "Go", count: 85 },
        { name: "Python", count: 92 },
        { name: "Rust", count: 75 },
      ],
    });
  });

  it("prose with no JSON leaves structured_output absent and the run COMPLETED", async () => {
    const final = await runWithSchema(
      "# Blue Color Analysis\n\nBlue is a primary color associated with calm and serenity.\n\n## Key Points\n\n- Often used in corporate branding\n- Score: approximately 8 out of 10 for positive associations",
      SUMMARY_SCORE_SCHEMA,
    );
    expect(final.status?.structuredOutput, "an extraction miss is not a failure and not a guess").toBeUndefined();
  });

  it("without a schema, structured_output is absent even when the final message is JSON", async () => {
    const final = await runWithSchema(`{"summary": "hello", "score": 5}`, undefined);
    expect(final.status?.structuredOutput).toBeUndefined();
  });
});

describe("AgentExecution structured output — the schema round-trips on the spec", () => {
  const schemas: Array<[string, JsonObject, string]> = [
    ["SummaryScore", SUMMARY_SCORE_SCHEMA, `{"summary": "hello", "score": 5}`],
    ["NestedArray", NESTED_ARRAY_SCHEMA, `{"items": [{"name": "Go", "count": 1}]}`],
    ["NullableField", NULLABLE_FIELD_SCHEMA, `{"name": "Test"}`],
    ["CohortsArray", COHORTS_ARRAY_SCHEMA, `{"cohorts": [{"name": "A", "size": 1, "action_needed": false}]}`],
  ];

  for (const [name, schema, answer] of schemas) {
    it(`execution_config.structured_output_schema is persisted with type and properties intact (${name})`, async () => {
      const final = await runWithSchema(answer, schema);
      const persisted = final.spec?.executionConfig?.structuredOutputSchema;
      expect(persisted, `schema ${name} must survive creation`).toBeDefined();
      expect(persisted!.type).toBe("object");
      expect(persisted!.properties).toEqual(schema.properties);
      expect(persisted!.required).toEqual(schema.required);
    });
  }
});
