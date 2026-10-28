/**
 * Pins what the agent-execution worker factory hands the manager's
 * createWorker: the stigmer queue from configuration, every server-side
 * activity under its byte-pinned name, a workflow source, and activities
 * composed over the factory's own dependencies (the CloseFileReview
 * activity's write reaches the session event broker it was given). The
 * worker itself is the manager's to build (temporal/manager.ts).
 */
import { create } from "@bufbuild/protobuf";
import type { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { fileReviewSeed } from "../../../domain/run/__tests__/file-review-seed.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
} from "../../../domain/run/temporal/config.js";
import { SessionEventBroker } from "../../../domain/session/events/broker.js";
import { eventOf } from "../../../domain/session/events/codec.js";
import { createRunAppendingEvents } from "../../../domain/session/events/run-writes.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { CreateWorkerOptions, WorkerFactoryDeps } from "../../manager.js";
import {
  CLOSE_FILE_REVIEW_ACTIVITY_NAME,
  COUNT_OPEN_GATES_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
  START_QUEUED_TURN_ACTIVITY_NAME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";
import { newAgentExecutionWorkerFactory } from "../worker.js";

const SESSION = "ses_worker";

describe("the agent-execution worker factory", () => {
  it("builds a worker on the stigmer queue with the server's activities, composed over the factory's broker", async () => {
    const temp = tempStore();
    try {
      const sessionEventBroker = new SessionEventBroker(silentLogger);
      const built: CreateWorkerOptions[] = [];
      const deps: WorkerFactoryDeps = {
        createWorker: (options) => {
          built.push(options);
          // The factory returns what createWorker built, unread.
          return Promise.resolve({} as Worker);
        },
        client: () => {
          throw new Error("the agent-execution factory reads no client at boot");
        },
      };
      await newAgentExecutionWorkerFactory({
        store: temp.store,
        logger: silentLogger,
        statusWriter: () => {
          throw new Error("no status is written here");
        },
        sessionEventBroker,
        queuedTurns: async () => undefined,
        temporalConfig: new AgentExecutionTemporalConfig(
          "agent_execution_custom",
          "runner_custom",
          ROUTING_GLOBAL,
          DEFAULT_EXECUTION_TARGET_LOCAL,
        ),
      })(deps);

      expect(built).toHaveLength(1);
      const options = built[0]!;
      expect(options.taskQueue).toBe("agent_execution_custom");
      expect(Object.keys(options.activities).sort()).toEqual(
        [
          CLOSE_FILE_REVIEW_ACTIVITY_NAME,
          COUNT_OPEN_GATES_ACTIVITY_NAME,
          LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
          RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
          START_QUEUED_TURN_ACTIVITY_NAME,
          UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
        ].sort(),
      );
      const workflows = options.workflows as {
        readonly workflowsPath?: string;
        readonly workflowBundle?: { readonly codePath: string };
      };
      expect(
        workflows.workflowsPath ?? workflows.workflowBundle?.codePath ?? "",
      ).toMatch(/workflows\/index\.(ts|js)$|workflow-bundle-agent-execution\.js$/);

      // Two turns of one session, the first with an undecided set; the
      // second's CloseFileReview keeps it and publishes the decided event
      // to the broker the factory was given.
      for (const [id, withSet] of [
        ["run_a", true],
        ["run_b", false],
      ] as const) {
        await createRunAppendingEvents(
          { store: temp.store, sessionEventBroker },
          create(RunSchema, {
            metadata: { id, org: "test-org" },
            spec: { target: { case: "sessionId", value: SESSION }, message: `message of ${id}` },
            status: withSet
              ? { ...fileReviewSeed(id, `${id}:0`).status, phase: RunPhase.RUN_COMPLETED }
              : { phase: RunPhase.RUN_COMPLETED },
          }),
        );
      }
      const subscription = sessionEventBroker.subscribe(SESSION, []);
      const activities = options.activities as Readonly<Record<string, unknown>>;
      const close = activities[CLOSE_FILE_REVIEW_ACTIVITY_NAME] as (
        executionId: string,
        sessionId: string,
      ) => Promise<void>;

      await close("run_b", SESSION);

      expect(subscription.dirty).toBe(true);
      const [newest] = await temp.store.sessionEvents.list(SESSION, { order: "desc", limit: 1 });
      expect(newest === undefined ? undefined : eventOf(newest).event.case).toBe("stigmerFileReviewDecided");
      sessionEventBroker.unsubscribe(SESSION, subscription);
    } finally {
      await temp.cleanup();
    }
  });
});
