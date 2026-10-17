/**
 * Pins what the routine-clock worker factory hands the manager's
 * createWorker: the clock's own queue from configuration (never the
 * agent-execution queue, so long-tracking ticks cannot starve runs), the
 * five tick activities under their byte-pinned names, and a workflow
 * source (the prebuilt sibling bundle when present, else the workflows
 * entry). The worker itself is the manager's to build
 * (temporal/manager.ts).
 */
import type { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { CreateWorkerOptions, WorkerFactoryDeps } from "../../manager.js";
import { RoutineArtifact } from "../artifact.js";
import { RoutineTemporalConfig } from "../config.js";
import {
  POLL_EXECUTION_PHASE_ACTIVITY_NAME,
  RECORD_FAILED_RUN_ACTIVITY_NAME,
  RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
  RECORD_TICK_ACTIVITY_NAME,
  START_SCHEDULED_RUN_ACTIVITY_NAME,
} from "../names.js";
import { RunStarter } from "../run-starter.js";
import { RoutineSyncer } from "../syncer.js";
import { newRoutineWorkerFactory } from "../worker.js";

describe("the routine worker factory", () => {
  it("builds a worker on the clock's configured queue with the five tick activities and a workflow source", async () => {
    const temp = tempStore();
    try {
      const config = new RoutineTemporalConfig("routine_custom", 60, 24, 5, 60, true, 5, 20, 1.0, 90);
      const built: CreateWorkerOptions[] = [];
      const deps: WorkerFactoryDeps = {
        createWorker: (options) => {
          built.push(options);
          // The factory returns what createWorker built, unread.
          return Promise.resolve({} as Worker);
        },
        client: () => {
          throw new Error("the routine factory reads no client at boot");
        },
      };
      await newRoutineWorkerFactory({
        store: temp.store,
        config,
        syncer: new RoutineSyncer(() => undefined, temp.store, new RoutineArtifact(config), silentLogger),
        runStarter: new RunStarter({
          store: temp.store,
          config,
          executions: { create: () => Promise.reject(new Error("no run is created at boot")) },
          fireIdentity: { kind: "trusted-local" },
          logger: silentLogger,
        }),
        logger: silentLogger,
      })(deps);

      expect(built).toHaveLength(1);
      const options = built[0]!;
      expect(options.taskQueue).toBe("routine_custom");
      expect(Object.keys(options.activities).sort()).toEqual(
        [
          POLL_EXECUTION_PHASE_ACTIVITY_NAME,
          RECORD_FAILED_RUN_ACTIVITY_NAME,
          RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
          RECORD_TICK_ACTIVITY_NAME,
          START_SCHEDULED_RUN_ACTIVITY_NAME,
        ].sort(),
      );
      const workflows = options.workflows as {
        readonly workflowsPath?: string;
        readonly workflowBundle?: { readonly codePath: string };
      };
      expect(
        workflows.workflowsPath ?? workflows.workflowBundle?.codePath ?? "",
      ).toMatch(/routine\/workflows\/index\.(ts|js)$|workflow-bundle-routine\.js$/);
    } finally {
      await temp.cleanup();
    }
  });
});
