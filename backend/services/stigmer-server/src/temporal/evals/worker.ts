/**
 * The plugin-eval worker factory: the suite and case workflows and their
 * activities on their own queue (config.ts), registered in the boot
 * workers list beside the grading worker and rebuilt by the manager on
 * every reconnect as it is (temporal/grading/worker.ts is the shape this
 * copies). The workflows register under their byte-pinned types through
 * the barrel's export names; the activities under their names as the
 * activities object's keys. The worker owns one pattern pool for its
 * graders, reused across activities (domain/plugin-eval/graders/patterns.ts).
 */
import type { Logger } from "../../boot/logger.js";
import type { EvalModelCatalog } from "../../domain/plugin-eval/matrix.js";
import type { PatternRunner } from "../../domain/plugin-eval/graders/patterns.js";
import { newPatternPool } from "../../domain/plugin-eval/graders/patterns.js";
import type { EvalSuiteSource } from "../../domain/plugin-eval/suite.js";
import type {
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../domain/score/ports.js";
import type { PluginEvalCallerMint } from "../../extensions/plugin-eval-caller.js";
import type { Store } from "../../store/interface.js";
import type { WorkerFactory } from "../manager.js";
import { resolveWorkflowSource } from "../workflow-source.js";
import { createCaseActivities } from "./case-activities.js";
import type { EvalsTemporalConfig } from "./config.js";
import { newEvalContextLoader } from "./context.js";
import type { PluginEvalTryLane } from "./ports.js";
import { createSuiteActivities } from "./suite-activities.js";

export interface EvalsWorkerDeps {
  readonly store: Store;
  readonly config: EvalsTemporalConfig;
  /** The plugin archive reader (domain/plugin-eval/suite.ts newPluginArchiveReader). */
  readonly suites: EvalSuiteSource;
  readonly catalog: EvalModelCatalog;
  readonly tries: () => PluginEvalTryLane;
  /** The try and vote sessions' delete (the judge session's deleter). */
  readonly sessions: () => JudgeSessionDeleter;
  readonly recorder: () => ScoreRecorder;
  readonly deleter: () => ScoreDeleter;
  /** The run artifact store's read; undefined when none is configured. */
  readonly readArtifact: ((storageKey: string) => Promise<Uint8Array>) | undefined;
  /** The composed caller; undefined = tries act as the server. */
  readonly pluginEvalCaller: PluginEvalCallerMint | undefined;
  /** The graders' pattern engine; default a pool of this worker's own. */
  readonly patterns?: PatternRunner;
  readonly logger: Logger;
}

export function newEvalsWorkerFactory(deps: EvalsWorkerDeps): WorkerFactory {
  const patterns = deps.patterns ?? newPatternPool();
  return async ({ createWorker }) => {
    const contexts = newEvalContextLoader({
      store: deps.store,
      suites: deps.suites,
      catalog: deps.catalog,
    });
    const activities = {
      ...createSuiteActivities({ store: deps.store, logger: deps.logger, contexts }),
      ...createCaseActivities({
        store: deps.store,
        logger: deps.logger,
        contexts,
        tries: deps.tries,
        sessions: deps.sessions,
        recorder: deps.recorder,
        deleter: deps.deleter,
        readArtifact: deps.readArtifact,
        pluginEvalCaller: deps.pluginEvalCaller,
        patterns,
      }),
    };

    const workflowSource = resolveWorkflowSource({
      workflowsEntryCandidates: [
        // Compiled dist (how conformance and the CLI boot the server).
        new URL("./workflows/index.js", import.meta.url),
        // The tsx dev loop runs from src/; the SDK bundler compiles TS.
        new URL("./workflows/index.ts", import.meta.url),
      ],
      prebuiltSibling: new URL("./workflow-bundle-evals.js", import.meta.url),
    });

    deps.logger.info("Creating plugin-eval Temporal worker", {
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
