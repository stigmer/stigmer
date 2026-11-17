/**
 * Pins the one write for a run whose workflow is gone (workflow-gone.ts),
 * on the sqlite store (the writer's abort is the store's, pinned on both
 * drivers by store/__tests__/session-events*.test.ts):
 *
 *   - a run still in the phases the caller saw ends FAILED with the
 *     platform's cause (`failed`, kind `internal`), an end time and the
 *     pinned copy, keeping the rest of its status; the session reads the
 *     error and goes idle, the observers hear one transition, and the
 *     counter counts it by the phase left and what the engine answered;
 *   - a run that left those phases before the write (it completed while
 *     the engine was asked) is not written: no event, no observer, no
 *     count;
 *   - a run removed meanwhile is not written; a store fault throws.
 */
import { create } from "@bufbuild/protobuf";
import { metrics } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { eventTypeOf } from "@stigmer/session-log";

import { createLogger } from "../../../boot/logger.js";
import type { RunStatusTransition } from "../../../extensions/status-hooks.js";
import {
  initRunWorkflowGoneMetrics,
  resetRunWorkflowGoneMetrics,
} from "../../../observability/run-workflow-gone-metrics.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { eventOf } from "../../session/events/codec.js";
import {
  createRunAppendingEvents,
  updateRunAppendingEvents,
} from "../../session/events/run-writes.js";
import { readSessionState } from "../../session/events/state.js";
import { WAITING_PHASES, WORKING_PHASES } from "../phases.js";
import type { WorkflowGoneDeps } from "../workflow-gone.js";
import {
  failRunWithoutWorkflow,
  WORKFLOW_GONE_ERROR,
} from "../workflow-gone.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let temp: TempStore;
let observed: RunStatusTransition[];
let counted: Array<Record<string, unknown> | undefined>;

function deps(store: Store = temp.store): WorkflowGoneDeps {
  return {
    store,
    logger: silentLogger,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    statusObservers: [(transition) => void observed.push(transition)],
  };
}

beforeEach(() => {
  temp = tempStore();
  observed = [];
  // Each test's own sink, so a count resolving late never lands in the next test's.
  const sink: Array<Record<string, unknown> | undefined> = [];
  counted = sink;
  const meter = {
    createCounter: () => ({
      add: (_value: number, attributes?: Record<string, unknown>) => {
        if (attributes !== undefined) sink.push(attributes);
      },
    }),
  };
  metrics.setGlobalMeterProvider({ getMeter: () => meter } as never);
});

afterEach(async () => {
  metrics.disable();
  resetRunWorkflowGoneMetrics();
  await temp.cleanup();
});

function run(id: string, sessionId: string): Run {
  return create(RunSchema, {
    metadata: { id, org: "acme" },
    spec: {
      target: { case: "sessionId", value: sessionId },
      message: `turn ${id}`,
    },
    status: {
      phase: RunPhase.RUN_PENDING,
      agentId: "agt_1",
      fileChanges: [{ id: `${id}:0` }],
    },
  });
}

async function seed(
  id: string,
  sessionId: string,
  phase: RunPhase,
): Promise<void> {
  await createRunAppendingEvents(deps(), run(id, sessionId));
  if (phase !== RunPhase.RUN_PENDING) {
    await updateRunAppendingEvents(deps(), id, (r) => {
      r.status!.phase = phase;
    });
  }
}

async function stored(id: string): Promise<Run> {
  return temp.store.getResource(ApiResourceKind.run, id, RunSchema);
}

async function log(sessionId: string): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(sessionId, {
    order: "asc",
    limit: 100,
  });
  return records.map((record) => eventTypeOf(eventOf(record)));
}

/**
 * Every count recorded so far has landed: the counter's adds chain on one
 * memoized promise in order, so an add awaited after them runs last (its
 * zero carries no attributes and is not kept).
 */
async function settled(): Promise<void> {
  await initRunWorkflowGoneMetrics();
}

describe("failRunWithoutWorkflow", () => {
  it("ends a working run as the platform's fault, keeps the rest of its status, and the session goes idle", async () => {
    await seed("r1", "s1", RunPhase.RUN_IN_PROGRESS);
    const before = await log("s1");

    const outcome = await failRunWithoutWorkflow(
      deps(),
      "r1",
      WORKING_PHASES,
      "not_found",
    );
    await settled();

    expect(outcome.written).toBe(true);
    const ended = await stored("r1");
    expect(ended.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(ended.status?.error).toBe(WORKFLOW_GONE_ERROR);
    expect([ended.status?.stopCause, ended.status?.stopDetail?.kind]).toEqual([
      "failed",
      "internal",
    ]);
    expect(ended.status?.completedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect([
      ended.status?.agentId,
      ended.status?.fileChanges.map((cs) => cs.id),
    ]).toEqual(["agt_1", ["r1:0"]]);
    expect((await log("s1")).slice(before.length)).toEqual([
      "session.error",
      "stigmer.run.status",
      "session.status_idle",
    ]);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    expect(
      observed.map((t) => [t.oldPhase, t.newPhase, t.run.metadata?.id]),
    ).toEqual([[RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_FAILED, "r1"]]);
    expect(counted).toEqual([{ phase: "in_progress", found: "not_found" }]);
  });

  it("counts a pending run whose workflow closed by the phase it left", async () => {
    await seed("r1", "s1", RunPhase.RUN_PENDING);
    await failRunWithoutWorkflow(deps(), "r1", WORKING_PHASES, "closed");
    await settled();
    expect(counted).toEqual([{ phase: "pending", found: "closed" }]);
  });

  it("writes nothing to a run that left the expected phases before the write", async () => {
    await seed("r1", "s1", RunPhase.RUN_COMPLETED);
    const before = await log("s1");
    const { status } = await stored("r1");

    const outcome = await failRunWithoutWorkflow(
      deps(),
      "r1",
      WORKING_PHASES,
      "closed",
    );
    await settled();

    expect(outcome.written).toBe(false);
    expect((await stored("r1")).status).toEqual(status);
    expect(await log("s1")).toEqual(before);
    expect([observed, counted]).toEqual([[], []]);
  });

  it("writes nothing to a working run when the caller expected it to wait", async () => {
    await seed("r1", "s1", RunPhase.RUN_IN_PROGRESS);
    expect(
      (await failRunWithoutWorkflow(deps(), "r1", WAITING_PHASES, "not_found"))
        .written,
    ).toBe(false);
    expect((await stored("r1")).status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("writes nothing to a run removed meanwhile, and throws a store fault", async () => {
    expect(
      (
        await failRunWithoutWorkflow(
          deps(),
          "r_gone",
          WORKING_PHASES,
          "not_found",
        )
      ).written,
    ).toBe(false);

    await seed("r1", "s1", RunPhase.RUN_IN_PROGRESS);
    const faulty = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "writeResourceAppendingEvents") {
          return () => Promise.reject(new Error("disk"));
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    await expect(
      failRunWithoutWorkflow(deps(faulty), "r1", WORKING_PHASES, "not_found"),
    ).rejects.toThrow("disk");
    expect(observed).toEqual([]);
  });
});
