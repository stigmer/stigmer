/**
 * Pins what the plugin-eval worker factory hands the manager's
 * createWorker: the eval queue from configuration (and the default queue
 * and its environment variable), every suite and case activity under its
 * byte-pinned name, and a workflow source (the prebuilt sibling bundle
 * when present, else the workflows entry).
 */
import type { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";

import { newPatternPool } from "../../../domain/plugin-eval/graders/patterns.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { CreateWorkerOptions, WorkerFactoryDeps } from "../../manager.js";
import {
  DEFAULT_EVALS_QUEUE,
  EvalsTemporalConfig,
  newEvalsConfigFromEnv,
} from "../config.js";
import {
  DELETE_VOTE_ACTIVITY_NAME,
  FINISH_EVAL_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  TRY_SPEND_ACTIVITY_NAME,
} from "../names.js";
import { newEvalsWorkerFactory } from "../worker.js";
import { catalog, suiteSource } from "./support.js";

const QUEUE_VARIABLE = "TEMPORAL_EVALS_STIGMER_TASK_QUEUE";

afterEach(() => {
  delete process.env[QUEUE_VARIABLE];
});

describe("the plugin-eval worker factory", () => {
  it("builds a worker on the configured queue with every activity and a workflow source", async () => {
    const temp = tempStore();
    const patterns = newPatternPool(1);
    try {
      const built: CreateWorkerOptions[] = [];
      const deps: WorkerFactoryDeps = {
        createWorker: (options) => {
          built.push(options);
          return Promise.resolve({} as Worker);
        },
        client: () => {
          throw new Error("the eval factory reads no client at boot");
        },
      };
      await newEvalsWorkerFactory({
        store: temp.store,
        config: new EvalsTemporalConfig("evals_custom"),
        suites: suiteSource(),
        catalog,
        tries: () => {
          throw new Error("no lane at boot");
        },
        sessions: () => ({ delete: () => Promise.resolve() }),
        recorder: () => ({ record: (score) => Promise.resolve(score) }),
        deleter: () => ({ delete: () => Promise.resolve() }),
        readArtifact: undefined,
        pluginEvalCaller: undefined,
        patterns,
        logger: silentLogger,
      })(deps);

      expect(built).toHaveLength(1);
      const options = built[0]!;
      expect(options.taskQueue).toBe("evals_custom");
      expect(Object.keys(options.activities).sort()).toEqual(
        [
          LOAD_SUITE_ACTIVITY_NAME,
          RECORD_TRY_ACTIVITY_NAME,
          FINISH_EVAL_ACTIVITY_NAME,
          START_TRY_ACTIVITY_NAME,
          POLL_RUN_ACTIVITY_NAME,
          STOP_RUN_ACTIVITY_NAME,
          GRADE_TRY_ACTIVITY_NAME,
          START_VOTE_ACTIVITY_NAME,
          READ_VOTE_ACTIVITY_NAME,
          DELETE_VOTE_ACTIVITY_NAME,
          RECORD_SCORE_ACTIVITY_NAME,
          TRY_SPEND_ACTIVITY_NAME,
        ].sort(),
      );
      const workflows = options.workflows as {
        readonly workflowsPath?: string;
        readonly workflowBundle?: { readonly codePath: string };
      };
      expect(
        workflows.workflowsPath ?? workflows.workflowBundle?.codePath ?? "",
      ).toMatch(/workflows\/index\.(ts|js)$|workflow-bundle-evals\.js$/);
    } finally {
      await patterns.close();
      await temp.cleanup();
    }
  });

  it("reads its queue from the environment, defaulting to its own", () => {
    expect(newEvalsConfigFromEnv().stigmerQueue).toBe(DEFAULT_EVALS_QUEUE);
    process.env[QUEUE_VARIABLE] = "evals_elsewhere";
    expect(newEvalsConfigFromEnv().stigmerQueue).toBe("evals_elsewhere");
  });
});
