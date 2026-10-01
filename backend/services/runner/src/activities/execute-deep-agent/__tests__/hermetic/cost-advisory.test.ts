/**
 * Hermetic net: the cost advisory end to end, through the REAL
 * `ExecuteDeepAgent` activity, its real cost guard and the scripted model's
 * provider rules (stigmer/stigmer#1354).
 *
 * What the arm does: `max_cost_usd = 1.00` on the fixture's native model,
 * priced by the stubbed registry at $1.00 per million input tokens
 * (`__test-utils__/model-registry-fixture.ts`). Three tool rounds of 300 000
 * input tokens each reach $0.90: past the advisory's 80% and short of the
 * cap the turn runtime enforces. The fourth model call carries the advisory,
 * and its own tiny usage keeps the run under the cap, so it completes.
 *
 * What it pins:
 *  - the run COMPLETES. Until #1354 the warning was a SystemMessage saved
 *    between the third round's tool call and its result; the scripted model
 *    now refuses that transcript exactly as Anthropic's client does, so the
 *    old shape fails this arm;
 *  - the fourth call, and only it, is handed the advisory: a user-role
 *    message after the third round's tool result;
 *  - the advisory never reaches what the control plane holds: no persisted
 *    message carries it;
 *  - it is never saved (second arm, on the durable `sqlite` checkpointer): a
 *    follow-up message on the same thread starts from a checkpoint with no
 *    advisory in it.
 *
 * The request through the real Anthropic conversion is
 * `shared/__tests__/advisory-anthropic-payload.test.ts`; the unit contract is
 * `middleware/__tests__/cost-advisory.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
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
import { ADVISORY_LEAD_IN } from "../../../../middleware/advisory-message.js";
import {
  beginDeepAgentScenario,
  continueDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { completedToolRounds, type ScriptedTurn, type TurnPlayer } from "../../__test-utils__/scripted-model.js";

/** $1.00 cap; three rounds at $0.30 reach $0.90, past 80% and short of the cap. */
const MAX_COST_USD = 1;
const ROUND_INPUT_TOKENS = 300_000;
const COSTLY_ROUNDS = 3;

function isAdvisory(message: BaseMessage | undefined): boolean {
  return HumanMessage.isInstance(message) && String(message.content).startsWith(ADVISORY_LEAD_IN);
}

/** Three costly reading rounds, then a cheap closing answer; records every transcript it is asked with. */
function spendingPlayer(transcripts: BaseMessage[][]): TurnPlayer {
  return (transcript) => {
    transcripts.push([...transcript]);
    const round = completedToolRounds(transcript);
    if (round < COSTLY_ROUNDS) {
      return {
        text: `Reading file ${round}.`,
        toolCalls: [{ id: `call-hermetic-cost-${round}`, name: "read_file", args: { file_path: `/f${round}.md` } }],
        usage: { inputTokens: ROUND_INPUT_TOKENS, outputTokens: 0 },
      } satisfies ScriptedTurn;
    }
    return { text: "Done: all three files are read.", usage: { inputTokens: 10, outputTokens: 10 } };
  };
}

describe("ExecuteDeepAgent hermetic — the cost advisory", () => {
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

  it("warns the model on the call after it crosses 80% of max_cost_usd, and the run completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const transcripts: BaseMessage[][] = [];
    const record = deepAgentExecutionRecord({ message: "Read the files.", maxCostUsd: MAX_COST_USD });
    const scenario = beginDeepAgentScenario({ env, clock, record, script: () => spendingPlayer(transcripts) });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: the run went past the warning ────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases, "neither failed on the warning nor stopped by the cap").toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(record.toolCalls()).toHaveLength(COSTLY_ROUNDS);

    // ── Assert: the fourth call, and only it, carried the advisory ───────────
    expect(transcripts).toHaveLength(COSTLY_ROUNDS + 1);
    const advisedCalls = transcripts.flatMap((t, i) => (t.some(isAdvisory) ? [i] : []));
    expect(advisedCalls, "one advisory, on the call after the crossing").toEqual([COSTLY_ROUNDS]);
    const advised = transcripts[COSTLY_ROUNDS];
    expect(isAdvisory(advised.at(-1)), "the advisory is the request's last message").toBe(true);
    expect(String(advised.at(-1)!.content)).toContain("Budget warning");
    expect(ToolMessage.isInstance(advised.at(-2)), "it follows the third round's tool result").toBe(true);

    // ── Assert: what the control plane holds never shows it ──────────────────
    const persisted = record.lastFullStatus!;
    expect(persisted.messages.some((m) => m.content.includes(ADVISORY_LEAD_IN))).toBe(false);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });

  it("never saves the advisory: the next message on the thread starts without it (sqlite)", async () => {
    // ── Arrange: the first message crosses the threshold and is warned ───────
    const firstTranscripts: BaseMessage[][] = [];
    const first = beginDeepAgentScenario({
      env,
      clock,
      record: deepAgentExecutionRecord({ message: "Read the files.", maxCostUsd: MAX_COST_USD }),
      checkpointer: "sqlite",
      script: () => spendingPlayer(firstTranscripts),
    });
    await runDeepAgentTurn(first);
    expect(first.record.lastFullStatus!.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(firstTranscripts.some((t) => t.some(isAdvisory)), "the first message was warned").toBe(true);

    const nextTranscripts: BaseMessage[][] = [];
    const record = deepAgentExecutionRecord({ message: "Summarize what you read.", maxCostUsd: MAX_COST_USD });
    const next = continueDeepAgentScenario(first, {
      record,
      script: () => (transcript) => {
        nextTranscripts.push([...transcript]);
        return { text: "Summary: three files.", usage: { inputTokens: 10, outputTokens: 10 } };
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    await runDeepAgentTurn(next);

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    expect(nextTranscripts).toHaveLength(1);
    expect(
      completedToolRounds(nextTranscripts[0]),
      "the follow-up runs on the checkpoint the first message left",
    ).toBe(COSTLY_ROUNDS);
    expect(nextTranscripts[0].some(isAdvisory), "no advisory was saved into the checkpoint").toBe(false);
  });
});
