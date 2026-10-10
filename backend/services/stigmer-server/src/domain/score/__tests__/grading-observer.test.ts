/**
 * Pins the grading observer, the core's run-status observer:
 *   - only a move to COMPLETED starts the grading workflow, under the run's
 *     own id on the configured queue, refusing duplicates;
 *   - "already started" is success and writes nothing;
 *   - no engine, a refused start, or a start that never answers records a
 *     not-graded run-health score with its reason, so the run reads "not
 *     graded" rather than nothing;
 *   - a start that never answers holds the observer, and with it the run's
 *     broadcast, no longer than its deadline.
 *
 * The engine is a fake whose `connection.withDeadline` honours the
 * deadline the way the SDK's does: the call fails once it passes.
 */
import { create } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { GradingTemporalConfig } from "../../../temporal/grading/config.js";
import {
  GRADE_RUN_WORKFLOW_TYPE,
  gradeRunWorkflowId,
} from "../../../temporal/grading/names.js";
import { RUN_HEALTH_EVALUATOR_VERSION } from "../checks/checks.js";
import { GRADING_NOT_STARTED_REASON, RUN_HEALTH_METRIC } from "../constants.js";
import { newGradingObserver } from "../grading-observer.js";
import { PLUGIN_EVAL_LABEL } from "../../plugin-eval/constants.js";
import { GRADES_RUN_LABEL } from "../judge/judge-run.js";
import type { ScoreRecorder } from "../ports.js";

const config = new GradingTemporalConfig("grading_test_queue");

const run: Run = create(RunSchema, {
  metadata: { id: "run_1", org: "org_1" },
  spec: { target: { case: "sessionId", value: "ses_1" } },
  status: { phase: RunPhase.RUN_COMPLETED },
});

function recorder(): ScoreRecorder & { readonly recorded: Score[] } {
  const recorded: Score[] = [];
  return {
    recorded,
    record: (score) => {
      recorded.push(score);
      return Promise.resolve(score);
    },
  };
}

/** A fake engine whose start does what `start` says, under a real deadline. */
function engine(start: () => Promise<unknown>) {
  const startSpy = vi.fn(start);
  const client = {
    connection: {
      withDeadline: <R>(
        deadline: number | Date,
        fn: () => Promise<R>,
      ): Promise<R> => {
        const ms = Number(deadline) - Date.now();
        return Promise.race([
          fn(),
          new Promise<R>((_, reject) =>
            setTimeout(
              () => reject(new Error("DEADLINE_EXCEEDED")),
              Math.max(ms, 0),
            ),
          ),
        ]);
      },
    },
    workflow: { start: startSpy },
  };
  return { client: client as unknown as Client, startSpy };
}

function observe(
  client: Client | undefined,
  rec: ScoreRecorder,
  startDeadlineMs = 2_000,
) {
  return newGradingObserver({
    client: () => client,
    config,
    recorder: () => rec,
    logger: silentLogger,
    startDeadlineMs,
  });
}

function expectNotGraded(scores: Score[]): void {
  expect(scores).toHaveLength(1);
  const score = scores[0];
  expect(score?.spec?.runId).toBe("run_1");
  expect(score?.spec?.metric).toBe(RUN_HEALTH_METRIC);
  expect(score?.spec?.source).toBe(ScoreSource.check);
  expect(score?.spec?.evaluatorVersion).toBe(RUN_HEALTH_EVALUATOR_VERSION);
  expect(score?.spec?.value.case).toBeUndefined();
  expect(score?.status?.notGradedReason).toBe(GRADING_NOT_STARTED_REASON);
  // State is the create chain's to stamp; the request carries the reason.
  expect(score?.status?.state ?? ScoreState.unspecified).toBe(
    ScoreState.unspecified,
  );
}

describe("the grading observer", () => {
  it("never grades a judge run: grading the grader would spend a judge on every judge", async () => {
    const { client, startSpy } = engine(() => Promise.resolve({}));
    const rec = recorder();
    const judge = create(RunSchema, {
      metadata: { id: "run_judge", org: "org_1", labels: { [GRADES_RUN_LABEL]: "run_1" } },
      status: { phase: RunPhase.RUN_COMPLETED },
    });
    await observe(client, rec)({
      run: judge,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expect(startSpy).not.toHaveBeenCalled();
    expect(rec.recorded).toEqual([]);
  });

  it("never grades a plugin eval's run: the eval grades its own tries", async () => {
    const { client, startSpy } = engine(() => Promise.resolve({}));
    const rec = recorder();
    const evalTry = create(RunSchema, {
      metadata: { id: "run_try", org: "org_1", labels: { [PLUGIN_EVAL_LABEL]: "pev_1" } },
      status: { phase: RunPhase.RUN_COMPLETED },
    });
    await observe(client, rec)({
      run: evalTry,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expect(startSpy).not.toHaveBeenCalled();
    expect(rec.recorded).toEqual([]);
  });

  it("starts the grading workflow when a run completes, once per run", async () => {
    const { client, startSpy } = engine(() => Promise.resolve({}));
    const rec = recorder();
    await observe(
      client,
      rec,
    )({
      run,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expect(startSpy).toHaveBeenCalledTimes(1);
    const [type, options] = startSpy.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(type).toBe(GRADE_RUN_WORKFLOW_TYPE);
    expect(options).toMatchObject({
      workflowId: gradeRunWorkflowId("run_1"),
      taskQueue: "grading_test_queue",
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      args: ["run_1"],
    });
    expect(rec.recorded).toEqual([]);
  });

  it("starts nothing for any other phase", async () => {
    const { client, startSpy } = engine(() => Promise.resolve({}));
    const rec = recorder();
    for (const newPhase of [
      RunPhase.RUN_IN_PROGRESS,
      RunPhase.RUN_FAILED,
      RunPhase.RUN_CANCELLED,
      RunPhase.RUN_TERMINATED,
    ]) {
      await observe(
        client,
        rec,
      )({ run, oldPhase: RunPhase.RUN_PENDING, newPhase });
    }
    expect(startSpy).not.toHaveBeenCalled();
    expect(rec.recorded).toEqual([]);
  });

  it("counts an already started grading as success", async () => {
    const { client } = engine(() =>
      Promise.reject(
        new WorkflowExecutionAlreadyStartedError(
          "already",
          gradeRunWorkflowId("run_1"),
          GRADE_RUN_WORKFLOW_TYPE,
        ),
      ),
    );
    const rec = recorder();
    await observe(
      client,
      rec,
    )({
      run,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expect(rec.recorded).toEqual([]);
  });

  it("records the run as not graded when there is no engine", async () => {
    const rec = recorder();
    await observe(
      undefined,
      rec,
    )({
      run,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expectNotGraded(rec.recorded);
  });

  it("records the run as not graded when the start is refused", async () => {
    const { client } = engine(() =>
      Promise.reject(new Error("namespace not found")),
    );
    const rec = recorder();
    await observe(
      client,
      rec,
    )({
      run,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    expectNotGraded(rec.recorded);
  });

  it("holds the run no longer than its deadline when the engine never answers", async () => {
    const { client } = engine(() => new Promise(() => {}));
    const rec = recorder();
    const started = Date.now();
    await observe(
      client,
      rec,
      150,
    )({
      run,
      oldPhase: RunPhase.RUN_IN_PROGRESS,
      newPhase: RunPhase.RUN_COMPLETED,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1_000);
    expectNotGraded(rec.recorded);
  });
});
