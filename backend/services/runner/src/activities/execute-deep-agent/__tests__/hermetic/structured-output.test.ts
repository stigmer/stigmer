/**
 * Hermetic goldens: STRUCTURED OUTPUT — an execution whose config carries a
 * JSON schema, through the three paths a native turn has:
 *
 *  1. The engine's `structuredResponse`. langchain 1.4.1 turns a bare schema
 *     into `toolStrategy` when the model's profile does not declare native
 *     structured output (`agents/responses.js`): a synthetic function tool is
 *     bound (named `extract-N` from a per-module counter — deepagents passes
 *     no name and the schema's `title` is not consulted, so the script selects
 *     it by pattern rather than by name), the model calls it with the answer
 *     as arguments, and the graph's `run.output.structuredResponse` holds the
 *     parsed object. The adapter folds it onto the status (`turn-settle.ts`).
 *  2. The text fallback (the runtime's tier 1): the model answers in prose
 *     with a fenced JSON block and `shared/extract-json.ts` recovers the
 *     object from the final text (`run-turn.ts` `extractStructuredOutputFromText`).
 *  3. The LLM fallback (the runtime's tier 2): the final text carries
 *     no JSON at all, so the runtime asks a second model — the registry's
 *     economy tier for the primary's provider — to extract it through
 *     `withStructuredOutput` (`shared/extract-structured-output.ts`). Native
 *     gained this arm in #1096, when the turn runtime took the epilogue
 *     over; it is pinned here, where every other alignment of that move
 *     is. Two facts the golden records: the extraction call is a
 *     SECOND model build (`maxTokens: 4096`, on the primary — the fixture
 *     registry declares no economy row, `getEconomyModel`'s last resort),
 *     and its tool call never reaches the transcript (it is not a graph
 *     step). The arm runs in the OSS direct-credential posture
 *     (`ANTHROPIC_API_KEY` stubbed for the arm only): without a proxy the
 *     runtime refuses tier 2 when no credential path exists, and that
 *     refusal is a log line, never a lost run.
 *
 * Whatever each path yields is recorded as found: `status.structuredOutput`
 * and the slim's `structured`.
 *
 * The `extract-N` name is deterministic per test FILE (vitest isolates each
 * file's module graph, so the counter starts at 1), and only the tool-strategy
 * arm compiles a graph with a schema tool in this file, so its row — if one
 * is persisted — is `extract-1`. Tier 2's tool is `@langchain/core`'s default
 * `extract` (`withStructuredOutput` with no name), bound on the extraction
 * model alone, which is how the script tells the two calls apart.
 *
 * Since #1096 the activity is the turn runtime over the native adapter, and
 * `streamingUsage` carries the runtime accountant's fields — `model`,
 * `estimatedCostUsd` priced at the registry's rates, the requested tier and
 * thinking mode (one writer of the summary, the runtime). Nothing
 * else in this golden moved with the flip.
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
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";
import { FIXTURE_NATIVE_MODEL } from "../../../../__test-utils__/model-registry-fixture.js";

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

  it("LLM fallback (tier 2): prose with no JSON is extracted by a second model call the transcript never sees", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    // The OSS direct-credential posture, for this arm only: with no proxy the
    // runtime refuses tier 2 unless a credential path exists.
    vi.stubEnv("ANTHROPIC_API_KEY", "hermetic-tier2-credential");
    const PROSE = "The answer is forty-two, and I would score it a perfect forty-two out of the same.";
    const record = deepAgentExecutionRecord({ message: "Give me the answer.", structuredOutputSchema: SCHEMA });
    const extractionCalls: string[][] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools) => {
        // The extraction model binds exactly one tool, core's default `extract`;
        // the agent's graph never binds a tool of that name.
        if (tools.length === 1 && tools[0] === "extract") {
          extractionCalls.push([...tools]);
          return { turns: [{ text: "", toolCalls: [{ id: "call-hermetic-tier2-0001", name: "extract", args: ANSWER }] }] };
        }
        return { turns: [{ text: PROSE, usage: { inputTokens: 1_300, outputTokens: 40 } }] };
      },
    });

    try {
      // ── Act ────────────────────────────────────────────────────────────────
      const invocation = await runDeepAgentTurn(scenario);

      // ── Assert ─────────────────────────────────────────────────────────────
      expect(invocation.outcome.kind).toBe("returned");
      const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
      expect(slim.phase).toBe("EXECUTION_COMPLETED");
      const final = record.lastFullStatus!;
      expect(final.structuredOutput, "extracted by the second model").toEqual(ANSWER);
      expect(slim.structured).toEqual(ANSWER);
      expect(record.toolCalls(), "the extraction tool call is not a graph step and never reaches the transcript").toHaveLength(0);
      expect(extractionCalls, "the extractor was asked exactly once").toHaveLength(1);

      // The agent's build, the sub-agent factory's builds (every registered
      // profile sub-agent is compiled, invoked or not), then — last, after the
      // graph has ended — the extractor's: the one build that caps its output
      // (`maxTokens: 4096`) and carries no execution header scope.
      const builds = recordedModelBuilds();
      const extractorBuilds = builds.filter((b) => b.maxTokens === 4096);
      expect(extractorBuilds, "exactly one extraction build").toHaveLength(1);
      expect(builds.at(-1), "the extractor is built after the graph's run, never before").toBe(extractorBuilds[0]);
      expect(extractorBuilds[0]!.headerScope).toBeUndefined();
      // The fixture registry declares no economy row, so `getEconomyModel`
      // falls back to the primary (its last resort).
      expect(extractorBuilds[0]!.modelName).toBe(FIXTURE_NATIVE_MODEL);

      const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
      await expect(json).toMatchFileSnapshot("./goldens/structured-output.tier2.status.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
