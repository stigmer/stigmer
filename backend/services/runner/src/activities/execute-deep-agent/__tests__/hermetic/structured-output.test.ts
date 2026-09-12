/**
 * Hermetic goldens: STRUCTURED OUTPUT — an execution whose config carries a
 * JSON schema, through the two paths `index.ts` reads:
 *
 *  1. The engine's `structuredResponse`. langchain 1.4.1 turns a bare schema
 *     into `toolStrategy` when the model's profile does not declare native
 *     structured output (`agents/responses.js`): a synthetic function tool is
 *     bound (named `extract-N` from a per-module counter — deepagents passes
 *     no name and the schema's `title` is not consulted, so the script selects
 *     it by pattern rather than by name), the model calls it with the answer
 *     as arguments, and the graph's `run.output.structuredResponse` holds the
 *     parsed object.
 *  2. The text fallback: the model answers in prose with a fenced JSON block
 *     and `shared/extract-json.ts` recovers the object from the final text.
 *
 * Whatever each path yields is recorded as found: `status.structuredOutput`
 * and the slim's `structured`. The runtime's epilogue adds a tier-2 LLM
 * extraction at M2b (Q-S3-7); native has no such arm today and this file
 * pins that absence too (the model double is asked exactly the scripted
 * turns and nothing more).
 *
 * The `extract-N` name is deterministic per test FILE (vitest isolates each
 * file's module graph, so the counter starts at 1), and only the tool-strategy
 * arm compiles a graph with a schema tool in this file, so its row — if one
 * is persisted — is `extract-1`.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, score: { type: "number" } },
  required: ["answer", "score"],
};
const ANSWER = { answer: "forty-two", score: 42 };
const SCHEMA_TOOL_PATTERN = /^extract-\d+$/;

describe("ExecuteDeepAgent hermetic — structured output", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("tool strategy: the model calls the bound schema tool", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Give me the answer.", structuredOutputSchema: SCHEMA });
    const boundSchemaTools: string[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools) => {
        const schemaTool = tools.find((t) => SCHEMA_TOOL_PATTERN.test(t));
        if (schemaTool) boundSchemaTools.push(schemaTool);
        return {
          turns: [
            {
              text: "Here is the structured answer.",
              toolCalls: schemaTool ? [{ id: "call-hermetic-extract-0001", name: schemaTool, args: ANSWER }] : [],
              usage: { inputTokens: 1_300, outputTokens: 40 },
            },
            { text: "Recorded.", usage: { inputTokens: 1_500, outputTokens: 10 } },
          ],
        };
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(boundSchemaTools[0], "langchain bound the toolStrategy schema tool").toBe("extract-1");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const final = record.lastFullStatus!;
    expect(final.structuredOutput, "the engine's structuredResponse reaches the status").toEqual(ANSWER);
    expect(slim.structured).toEqual(ANSWER);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/structured-output.tool-strategy.status.json");
  });

  it("text fallback: a fenced JSON block in the final text", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Give me the answer.", structuredOutputSchema: SCHEMA });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Here you go:\n```json\n" + JSON.stringify(ANSWER) + "\n```",
            usage: { inputTokens: 1_300, outputTokens: 40 },
          },
        ],
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    const final = record.lastFullStatus!;
    expect(final.structuredOutput, "extracted from the final text").toEqual(ANSWER);
    expect(slim.structured).toEqual(ANSWER);
    expect(record.toolCalls(), "no tool was involved").toHaveLength(0);

    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/structured-output.text-fallback.status.json");
  });
});
