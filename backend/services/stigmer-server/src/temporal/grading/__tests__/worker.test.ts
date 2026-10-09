/**
 * Pins what the grading worker factory hands the manager's createWorker:
 * the grading queue from configuration, both grading activities under
 * their byte-pinned names, and a workflow source (the prebuilt sibling
 * bundle when present, else the workflows entry). The worker itself is
 * the manager's to build (temporal/manager.ts).
 */
import type { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { CreateWorkerOptions, WorkerFactoryDeps } from "../../manager.js";
import { GradingTemporalConfig } from "../config.js";
import {
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
} from "../names.js";
import { newGradingWorkerFactory } from "../worker.js";

describe("the grading worker factory", () => {
  it("builds a worker on the configured queue with both activities and a workflow source", async () => {
    const temp = tempStore();
    try {
      const built: CreateWorkerOptions[] = [];
      const deps: WorkerFactoryDeps = {
        createWorker: (options) => {
          built.push(options);
          // The factory returns what createWorker built, unread.
          return Promise.resolve({} as Worker);
        },
        client: () => {
          throw new Error("the grading factory reads no client at boot");
        },
      };
      await newGradingWorkerFactory({
        store: temp.store,
        config: new GradingTemporalConfig("grading_custom"),
        recorder: () => ({ record: (score) => Promise.resolve(score) }),
        deleter: () => ({ delete: () => Promise.resolve() }),
        judgeRuns: () => ({
          create: (run) => Promise.resolve(run),
          terminate: () => Promise.resolve(),
        }),
        judgeSessions: () => ({ delete: () => Promise.resolve() }),
        gradingCaller: undefined,
        logger: silentLogger,
      })(deps);

      expect(built).toHaveLength(1);
      const options = built[0]!;
      expect(options.taskQueue).toBe("grading_custom");
      expect(Object.keys(options.activities).sort()).toEqual(
        [
          GRADE_RUN_HEALTH_ACTIVITY_NAME,
          PLAN_JUDGE_ACTIVITY_NAME,
          POLL_JUDGE_ACTIVITY_NAME,
          RECORD_JUDGE_ACTIVITY_NAME,
          RECORD_NOT_GRADED_ACTIVITY_NAME,
          START_JUDGE_ACTIVITY_NAME,
        ].sort(),
      );
      const workflows = options.workflows as {
        readonly workflowsPath?: string;
        readonly workflowBundle?: { readonly codePath: string };
      };
      expect(
        workflows.workflowsPath ?? workflows.workflowBundle?.codePath ?? "",
      ).toMatch(/workflows\/index\.(ts|js)$|workflow-bundle-grading\.js$/);
    } finally {
      await temp.cleanup();
    }
  });
});
