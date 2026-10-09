/**
 * The grading worker factory: the grading workflow, its run-health
 * activities and the AI judge's (judge-activities.ts) on their own queue
 * (config.ts), registered in the boot workers list beside
 * the agent-execution and schedule workers, and rebuilt by the manager on
 * every reconnect as they are (temporal/schedule/worker.ts is the shape
 * this copies). The workflow registers under its byte-pinned type through
 * the barrel's export name; the activities under their names as the
 * activities object's keys.
 */
import type { Logger } from "../../boot/logger.js";
import type {
  JudgeRunCreator,
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../domain/score/ports.js";
import type { GradingCallerMint } from "../../extensions/grading-caller.js";
import type { Store } from "../../store/interface.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import { createGradingActivities } from "./activities.js";
import { createJudgeActivities } from "./judge-activities.js";
import type { GradingTemporalConfig } from "./config.js";

export interface GradingWorkerDeps {
  readonly store: Store;
  readonly config: GradingTemporalConfig;
  readonly recorder: () => ScoreRecorder;
  readonly deleter: () => ScoreDeleter;
  readonly judgeRuns: () => JudgeRunCreator;
  readonly judgeSessions: () => JudgeSessionDeleter;
  /** The composed grading caller; undefined = judge runs act as the server. */
  readonly gradingCaller: GradingCallerMint | undefined;
  readonly logger: Logger;
}

export function newGradingWorkerFactory(
  deps: GradingWorkerDeps,
): WorkerFactory {
  return async ({ createWorker }) => {
    const activities = {
      ...createGradingActivities({
        store: deps.store,
        logger: deps.logger,
        recorder: deps.recorder,
        deleter: deps.deleter,
      }),
      ...createJudgeActivities({
        store: deps.store,
        logger: deps.logger,
        recorder: deps.recorder,
        deleter: deps.deleter,
        runs: deps.judgeRuns,
        sessions: deps.judgeSessions,
        gradingCaller: deps.gradingCaller,
      }),
    };

    const workflowSource = resolveWorkflowSource({
      workflowsEntryCandidates: [
        // Compiled dist (how conformance and the CLI boot the server).
        new URL("./workflows/index.js", import.meta.url),
        // The tsx dev loop runs from src/; the SDK bundler compiles TS.
        new URL("./workflows/index.ts", import.meta.url),
      ],
      prebuiltSibling: new URL("./workflow-bundle-grading.js", import.meta.url),
    });

    deps.logger.info("Creating grading Temporal worker", {
      queue: deps.config.stigmerQueue,
      workflow_source: workflowSource.kind,
    });

    return createWorker({
      taskQueue: deps.config.stigmerQueue,
      activities,
      workflows:
        workflowSource.kind === "prebuilt"
          ? { workflowBundle: { codePath: workflowSource.codePath } }
          : { workflowsPath: workflowSource.workflowsPath },
    });
  };
}
