/**
 * Hermetic goldens: STRUCTURED OUTPUT — an execution whose config carries a
 * JSON schema, through the three paths a Stigmer turn has:
 *
 *  1. The engine's `structuredResponse`. A graph that does not think takes
 *     the tool strategy on every provider (`structured-output-format.ts`):
 *     the answer form's tool is bound (`StructuredOutput`, with the
 *     person's schema whole as its input, `shared/answer-form.ts`), the
 *     model calls it with the answer as arguments, and the graph's
 *     `run.output.structuredResponse` holds the checked object. The adapter
 *     folds it onto the status (`turn-settle.ts`).
 *  2. The text fallback (the runtime's tier 1): the model answers in prose
 *     with a fenced JSON block and `shared/extract-json.ts` recovers the
 *     object from the final text (`run-turn.ts` `extractStructuredOutputFromText`).
 *  3. The LLM fallback (the runtime's tier 2): the final text carries
 *     no JSON at all, so the runtime asks a second model — the registry's
 *     economy tier for the primary's provider — to extract it through
 *     `withStructuredOutput` (`shared/extract-structured-output.ts`). Stigmer
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
 * Whatever each path yields is recorded as found, on `status.structuredOutput`.
 * A schema whose root is not an object reaches the model wrapped as the one
 * property `value` of the answer form, and its answer is recorded so: a run's
 * structured output is an object (`shared/answer-form.ts`).
 *
 * Tier 2 binds the same answer-form tool, on the extraction model alone, so
 * the script tells the two calls apart by the bound list: the extraction
 * model binds that one tool and nothing else.
 *
 * Since #1096 the activity is the turn runtime over the Stigmer harness's adapter, and
 * `streamingUsage` carries the runtime accountant's fields — `model`,
 * `estimatedCostUsd` priced at the registry's rates, the requested tier and
 * thinking mode (one writer of the summary, the runtime). Nothing
 * else in this golden moved with the flip.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";
import { FIXTURE_STIGMER_MODEL } from "../../../../__test-utils__/model-registry-fixture.js";
import { DEFAULT_RECORD_IDS } from "../../../../__test-utils__/execution-record-fixture.js";
import { ANSWER_TOOL_NAME, WRAPPED_ANSWER_KEY } from "../../../../shared/answer-form.js";

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, score: { type: "number" } },
  required: ["answer", "score"],
};
const ANSWER = { answer: "forty-two", score: 42 };

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
        const schemaTool = tools.find((t) => t === ANSWER_TOOL_NAME);
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
    expect(slim.phase).toBe("RUN_COMPLETED");
    expect(boundSchemaTools[0], "the graph bound the answer form's tool").toBe(ANSWER_TOOL_NAME);
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const final = record.lastFullStatus!;
    const finalRows = record.rowsOf(final);
    expect(finalRows.structuredOutput, "the engine's structuredResponse reaches the status").toEqual(ANSWER);

    await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/structured-output.tool-strategy.status.json");
    await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath("./goldens/structured-output.tool-strategy.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/structured-output.tool-strategy.events.json");
  });

  it("tool strategy, a root that is not an object: the answer arrives wrapped under value", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const listSchema = { type: "array", items: { type: "string" }, minItems: 1 };
    const record = deepAgentExecutionRecord({ message: "List the answers.", structuredOutputSchema: listSchema });
    const boundSchemaTools: string[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools) => {
        const schemaTool = tools.find((t) => t === ANSWER_TOOL_NAME);
        if (schemaTool) boundSchemaTools.push(schemaTool);
        return {
          turns: [
            {
              text: "Here are the answers.",
              toolCalls: schemaTool ? [{ id: "call-hermetic-wrapped-0001", name: schemaTool, args: { [WRAPPED_ANSWER_KEY]: ["forty-two", "seven"] } }] : [],
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
    expect(boundSchemaTools[0], "a non-object root still binds the answer form's tool").toBe(ANSWER_TOOL_NAME);
    const finalRows = record.rowsOf(record.lastFullStatus!);
    expect(finalRows.structuredOutput, "the structured output is an object, the answer under value").toEqual({
      [WRAPPED_ANSWER_KEY]: ["forty-two", "seven"],
    });
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
    expect(slim.phase).toBe("RUN_COMPLETED");
    const final = record.lastFullStatus!;
    const finalRows = record.rowsOf(final);
    expect(finalRows.structuredOutput, "extracted from the final text").toEqual(ANSWER);
    expect(record.toolCalls(), "no tool was involved").toHaveLength(0);

    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/structured-output.text-fallback.status.json");
    await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath("./goldens/structured-output.text-fallback.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/structured-output.text-fallback.events.json");
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
        // The extraction model binds exactly one tool, the answer form's; the
        // agent's graph binds many.
        if (tools.length === 1 && tools[0] === ANSWER_TOOL_NAME) {
          extractionCalls.push([...tools]);
          return { turns: [{ text: "", toolCalls: [{ id: "call-hermetic-tier2-0001", name: ANSWER_TOOL_NAME, args: ANSWER }] }] };
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
      expect(slim.phase).toBe("RUN_COMPLETED");
      const final = record.lastFullStatus!;
      const finalRows = record.rowsOf(final);
      expect(finalRows.structuredOutput, "extracted by the second model").toEqual(ANSWER);
        expect(record.toolCalls(), "the extraction tool call is not a graph step and never reaches the transcript").toHaveLength(0);
      expect(extractionCalls, "the extractor was asked exactly once").toHaveLength(1);

      // The agent's build, the sub-agent factory's builds (every registered
      // profile sub-agent is compiled, invoked or not), then — last, after the
      // graph has ended — the extractor's: the one build that caps its output
      // (`maxTokens: 4096`), scoped to the run it serves so a proxy that
      // requires a run scope answers it and meters it to that run
      // (stigmer#2060).
      const builds = recordedModelBuilds();
      const extractorBuilds = builds.filter((b) => b.maxTokens === 4096);
      expect(extractorBuilds, "exactly one extraction build").toHaveLength(1);
      expect(builds.at(-1), "the extractor is built after the graph's run, never before").toBe(extractorBuilds[0]);
      expect(extractorBuilds[0]!.headerScope).toEqual({ executionId: DEFAULT_RECORD_IDS.executionId });
      // The fixture registry declares no economy row, so `getEconomyModel`
      // falls back to the primary (its last resort).
      expect(extractorBuilds[0]!.modelName).toBe(FIXTURE_STIGMER_MODEL);

      await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/structured-output.tier2.status.json");
      await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath("./goldens/structured-output.tier2.status.json"));
      await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/structured-output.tier2.events.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
