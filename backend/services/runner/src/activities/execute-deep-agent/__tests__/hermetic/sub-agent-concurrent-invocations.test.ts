/**
 * Hermetic net: two invocations of ONE sub-agent running at once, through
 * the REAL `ExecuteDeepAgent` activity (stigmer/stigmer#1699).
 *
 * The root's one model message delegates two tasks to the same declared
 * helper. langchain runs a message's tool calls together (one tools task per
 * call), so both invocations start in the same step and their model calls
 * interleave. Each must be watched as if it ran alone: loop detection, the
 * periodic round advisory and the cost advisory's "told" record are one
 * conversation's state. Until #1699 the stack was built once per sub-agent
 * spec, so the two invocations pooled that state: one history, one round
 * count, one told flag, and a pending advisory went to whichever called
 * next.
 *
 * The interleaving is forced, never left to the scheduler. `onTurn` runs
 * inside the model, after every middleware has decided that call, so a hold
 * there orders whole calls relative to each other; it cannot reorder a
 * decision within one call. Each arm's schedule is built from that rule so
 * the pooled stack fails it by construction:
 *  - loop detection: A repeats one read, B reads distinct files, in lockstep
 *    (every round's two responses land before either invocation's next call
 *    is decided). Pooled, B's reads break A's streak and A is never warned;
 *  - the periodic advisory: 30 rounds each, in lockstep. Pooled, the count
 *    reaches 30 after about 15 rounds each and an advisory rides an early call;
 *  - the cost view: A's second call crosses 80% of the cap, and B's next call
 *    is held until A's next call has been decided. Pooled, A spends the one
 *    told flag and B is never warned.
 *
 * A call is named by the tool call it answers (the last id in
 * `priorToolCallIds`), so every call after an invocation's first is
 * identifiable; ids carry the invocation (`a-<round>`, `b-<round>`) and are
 * unique, because the driver's settle barrier reads every transcript by id.
 *
 * The property itself, for every middleware and every interleaving, is
 * pinned in `subagent-transformer.test.ts`; the unit contracts are
 * `middleware/__tests__/`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { create } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

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
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import {
  completedToolRounds,
  type ScriptedTurn,
  type ScriptedTurnInfo,
  type TurnPlayer,
} from "../../__test-utils__/scripted-model.js";

const HELPER_INSTRUCTIONS = "You are the hermetic twin helper. Work through your task.";
const TASK_A = "Task A: work through the first list.";
const TASK_B = "Task B: work through the second list.";
const CHEAP = { inputTokens: 10, outputTokens: 10 } as const;

/** How long a held call may wait for the call it is ordered after; real time, as the driver's own barrier. */
const HOLD_TIMEOUT_MS = 10_000;

type Twin = "a" | "b";

function isAdvisory(message: BaseMessage | undefined): boolean {
  return HumanMessage.isInstance(message) && String(message.content).startsWith(ADVISORY_LEAD_IN);
}

/** The advisory texts one model call was handed, in order. */
function advisoriesOf(transcript: readonly BaseMessage[]): string[] {
  return transcript.filter(isAdvisory).map((m) => String(m.content));
}

/** Which invocation a helper transcript belongs to: its first human message is the task. */
function twinOf(transcript: readonly BaseMessage[]): Twin {
  const task = String(transcript.find((m) => HumanMessage.isInstance(m))?.content ?? "");
  if (task.includes(TASK_A)) return "a";
  if (task.includes(TASK_B)) return "b";
  throw new Error(`helper transcript carries neither task: ${task}`);
}

/**
 * Orders whole model calls across the two invocations. A call is named by
 * the tool call it answers; `after` maps a call to the call it may not run
 * before. Released only by arrivals, never by a timer; a schedule that
 * cannot be met rejects naming both calls instead of hanging the suite.
 */
class CallOrder {
  private readonly arrived = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly after: ReadonlyMap<string, string>) {}

  readonly onTurn = async (info: ScriptedTurnInfo): Promise<void> => {
    const call = info.priorToolCallIds.at(-1);
    if (call === undefined) return;
    this.arrived.add(call);
    for (const release of this.waiters.get(call) ?? []) release();
    this.waiters.delete(call);
    const awaited = this.after.get(call);
    if (awaited !== undefined) await this.until(call, awaited);
  };

  private until(call: string, awaited: string): Promise<void> {
    if (this.arrived.has(awaited)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the call answering ${call} waited ${HOLD_TIMEOUT_MS} ms for the call answering ${awaited}, which never came`)),
        HOLD_TIMEOUT_MS,
      );
      const release = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.set(awaited, [...(this.waiters.get(awaited) ?? []), release]);
    });
  }
}

/** Each invocation's round-k call waits for the other's round-k call, for every round before `rounds`. */
function lockstep(rounds: number): Map<string, string> {
  const after = new Map<string, string>();
  for (let k = 0; k < rounds; k++) {
    after.set(`a-${k}`, `b-${k}`);
    after.set(`b-${k}`, `a-${k}`);
  }
  return after;
}

/** The root: one message delegating both tasks to the helper, then a closing line. */
function rootPlayer(transcripts: BaseMessage[][]): TurnPlayer {
  return (transcript) => {
    transcripts.push([...transcript]);
    if (completedToolRounds(transcript) === 0) {
      return {
        text: "Delegating both lists to the helper.",
        toolCalls: [
          { id: "task-a", name: "task", args: { description: TASK_A, subagent_type: "helper" } },
          { id: "task-b", name: "task", args: { description: TASK_B, subagent_type: "helper" } },
        ],
        usage: CHEAP,
      } satisfies ScriptedTurn;
    }
    return { text: "Both lists are done.", usage: CHEAP };
  };
}

/** The helper, playing each invocation's own script and recording every transcript it is asked with. */
function helperPlayer(
  transcripts: Record<Twin, BaseMessage[][]>,
  turn: (twin: Twin, round: number) => ScriptedTurn,
): TurnPlayer {
  return (transcript) => {
    const twin = twinOf(transcript);
    transcripts[twin].push([...transcript]);
    return turn(twin, completedToolRounds(transcript));
  };
}

function read(twin: Twin, round: number, path: string): ScriptedTurn {
  return { text: `Reading ${path}.`, toolCalls: [{ id: `${twin}-${round}`, name: "read_file", args: { file_path: path } }], usage: CHEAP };
}

describe("ExecuteDeepAgent hermetic — concurrent invocations of one sub-agent", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();
  const helper = create(SubAgentSchema, {
    name: "helper",
    description: "Works through a list.",
    instructions: HELPER_INSTRUCTIONS,
  });

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

  /** Runs one turn of the root and its two helper invocations; returns every transcript, by role. */
  async function runTwins(options: {
    readonly after: ReadonlyMap<string, string>;
    readonly turn: (twin: Twin, round: number) => ScriptedTurn;
    readonly maxCostUsd?: number;
  }) {
    const root: BaseMessage[][] = [];
    const helpers: Record<Twin, BaseMessage[][]> = { a: [], b: [] };
    const record = deepAgentExecutionRecord({
      message: "Work through both lists.",
      subAgents: [helper],
      ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}),
    });
    const order = new CallOrder(options.after);
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (_tools, context) =>
        context.systemPrompt.includes(HELPER_INSTRUCTIONS) ? helperPlayer(helpers, options.turn) : rootPlayer(root),
      onTurn: order.onTurn,
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases, "the run completes").toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(record.lastFullStatus!.subAgentExecutions, "one row per invocation").toHaveLength(2);
    return { root, helpers };
  }

  it("warns the invocation that loops, on its own history, while the other runs beside it", async () => {
    const LOOP_ROUNDS = 7; // loop-detection.ts: consecutiveThreshold

    const { helpers } = await runTwins({
      after: lockstep(LOOP_ROUNDS),
      turn: (twin, round) => {
        if (round === LOOP_ROUNDS) return { text: `List ${twin} is done.`, usage: CHEAP };
        return twin === "a" ? read("a", round, "/same.md") : read("b", round, `/b${round}.md`);
      },
    });

    expect(helpers.a).toHaveLength(LOOP_ROUNDS + 1);
    expect(helpers.b).toHaveLength(LOOP_ROUNDS + 1);
    const warnedA = helpers.a.flatMap((t, i) => (advisoriesOf(t).some((a) => a.includes("LOOP WARNING")) ? [i] : []));
    expect(warnedA, "A is warned on the call after its seventh identical read, and only there").toEqual([LOOP_ROUNDS]);
    expect(helpers.b.some((t) => advisoriesOf(t).length > 0), "B, which never repeats itself, is never advised").toBe(false);
  });

  it("counts each invocation's rounds on its own: the periodic advisory comes on each one's 31st call", async () => {
    const ROUNDS = 30; // subagent-wiring.ts: SUB_AGENT_ADVISORY_INTERVAL

    const { helpers } = await runTwins({
      after: lockstep(ROUNDS),
      turn: (twin, round) =>
        round === ROUNDS ? { text: `List ${twin} is done.`, usage: CHEAP } : read(twin, round, `/${twin}${round}.md`),
    });

    for (const twin of ["a", "b"] as const) {
      const calls = helpers[twin];
      expect(calls).toHaveLength(ROUNDS + 1);
      const advised = calls.flatMap((t, i) => (advisoriesOf(t).length > 0 ? [i] : []));
      expect(advised, `${twin}: no advisory before its own 31st call, one on it`).toEqual([ROUNDS]);
      expect(advisoriesOf(calls[ROUNDS])).toHaveLength(1);
      expect(advisoriesOf(calls[ROUNDS])[0]).toContain(`${ROUNDS} model rounds`);
    }
  });

  it("warns each invocation once when the run nears its cost cap, not only the first to call", async () => {
    // $1.00 cap at the fixture's $1.00 per million input tokens: A's second
    // answer takes the run to about $0.85, past 80% and short of the cap.
    const CROSSING_INPUT_TOKENS = 850_000;

    const { root, helpers } = await runTwins({
      maxCostUsd: 1,
      after: new Map([
        // A's second call waits for B's second, so B is well under way;
        ["a-0", "b-0"],
        // B's second waits for A's third, which is decided after A crossed.
        ["b-0", "a-1"],
      ]),
      turn: (twin, round) => {
        if (round === 2) return { text: `List ${twin} is done.`, usage: CHEAP };
        const step = read(twin, round, `/${twin}${round}.md`);
        return twin === "a" && round === 1 ? { ...step, usage: { inputTokens: CROSSING_INPUT_TOKENS, outputTokens: 10 } } : step;
      },
    });

    for (const twin of ["a", "b"] as const) {
      const warned = helpers[twin].map((t) => advisoriesOf(t).filter((a) => a.includes("Budget warning")).length);
      expect(warned, `${twin}: told once, on its first call after the crossing`).toEqual([0, 0, 1]);
    }
    expect(root.map((t) => advisoriesOf(t).length), "the root is told once, on its call after the delegation").toEqual([0, 1]);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });
});
