/**
 * Hermetic golden: the TOOL-CALL BUDGET — `max_tool_rounds` exhausted by a
 * model that keeps calling tools.
 *
 * What the arm does: `max_tool_rounds = 10` (the clamp floor,
 * `shared/tool-rounds.ts` MIN_TOOL_ROUNDS) is the execution budget
 * middleware's round limit; the script proposes a DISTINCT `read_file` every
 * round (distinct ids and paths, so the loop-detection middleware's
 * "repetitive pattern" warning does not end the run first); after round 10's
 * results the middleware throws `ToolRoundLimitError` in place of round 11's
 * model call; the adapter's turn classifies it, through LangChain's
 * `MiddlewareError` wrapping, as the `tool_call_limit` outcome
 * (`shared/tool-rounds.ts` `isToolCallBudgetStop`), and the runtime's
 * `toolCallLimitArm` writes
 * TERMINATED with the cross-repo prefix `TOOL_CALL_LIMIT_ERROR_PREFIX`
 * (matched with `startsWith` by stigmer-cloud's `reply-extractor.ts`) and
 * its row, PERSISTS it, and returns the slim.
 *
 * The rule landed in #1096. Until then the orchestrator RETURNED
 * the TERMINATED status but never PERSISTED it (a
 * production defect): the last status the control plane held was the
 * stream's mid-run IN_PROGRESS with no error, and only the activity's return
 * value carried the truth. The golden
 * (`goldens/recursion-limit.persisted.status.json`) now records the
 * TERMINATED status the control plane holds, which is what that fix changed
 * on purpose.
 *
 * Also visible here, the message boundary at scale (since #1097): every tool
 * row sits on the "Reading file N." message whose text proposed it. Until
 * then all of them sat on ONE empty AI message: the namespace miss created the
 * empty message once and its `currentAiMessage[""]` then caught every later
 * row.
 *
 * How many rounds run is the knob's, exactly (#1113): TEN tool rows, on any
 * middleware stack. Until #1113 the knob was LangGraph's recursion limit at
 * 10 × 6 super-steps, and since LangChain makes every middleware hook its own
 * graph node, the rows moved with the stack: 11 until #1096 deleted
 * `graceful-stop.ts` (an `afterModel` node), 13 after it. #1113 moved this
 * golden from 13 rows to 10, the copy unchanged. It also dropped the golden's
 * last AI message, "Reading file 13.": the step limit had cut that fourteenth
 * model call's proposal before its tool ran, so the transcript ended on a
 * call that never executed. The round stop replaces the model call instead,
 * so the transcript ends on round 10's results, and usage counts ten model
 * calls, not fourteen.
 *
 * The second arm is the copy's promise, "send another message to continue":
 * on the durable (`sqlite`) checkpointer, a follow-up message on the same
 * thread starts from the checkpoint the stop left. The stop is a throw inside
 * the model node rather than a limit between super-steps, so this is proven,
 * not assumed: the follow-up's first model turn sees all ten rounds in its
 * transcript (the scripted model indexes its script by the rounds the
 * transcript holds), the run completes, and the budget is the new message's
 * own.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { MIN_TOOL_ROUNDS } from "../../../../shared/tool-rounds.js";
import {
  beginDeepAgentScenario,
  continueDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { TOOL_CALL_LIMIT_ERROR_PREFIX } from "../../../../shared/tool-rounds.js";

/** More rounds than the budget allows; the graph stops the script, not the other way round. */
const SCRIPTED_ROUNDS = 40;

/** The model that keeps calling tools: a distinct `read_file` per round. */
function readingRounds(): ScriptedTurn[] {
  return Array.from({ length: SCRIPTED_ROUNDS }, (_, i) => ({
    text: `Reading file ${i}.`,
    toolCalls: [{ id: `call-hermetic-loop-${String(i).padStart(4, "0")}`, name: "read_file", args: { file_path: `/f${i}.md` } }],
    usage: { inputTokens: 1_000, outputTokens: 20 },
  }));
}

describe("ExecuteDeepAgent hermetic — tool-call budget exhausted", () => {
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

  it("returns TERMINATED with the cross-repo prefix, and persists that terminal", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: "Keep reading files.", maxToolRounds: MIN_TOOL_ROUNDS });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({ turns: readingRounds() }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: the slim the workflow receives ───────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_TERMINATED");
    expect(String(slim.error).startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), "the cross-repo prefix").toBe(true);

    // ── Assert: what the control plane holds ─────────────────────────────────
    expect(record.persistedPhases, "the TERMINATED terminal is persisted").toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_TERMINATED,
    ]);
    const persisted = record.lastFullStatus!;
    expect(String(persisted.error).startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), "the persisted error carries the prefix").toBe(true);
    expect(persisted.error, "the event count left the copy").not.toMatch(/\d+ events?/);
    expect(persisted.completedAt).not.toBe("");
    const rows = record.toolCalls();
    expect(rows.length, "exactly max_tool_rounds rounds ran: the budget counts rounds, not graph steps").toBe(MIN_TOOL_ROUNDS);
    // The message boundary: every row sits on the message whose text proposed it
    // — one "Reading file N." message per row, no empty host (before #1097 all
    // thirteen rows sat on ONE empty message).
    const rowHosts = persisted.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.toolCalls.length > 0);
    expect(rowHosts).toHaveLength(rows.length);
    for (const host of rowHosts) {
      expect(host.content).toMatch(/^Reading file \d+\.$/);
      expect(host.toolCalls).toHaveLength(1);
    }

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, persisted), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/recursion-limit.persisted.status.json");
  });

  it("continues on the next message from the checkpoint the stop left (sqlite)", async () => {
    // ── Arrange: the first message exhausts its budget ───────────────────────
    const first = beginDeepAgentScenario({
      env,
      clock,
      record: deepAgentExecutionRecord({ message: "Keep reading files.", maxToolRounds: MIN_TOOL_ROUNDS }),
      checkpointer: "sqlite",
      script: () => ({ turns: readingRounds() }),
    });
    await runDeepAgentTurn(first);
    expect(first.record.lastFullStatus!.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(first.record.toolCalls()).toHaveLength(MIN_TOOL_ROUNDS);

    // The follow-up's script is indexed by the rounds its transcript holds: a
    // model that saw the ten rounds answers in text; one that lost them would
    // play turn 0 and read a file.
    const LOST_THREAD: ScriptedTurn = {
      text: "Starting over.",
      toolCalls: [{ id: "call-hermetic-lost-thread", name: "read_file", args: { file_path: "/lost.md" } }],
    };
    const PICKED_UP: ScriptedTurn = { text: "Picking up where I left off: all ten files are read." };
    const roundsSeen: number[] = [];
    const record = deepAgentExecutionRecord({ message: "Continue.", maxToolRounds: MIN_TOOL_ROUNDS });
    const next = continueDeepAgentScenario(first, {
      record,
      script: () => ({ turns: [...Array.from({ length: MIN_TOOL_ROUNDS }, () => LOST_THREAD), PICKED_UP] }),
      onTurn: (info) => {
        roundsSeen.push(info.round);
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(next);

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect(roundsSeen, "the follow-up's one model turn saw the ten rounds the stop checkpointed").toEqual([MIN_TOOL_ROUNDS]);
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    const persisted = record.lastFullStatus!;
    expect(persisted.error).toBe("");
    const answer = persisted.messages.filter((m) => m.type === MessageType.MESSAGE_AI).at(-1);
    expect(answer?.content).toBe(PICKED_UP.text);
  });
});
