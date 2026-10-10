/**
 * Pins the eval activities over a real store, a real suite read by
 * `readEvalSuite`, and doubles for the in-process lane and the score
 * chain:
 *
 *   - load: the status skeleton (cases in order, the unsupported case
 *     listed not run, notes, pending tries per arm, the tries in all, phase
 *     running, the delta provisional) and the cells with their time limits;
 *     a retried load plans again without rewriting; an eval gone or ended
 *     plans nothing; an unreadable suite is retried, then fails the eval;
 *   - record and finish: a try folded into its place with the scores
 *     recomputed; completed and partial ends; an ended eval left alone;
 *   - start-try: the session (label, subject, the arm's agent) and the run
 *     (model, tools, auto-approve) as the minted caller; the without-arm
 *     on the bare assistant; a retried start adopts its earlier run;
 *     capacity thrown as busy; credit, the run's own refusal and a refusing
 *     caller answered, and a refused run's session deleted;
 *   - grade-try: the code graders over the trace, the AI-graded check left
 *     to votes, the run's error and cost; a timeout named;
 *   - start-vote, read-vote and delete-vote: the vote's labels, message
 *     and cap, its adoption on a retry, its reading and its stop (its
 *     session kept, so a retried read reads it again), then its session's
 *     delete;
 *   - record-score: the votes tallied, the try scored, and the Score
 *     written once; a not-graded grader leaves the try not graded.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApplicationFailure } from "@temporalio/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  MessageType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { PLUGIN_EVAL_LABEL } from "../../../domain/plugin-eval/constants.js";
import { newPatternPool } from "../../../domain/plugin-eval/graders/patterns.js";
import { GRADES_RUN_LABEL } from "../../../domain/score/judge/judge-run.js";
import { listRunScores } from "../../../domain/score/queries.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { PluginEvalCallerRefusedError } from "../../../extensions/plugin-eval-caller.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { createCaseActivities } from "../case-activities.js";
import { newEvalContextLoader } from "../context.js";
import {
  DELETE_VOTE_ACTIVITY_NAME,
  FINISH_EVAL_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  OUT_OF_CREDIT_REASON,
  PLUGIN_EVAL_BUSY_FAILURE_TYPE,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
} from "../names.js";
import type { CaseInput, TryResult } from "../names.js";
import {
  SUITE_UNREADABLE_ERROR,
  createSuiteActivities,
} from "../suite-activities.js";
import {
  EVAL_ID,
  ORG,
  catalog,
  lane,
  readEval,
  scoreChain,
  seedEval,
  seedPlugin,
  silentLogger,
  suiteSource,
} from "./support.js";

let temp: TempStore;
const pool = newPatternPool(1);

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

const CALLER: CallerIdentity = {
  identityId: "acc_eval",
  callerClass: "user",
} as CallerIdentity;

function build(
  options: {
    attempt?: number;
    refuseCaller?: boolean;
    source?: ReturnType<typeof suiteSource>;
  } = {},
) {
  const source = options.source ?? suiteSource();
  const contexts = newEvalContextLoader({
    store: temp.store,
    suites: source,
    catalog,
  });
  const doubles = lane(temp.store);
  const chain = scoreChain(temp.store);
  const minted: Array<{ org: string; evalId: string }> = [];
  const suite = createSuiteActivities({
    store: temp.store,
    logger: silentLogger,
    contexts,
    attempt: () => options.attempt ?? 1,
  });
  const cases = createCaseActivities({
    store: temp.store,
    logger: silentLogger,
    contexts,
    tries: () => doubles.lane,
    sessions: () => doubles.sessions,
    recorder: () => chain.recorder,
    deleter: () => chain.deleter,
    readArtifact: undefined,
    pluginEvalCaller: {
      async mintPluginEvalCaller(org, evalId) {
        minted.push({ org, evalId });
        if (options.refuseCaller === true) {
          throw new PluginEvalCallerRefusedError("the creator left");
        }
        return CALLER;
      },
    },
    patterns: pool,
    attempt: () => options.attempt ?? 1,
  });
  return { suite, cases, source, record: doubles.record, minted };
}

const CELL: CaseInput = {
  evalId: EVAL_ID,
  org: ORG,
  caseIndex: 0,
  targetIndex: 0,
  arm: "with",
  tryIndex: 0,
  timeoutSeconds: 120,
  budgetUsd: 4,
};

async function seeded(spec: Parameters<typeof seedEval>[1] = {}) {
  await seedPlugin(temp.store);
  await seedEval(temp.store, spec);
}

describe("load-suite", () => {
  it("writes the status skeleton and plans the cells", async () => {
    await seeded();
    const { suite } = build();
    const plan = await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    expect(plan.cells).toEqual([
      {
        caseIndex: 0,
        targetIndex: 0,
        arm: "with",
        tryIndex: 0,
        timeoutSeconds: 120,
      },
      {
        caseIndex: 0,
        targetIndex: 0,
        arm: "with",
        tryIndex: 1,
        timeoutSeconds: 120,
      },
      {
        caseIndex: 0,
        targetIndex: 0,
        arm: "without",
        tryIndex: 0,
        timeoutSeconds: 120,
      },
      {
        caseIndex: 0,
        targetIndex: 0,
        arm: "without",
        tryIndex: 1,
        timeoutSeconds: 120,
      },
    ]);
    expect(plan).toMatchObject({ org: ORG, maxCostUsd: 5, concurrency: 1 });

    const status = (await readEval(temp.store)).status!;
    expect(status.phase).toBe(PluginEvalPhase.running);
    expect(status.triesTotal).toBe(4);
    expect(status.provisionalDelta).toBe(true);
    expect(status.startedAt).toBeDefined();
    expect(status.cases.map((c) => [c.caseName, c.notRunReason])).toEqual([
      ["first-case", ""],
      ["scaffolded", "not run: context.scaffold_script"],
    ]);
    const first = status.cases[0]!;
    expect(first.notes).toEqual([
      "max_turns 4 raised to the run's minimum of 10 tool rounds",
      "Bash not granted: the eval's allow_tools does not grant it",
    ]);
    expect(
      first.targets[0]?.withPlugin?.tries.map((t) => [t.index, t.state]),
    ).toEqual([
      [1, PluginEvalTryState.pending],
      [2, PluginEvalTryState.pending],
    ]);
    expect(first.targets[0]?.withoutPlugin?.tries).toHaveLength(2);
    expect(status.aggregates?.casesNotRun).toBe(1);
  });

  it("plans without a comparison under ablation none", async () => {
    await seeded({ ablation: PluginEvalAblation.none, concurrency: 3 });
    const plan = await build().suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    expect(plan).toMatchObject({ kind: "run", concurrency: 3 });
    expect(
      (await readEval(temp.store)).status?.cases[0]?.targets[0]?.withoutPlugin,
    ).toBeUndefined();
  });

  it("plans a retried load again without rewriting the status", async () => {
    await seeded();
    const { suite } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await suite[RECORD_TRY_ACTIVITY_NAME](EVAL_ID, { ...CELL }, graded(1));
    const again = await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    expect(again.kind).toBe("run");
    expect(
      (await readEval(temp.store)).status?.cases[0]?.targets[0]?.withPlugin
        ?.tries[0]?.state,
    ).toBe(PluginEvalTryState.graded);
  });

  it("plans nothing for an eval gone or ended", async () => {
    const { suite } = build();
    expect(await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID)).toEqual({
      kind: "stop",
    });
    await seedPlugin(temp.store);
    await seedEval(temp.store, {}, PluginEvalPhase.partial);
    expect(await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID)).toEqual({
      kind: "stop",
    });
  });

  it("retries an unreadable suite, then fails the eval", async () => {
    await seeded();
    const source = suiteSource();
    source.broken = true;
    await expect(
      build({ source, attempt: 1 }).suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID),
    ).rejects.toThrow("unreadable");
    expect(
      await build({ source, attempt: 3 }).suite[LOAD_SUITE_ACTIVITY_NAME](
        EVAL_ID,
      ),
    ).toEqual({ kind: "stop" });
    const status = (await readEval(temp.store)).status!;
    expect(status.phase).toBe(PluginEvalPhase.failed);
    expect(status.error).toBe(SUITE_UNREADABLE_ERROR);
  });
});

function graded(score: number, costUsd = 0.1): TryResult {
  return {
    sessionId: "ses_x",
    runId: "run_x",
    state: "graded",
    score,
    notGradedReason: "",
    error: "",
    costUsd,
    durationSeconds: 3,
    graderResults: [],
    outOfCredit: false,
  };
}

describe("record-try and finish-eval", () => {
  it("folds each try into its place and recomputes the scores", async () => {
    await seeded();
    const { suite } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { ...CELL, tryIndex: 0 },
      graded(1),
    );
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { ...CELL, tryIndex: 1 },
      graded(0.5),
    );
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { ...CELL, arm: "without" },
      {
        ...graded(0),
        state: "not-graded",
        notGradedReason: "platform busy",
      },
    );
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { ...CELL, caseIndex: 7 },
      graded(1),
    );
    const status = (await readEval(temp.store)).status!;
    const target = status.cases[0]!.targets[0]!;
    expect(target.withPlugin?.score).toBeCloseTo(0.75);
    expect(target.withPlugin?.tries[0]).toMatchObject({
      sessionId: "ses_x",
      runId: "run_x",
      durationSeconds: 3,
    });
    expect(target.withoutPlugin?.tries[0]).toMatchObject({
      state: PluginEvalTryState.not_graded,
      notGradedReason: "platform busy",
    });
    expect(target.withoutPlugin?.score).toBeUndefined();
    expect(status.triesFinished).toBe(3);
    expect(status.costUsd).toBeCloseTo(0.3);
  });

  it("ends completed or partial, and leaves an ended eval alone", async () => {
    await seeded();
    const { suite } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await suite[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, {
      phase: "partial",
      reason: "cost_ceiling",
    });
    let status = (await readEval(temp.store)).status!;
    expect(status.phase).toBe(PluginEvalPhase.partial);
    expect(status.partialReason).toBe(PluginEvalPartialReason.cost_ceiling);
    expect(status.finishedAt).toBeDefined();
    await suite[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, { phase: "completed" });
    status = (await readEval(temp.store)).status!;
    expect(status.phase).toBe(PluginEvalPhase.partial);
  });

  it("ends completed with no partial reason", async () => {
    await seeded();
    const { suite } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await suite[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, { phase: "completed" });
    expect((await readEval(temp.store)).status).toMatchObject({
      phase: PluginEvalPhase.completed,
      partialReason: PluginEvalPartialReason.unspecified,
    });
  });
});

describe("start-try", () => {
  it("creates the try's session and run as the eval's caller", async () => {
    await seeded();
    const { cases, record, minted } = build();
    const start = await cases[START_TRY_ACTIVITY_NAME](CELL);
    expect(start).toEqual({
      kind: "started",
      sessionId: "ses_1",
      runId: "run_2",
    });
    expect(minted).toEqual([{ org: ORG, evalId: EVAL_ID }]);
    const session = record.sessions[0]!;
    expect(session.caller).toBe(CALLER);
    expect(session.session.metadata?.labels).toEqual({
      [PLUGIN_EVAL_LABEL]: EVAL_ID,
    });
    expect(session.session.spec?.subject).toBe("first-case");
    expect(session.session.spec?.harness).toBe(Harness.NATIVE);
    expect(session.session.spec?.agentRef?.slug).toBe("thermos");
    const run = record.runs[0]!;
    expect(run.caller).toBe(CALLER);
    expect(run.run.spec?.target).toEqual({ case: "sessionId", value: "ses_1" });
    expect(run.run.spec?.autoApproveAll).toBe(true);
    expect(run.run.spec?.tools).toEqual(["Read", "Skill"]);
    expect(run.run.spec?.disallowedTools).toEqual(["mcp__github"]);
    expect(run.run.spec?.runConfig?.maxToolRounds).toBe(10);
    expect(run.run.spec?.runConfig?.maxCostUsd, "capped at the budget the suite passed").toBe(4);
  });

  it("runs the without-arm on the bare assistant", async () => {
    await seeded();
    const { cases, record } = build();
    await cases[START_TRY_ACTIVITY_NAME]({ ...CELL, arm: "without" });
    expect(record.sessions[0]?.session.spec?.agentRef).toBeUndefined();
    expect(record.sessions[0]?.session.spec?.mcpServerUsages).toEqual([]);
  });

  it("adopts the run an earlier attempt created", async () => {
    await seeded();
    const first = build();
    const started = await first.cases[START_TRY_ACTIVITY_NAME](CELL);
    const retried = build({ attempt: 2 });
    expect(await retried.cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual(started);
    expect(retried.record.runs).toEqual([]);
  });

  it("throws a capacity refusal for the workflow's retries", async () => {
    await seeded();
    const { cases, record } = build();
    record.refuse = new ConnectError(
      "sandboxes are full",
      Code.ResourceExhausted,
    );
    const failure = await cases[START_TRY_ACTIVITY_NAME](CELL).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect((failure as ApplicationFailure).type).toBe(
      PLUGIN_EVAL_BUSY_FAILURE_TYPE,
    );
  });

  it("answers credit, the run's own refusal and a refusing caller, deleting a refused run's session", async () => {
    await seeded();
    const { cases, record } = build();
    record.refuse = new ConnectError(
      "insufficient credits",
      Code.FailedPrecondition,
    );
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "out-of-credit",
      reason: OUT_OF_CREDIT_REASON,
    });
    expect(record.deletedSessions).toEqual(["ses_1"]);
    record.refuse = new ConnectError(
      "model 'gpt-5' needs an OpenAI key",
      Code.FailedPrecondition,
    );
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: "model 'gpt-5' needs an OpenAI key",
    });
    expect(
      await build({ refuseCaller: true }).cases[START_TRY_ACTIVITY_NAME](CELL),
    ).toMatchObject({
      kind: "refused",
      failure: "cannot-act",
    });
  });

  it("refuses a cell the eval no longer plans", async () => {
    await seeded();
    expect(
      await build().cases[START_TRY_ACTIVITY_NAME]({ ...CELL, caseIndex: 9 }),
    ).toMatchObject({
      kind: "refused",
      failure: "not-started",
    });
  });
});

/** Ends the stored run as completed with a transcript that reads the skill and names the rename. */
async function completeTry(
  runId: string,
  phase: RunPhase = RunPhase.RUN_COMPLETED,
): Promise<void> {
  await temp.store.updateResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    (live) => {
      live.status = create(RunSchema, {
        status: {
          phase,
          startedAt: "2026-10-10T10:00:00Z",
          completedAt: "2026-10-10T10:00:30Z",
          error: phase === RunPhase.RUN_FAILED ? "the model refused" : "",
          streamingUsage: { estimatedCostUsd: 0.2 },
          messages: [
            {
              type: MessageType.MESSAGE_HUMAN,
              content: "Write me a commit message.",
            },
            {
              type: MessageType.MESSAGE_AI,
              content: "",
              toolCalls: [
                {
                  id: "c1",
                  name: "read_file",
                  args: {
                    file_path: ".stigmer/skills/commit-message/SKILL.md",
                  },
                },
              ],
            },
            {
              type: MessageType.MESSAGE_AI,
              content: "refactor: rename getUser to fetchUser",
            },
          ],
        },
      }).status;
    },
  );
}

describe("poll-run and stop-run", () => {
  it("reads an ended or gone run as ended, and stops a run once", async () => {
    await seeded();
    const { cases, record } = build();
    const start = await cases[START_TRY_ACTIVITY_NAME](CELL);
    if (start.kind !== "started") throw new Error("not started");
    expect(await cases[POLL_RUN_ACTIVITY_NAME](start.runId)).toBe(false);
    await cases[STOP_RUN_ACTIVITY_NAME](start.runId, "timed out after 120s");
    expect(record.terminated).toEqual([start.runId]);
    expect(await cases[POLL_RUN_ACTIVITY_NAME](start.runId)).toBe(true);
    expect(await cases[POLL_RUN_ACTIVITY_NAME]("run_gone")).toBe(true);
    await cases[STOP_RUN_ACTIVITY_NAME]("run_gone", "x");
  });
});

describe("grading a try", () => {
  async function startedTry() {
    await seeded();
    const built = build();
    const start = await built.cases[START_TRY_ACTIVITY_NAME](CELL);
    if (start.kind !== "started") throw new Error("not started");
    return { ...built, start };
  }

  it("runs the code graders and leaves the AI-graded check to votes", async () => {
    const { cases, start } = await startedTry();
    await completeTry(start.runId);
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    expect(grade.outcomes).toEqual([
      { votes: "criteria" },
      expect.objectContaining({ passed: true }),
      expect.objectContaining({ passed: true }),
    ]);
    expect(grade).toMatchObject({
      error: "",
      costUsd: 0.2,
      durationSeconds: 30,
    });
    const timedOut = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      true,
    );
    expect(timedOut.error).toBe("timed out after 120s");
  });

  it("names a failed run's error, and a gone run leaves the try not graded", async () => {
    const { cases, start } = await startedTry();
    await completeTry(start.runId, RunPhase.RUN_FAILED);
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false)).error,
    ).toBe("the model refused");
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](CELL, "run_gone", false)).outcomes,
    ).toEqual([{ notGraded: "the try's run was deleted" }]);
  });

  it("starts a vote as a judge run of the try, adopts it on a retry, reads it and deletes its session", async () => {
    const { cases, start, record } = await startedTry();
    await completeTry(start.runId);
    const vote = await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, 0, 0);
    expect(vote.kind).toBe("started");
    if (vote.kind !== "started") return;
    const voteRun = record.runs[1]!.run;
    expect(voteRun.metadata?.labels).toEqual({
      [GRADES_RUN_LABEL]: start.runId,
      [PLUGIN_EVAL_LABEL]: EVAL_ID,
    });
    expect(voteRun.spec?.message).toContain(
      "PASS if the message names the rename.",
    );
    expect(voteRun.spec?.runConfig?.maxCostUsd).toBe(0.25);
    expect(record.sessions[1]?.session.metadata?.labels).toEqual({
      [PLUGIN_EVAL_LABEL]: EVAL_ID,
    });

    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, 0, 0),
    ).toEqual(vote);
    expect(record.runs).toHaveLength(2);

    expect(
      await cases[READ_VOTE_ACTIVITY_NAME](vote.voteRunId, "criteria"),
    ).toMatchObject({
      vote: { kind: "failed" },
    });
    expect(record.terminated).toEqual([vote.voteRunId]);
    expect(record.deletedSessions).toEqual([]);
    await cases[DELETE_VOTE_ACTIVITY_NAME](vote.voteRunId);
    expect(record.deletedSessions).toEqual([
      record.sessions[1]?.session.metadata?.id,
    ]);

    const second = await cases[START_VOTE_ACTIVITY_NAME](
      CELL,
      start.runId,
      0,
      1,
    );
    if (second.kind !== "started") throw new Error("not started");
    await temp.store.updateResource(
      ApiResourceKind.run,
      second.voteRunId,
      RunSchema,
      (live) => {
        live.status = create(RunSchema, {
          status: {
            phase: RunPhase.RUN_COMPLETED,
            structuredOutput: {
              criteria: { result: "passed", reason: "names the rename" },
            },
            streamingUsage: { estimatedCostUsd: 0.01 },
          },
        }).status;
      },
    );
    expect(
      await cases[READ_VOTE_ACTIVITY_NAME](second.voteRunId, "criteria"),
    ).toEqual({
      vote: { kind: "vote", passed: true, reason: "names the rename" },
      costUsd: 0.01,
    });
  });

  it("tallies the votes, scores the try and writes its Score once", async () => {
    const { cases, start } = await startedTry();
    await completeTry(start.runId);
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    const pass = { kind: "vote", passed: true, reason: "yes" } as const;
    const fail = { kind: "vote", passed: false, reason: "no" } as const;
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](CELL, start, grade, [
      [pass, fail, pass],
      [],
      [],
    ]);
    expect(result).toMatchObject({
      state: "graded",
      score: 1,
      sessionId: start.sessionId,
      runId: start.runId,
    });
    expect(result.graderResults.map((g) => [g.name, g.scored])).toEqual([
      ["criteria", true],
      ["mentions", true],
      ["skill-fired", false],
    ]);
    await cases[RECORD_SCORE_ACTIVITY_NAME](CELL, start, grade, [
      [pass, fail, pass],
      [],
      [],
    ]);
    const scores = (
      await listRunScores(temp.store, silentLogger, start.runId)
    ).filter((score) => score.spec?.source === ScoreSource.eval);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.spec?.value).toEqual({ case: "passed", value: true });

    const failing = await cases[RECORD_SCORE_ACTIVITY_NAME](
      CELL,
      start,
      grade,
      [[fail, fail, pass], [], []],
    );
    expect(failing.score).toBeCloseTo(2 / 3);
  });

  it("leaves the try not graded when a check is", async () => {
    const { cases, start } = await startedTry();
    await completeTry(start.runId);
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    const broken = { kind: "failed", reason: OUT_OF_CREDIT_REASON } as const;
    const pass = { kind: "vote", passed: true, reason: "yes" } as const;
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](CELL, start, grade, [
      [pass, broken, broken],
      [],
      [],
    ]);
    expect(result).toMatchObject({
      state: "not-graded",
      notGradedReason: OUT_OF_CREDIT_REASON,
      outOfCredit: true,
    });
  });
});
