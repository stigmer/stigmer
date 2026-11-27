/**
 * Hermetic net: a conversation's checkpoint file keeps only what resume can
 * read, with the checkpoint ids and namespaces LangGraph really writes
 * (stigmer/stigmer#3117), through the REAL `ExecuteDeepAgent` activity on
 * the durable `sqlite` checkpointer.
 *
 * What the arm does: the root delegates to a declared helper with `task`
 * (the helper's graph saves under a nested `tools:<uuid>|…` namespace, as
 * `sub-agent-delegation.test.ts` describes), then takes two reading rounds,
 * then answers. A second message on the same session follows.
 *
 * What it pins:
 *  - after the first message the session's file holds the main graph's two
 *    newest checkpoints, only their writes, and none of the finished
 *    helper's rows. Until #3117 it held every superstep's full copy, the
 *    helper's included;
 *  - the second message resumes from that file: its model call sees the
 *    first message's whole transcript, and the file is back at two
 *    checkpoints after it.
 *
 * The rule itself, case by case, is `shared/checkpointer/__tests__/sqlite-saver.test.ts`;
 * this arm proves it holds for the engine's own saves, which a unit test's
 * made-up ids cannot.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
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
} from "../../../../__test-utils__/hermetic-activity.js";
import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  continueDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { completedToolRounds, type TurnPlayer } from "../../__test-utils__/scripted-model.js";

const FIRST_MESSAGE = "Ask the helper, then read two files.";
const HELPER_INSTRUCTIONS = "You are the hermetic checkpoint helper. Answer in one line.";
const READING_ROUNDS = 2;

/** The file's rows for the fixture thread: each checkpoint's namespace and id, and each write's. */
function fileRows(): { checkpoints: { ns: string; id: string }[]; writeCheckpoints: { ns: string; id: string }[] } {
  const db = new DatabaseSync(getCheckpointDbPath(FIXTURE.sessionId));
  try {
    const keys = (sql: string) =>
      (db.prepare(sql).all(FIXTURE.threadId) as { checkpoint_ns: string; checkpoint_id: string }[]).map((r) => ({ ns: r.checkpoint_ns, id: r.checkpoint_id }));
    return {
      checkpoints: keys("SELECT checkpoint_ns, checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_ns, checkpoint_id"),
      writeCheckpoints: keys("SELECT DISTINCT checkpoint_ns, checkpoint_id FROM writes WHERE thread_id = ? ORDER BY checkpoint_ns, checkpoint_id"),
    };
  } finally {
    db.close();
  }
}

/** Delegate once, read twice, answer. */
const rootPlayer: TurnPlayer = (transcript) => {
  const round = completedToolRounds(transcript);
  if (round === 0) {
    return {
      text: "Delegating to the helper.",
      toolCalls: [{ id: "call-hermetic-size-task", name: "task", args: { description: "Answer one question.", subagent_type: "helper" } }],
    };
  }
  if (round <= READING_ROUNDS) {
    return { text: `Reading file ${round}.`, toolCalls: [{ id: `call-hermetic-size-read-${round}`, name: "read_file", args: { file_path: `/f${round}.md` } }] };
  }
  return { text: "Done: the helper answered and both files are read." };
};

const helperPlayer: TurnPlayer = () => ({ text: "The answer is forty-two." });

describe("ExecuteDeepAgent hermetic — the checkpoint file keeps only what resume reads", () => {
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

  it("holds the main graph's two newest checkpoints after a turn with a helper, and the next message resumes from them", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const helper = savedAgentFixture("helper", { description: "Answers one question.", instructions: HELPER_INSTRUCTIONS });
    const first = beginDeepAgentScenario({
      env,
      clock,
      record: deepAgentExecutionRecord({ message: FIRST_MESSAGE, subagents: [helper] }),
      checkpointer: "sqlite",
      script: (_tools, context) => (context.systemPrompt.includes(HELPER_INSTRUCTIONS) ? helperPlayer : rootPlayer),
    });

    // ── Act: the first message ───────────────────────────────────────────────
    await runDeepAgentTurn(first);

    // ── Assert: the file holds two main checkpoints and only their writes ────
    expect(first.record.persistedPhases).toEqual([RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_COMPLETED]);
    expect(first.record.rowsOf(first.record.lastFullStatus!).subAgentRuns, "the helper ran").toHaveLength(1);
    const afterFirst = fileRows();
    expect(afterFirst.checkpoints.map((c) => c.ns), "two main checkpoints, none of the finished helper's").toEqual(["", ""]);
    const kept = new Set(afterFirst.checkpoints.map((c) => c.id));
    expect(afterFirst.writeCheckpoints.every((w) => w.ns === "" && kept.has(w.id)), "writes only for the kept checkpoints").toBe(true);

    // ── Act: the next message on the same session ────────────────────────────
    const transcripts: BaseMessage[][] = [];
    const record = deepAgentExecutionRecord({ message: "What did the helper say?", subagents: [helper], executionId: "run_hermetic_0002" });
    const next = continueDeepAgentScenario(first, {
      record,
      script: () => (transcript) => {
        transcripts.push([...transcript]);
        return { text: "It said forty-two." };
      },
    });
    await runDeepAgentTurn(next);

    // ── Assert: it resumed from the pruned file ──────────────────────────────
    expect(record.persistedPhases).toEqual([RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_COMPLETED]);
    expect(transcripts).toHaveLength(1);
    const seen = transcripts[0];
    expect(seen.some((m) => HumanMessage.isInstance(m) && String(m.content).includes(FIRST_MESSAGE)), "the first message is in its transcript").toBe(true);
    expect(completedToolRounds(seen), "the delegation and both readings are in its transcript").toBe(1 + READING_ROUNDS);
    expect(fileRows().checkpoints.map((c) => c.ns)).toEqual(["", ""]);
  });
});
