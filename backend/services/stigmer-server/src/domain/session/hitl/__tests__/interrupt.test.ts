/**
 * Pins SessionCommandController.interrupt (../interrupt.ts) on a real
 * store: can_edit on the session, asked once; a thread is refused; a
 * disconnected engine is refused before anything is written; otherwise a
 * user.interrupt is appended and every unfinished turn (pending, in
 * progress, waiting for an answer, paused) is cancelled through the cancel
 * chain's steps, each with stop cause `user` and its workflow cancelled,
 * the session ending idle with end_turn; a finished turn is left alone,
 * and one that finishes before the interrupt reaches it is skipped. A store
 * fault is an Internal; a session removed under the interrupt is not found;
 * any other failure to stop a turn is the interrupt's failure.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { InterruptSessionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../../extensions/authorizer.js";
import type { RunStatusTransition } from "../../../../extensions/status-hooks.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { stubConnectedEngine } from "../../../run/__tests__/engine-stub.js";
import type { ConnectedExecutionEngine } from "../../../run/engine.js";
import { ENGINE_DISCONNECTED } from "../../../run/engine.js";
import { StreamBroker } from "../../../run/stream-broker.js";
import { SessionEventBroker } from "../../events/broker.js";
import { eventOf } from "../../events/codec.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { interrupt } from "../interrupt.js";
import type { InterruptDeps } from "../interrupt.js";
import type { Store } from "../../../../store/interface.js";
import { appendAsks } from "./asks.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_1";

let temp: TempStore;
let cancelled: string[];
let observed: RunStatusTransition[];

beforeEach(async () => {
  temp = tempStore();
  cancelled = [];
  observed = [];
  await temp.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, { metadata: { id: SESSION, org: "acme" } }),
  );
});

afterEach(async () => {
  await temp.cleanup();
});

function deps(
  overrides: { authorizer?: Authorizer; engine?: Partial<ConnectedExecutionEngine>; disconnected?: boolean } = {},
): InterruptDeps {
  return {
    store: temp.store,
    logger: silentLogger,
    authorizer: overrides.authorizer ?? newPermissiveSingleTeamAuthorizer(),
    broker: new StreamBroker(silentLogger),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    engineState: () =>
      overrides.disconnected === true
        ? ENGINE_DISCONNECTED
        : {
            connected: true,
            engine: stubConnectedEngine({
              cancelWorkflow: async (runId) => {
                cancelled.push(runId);
              },
              ...overrides.engine,
            }),
          },
    statusObservers: [(t) => void observed.push(t)],
  };
}

const writeDeps = () => ({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) });

/** A turn of the session that reached `phase`; a waiting one has an open ask. */
async function seedTurn(runId: string, phase: RunPhase): Promise<void> {
  const waiting = phase === RunPhase.RUN_WAITING_FOR_APPROVAL;
  await createRunAppendingEvents(
    writeDeps(),
    create(RunSchema, {
      metadata: { id: runId, org: "acme" },
      spec: { target: { case: "sessionId", value: SESSION }, message: `turn ${runId}` },
      status: {
        phase: RunPhase.RUN_PENDING,
        messages: waiting
          ? [{ toolCalls: [{ id: "tc-1", name: "write", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, requiresApproval: true }] }]
          : [],
      },
    }),
  );
  if (waiting) {
    await appendAsks(temp.store, runId);
  }
  if (phase !== RunPhase.RUN_PENDING) {
    await updateRunAppendingEvents(writeDeps(), runId, (r) => {
      r.status!.phase = phase;
    });
  }
}

function stop(d = deps(), sessionThreadId = "") {
  return interrupt(d, create(InterruptSessionInputSchema, { sessionId: SESSION, sessionThreadId }), testCallerIdentity());
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

async function phaseOf(runId: string): Promise<Run> {
  return temp.store.getResource(ApiResourceKind.run, runId, RunSchema);
}

async function statusLog(): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(SESSION, { order: "asc", limit: 200 });
  return records.map(eventOf).flatMap((event) => {
    const type = eventTypeOf(event);
    if (event.event.case === "sessionStatusIdle") {
      return [`${type} ${event.event.value.stopReason?.type}`];
    }
    return type.startsWith("session.status") || type === "user.interrupt" ? [type] : [];
  });
}

describe("interrupt", () => {
  it("stops every unfinished turn of the session, waiting and paused ones included, and the session ends its turn", async () => {
    await seedTurn("run_waiting", RunPhase.RUN_WAITING_FOR_APPROVAL);
    await seedTurn("run_paused", RunPhase.RUN_PAUSED);
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    await seedTurn("run_done", RunPhase.RUN_COMPLETED);

    const response = await stop();

    expect(response.event?.event.case).toBe("userInterrupt");
    expect(response.event?.runId).toBe("");
    expect([...response.stoppedRunIds].sort()).toEqual(["run_paused", "run_queued", "run_waiting"]);
    expect([...cancelled].sort()).toEqual(["run_paused", "run_queued", "run_waiting"]);
    for (const runId of response.stoppedRunIds) {
      const run = await phaseOf(runId);
      expect(run.status?.phase, runId).toBe(RunPhase.RUN_CANCELLED);
      expect(run.status?.stopCause, runId).toBe("user");
    }
    expect((await phaseOf("run_done")).status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect((await phaseOf("run_waiting")).status?.pendingApprovals).toEqual([]);
    const log = await statusLog();
    expect(log.slice(log.indexOf("user.interrupt"))).toEqual(["user.interrupt", "session.status_idle end_turn"]);
    expect(observed.map((t) => [t.run.metadata?.id, RunPhase[t.oldPhase], RunPhase[t.newPhase]]).sort()).toEqual([
      ["run_paused", "RUN_PAUSED", "RUN_CANCELLED"],
      ["run_queued", "RUN_PENDING", "RUN_CANCELLED"],
      ["run_waiting", "RUN_WAITING_FOR_APPROVAL", "RUN_CANCELLED"],
    ]);
  });

  it("asks can_edit on the session once, and a denial writes nothing", async () => {
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    const checks: AuthzCheck[] = [];
    const recording: Authorizer = {
      authorize: async (_caller, check) => {
        checks.push(check);
        return { kind: "deny", reason: "not an editor" };
      },
    };
    expect((await refusal(stop(deps({ authorizer: recording })))).code).toBe(Code.PermissionDenied);
    expect(checks.map((c) => [c.permission, c.resourceKind, c.resourceId])).toEqual([
      [IamPermission.can_edit, ApiResourceKind.session, SESSION],
    ]);
    expect(await statusLog()).not.toContain("user.interrupt");
    expect((await phaseOf("run_queued")).status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("refuses a thread, and a disconnected engine, before anything is written", async () => {
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    expect((await refusal(stop(deps(), "run_queued.task_1"))).code).toBe(Code.InvalidArgument);
    expect((await refusal(stop(deps({ disconnected: true })))).code).toBe(Code.FailedPrecondition);
    expect(await statusLog()).not.toContain("user.interrupt");
    expect((await phaseOf("run_queued")).status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("an interrupt with nothing unfinished records the event and stops nothing", async () => {
    await seedTurn("run_done", RunPhase.RUN_COMPLETED);
    const response = await stop();
    expect(response.stoppedRunIds).toEqual([]);
    expect(await statusLog()).toContain("user.interrupt");
  });

  it("a turn that finishes before the interrupt reaches it is left as it is", async () => {
    await seedTurn("run_a", RunPhase.RUN_IN_PROGRESS);
    await seedTurn("run_b", RunPhase.RUN_IN_PROGRESS);
    const response = await stop(
      deps({
        engine: {
          cancelWorkflow: async (runId) => {
            cancelled.push(runId);
            // Whichever is stopped first, the other finishes meanwhile.
            const other = runId === "run_a" ? "run_b" : "run_a";
            await updateRunAppendingEvents(writeDeps(), other, (r) => {
              r.status!.phase = RunPhase.RUN_COMPLETED;
            });
          },
        },
      }),
    );
    expect(response.stoppedRunIds).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
  });

  it("a session that does not exist is not found", async () => {
    expect(
      (
        await refusal(
          interrupt(deps(), create(InterruptSessionInputSchema, { sessionId: "ses_absent" }), testCallerIdentity()),
        )
      ).code,
    ).toBe(Code.NotFound);
  });
});

describe("interrupt's faults", () => {
  function faulty(overrides: Partial<Store>): Store {
    return new Proxy(temp.store, {
      get(target, key, receiver) {
        return key in overrides ? (overrides as Record<string | symbol, unknown>)[key] : Reflect.get(target, key, receiver);
      },
    });
  }

  it("a store fault loading the session, recording the event or listing the runs is Internal", async () => {
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    const appendFault = (error: Error) => ({
      ...temp.store.sessionEvents,
      append: () => Promise.reject(error),
      list: temp.store.sessionEvents.list.bind(temp.store.sessionEvents),
    });
    for (const store of [
      faulty({ getResource: () => Promise.reject(new Error("disk")) }),
      faulty({ sessionEvents: appendFault(new Error("disk")) }),
      faulty({ queryResources: () => Promise.reject(new Error("disk")) }),
    ]) {
      expect((await refusal(stop({ ...deps(), store }))).code).toBe(Code.Internal);
    }
  });

  it("a session removed between its load and the event's append is not found", async () => {
    const { ResourceNotFoundError } = await import("../../../../store/interface.js");
    const store = faulty({
      sessionEvents: {
        ...temp.store.sessionEvents,
        append: () => Promise.reject(new ResourceNotFoundError(`session/${SESSION}`)),
      },
    });
    expect((await refusal(stop({ ...deps(), store }))).code).toBe(Code.NotFound);
  });

  it("any other failure to stop a turn is the interrupt's failure", async () => {
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    const error = await refusal(stop(deps({ engine: { cancelWorkflow: () => Promise.reject(new Error("engine down")) } })));
    expect(error.code).toBe(Code.Internal);
  });

  it("an engine gone after the check fails the interrupt; the turn is not reported stopped", async () => {
    await seedTurn("run_queued", RunPhase.RUN_PENDING);
    let checks = 0;
    const d: InterruptDeps = {
      ...deps(),
      engineState: () =>
        ++checks === 1 ? { connected: true, engine: stubConnectedEngine() } : ENGINE_DISCONNECTED,
    };
    expect((await refusal(stop(d))).code).toBe(Code.FailedPrecondition);
    expect((await phaseOf("run_queued")).status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("a turn removed before the interrupt reaches it is left out; a fault re-reading it fails the interrupt", async () => {
    await seedTurn("run_a", RunPhase.RUN_IN_PROGRESS);
    await seedTurn("run_b", RunPhase.RUN_IN_PROGRESS);
    const removed = await stop(
      deps({
        engine: {
          cancelWorkflow: async (runId) => {
            cancelled.push(runId);
            await temp.store.deleteResource(ApiResourceKind.run, runId === "run_a" ? "run_b" : "run_a");
          },
        },
      }),
    );
    expect(removed.stoppedRunIds).toHaveLength(1);

    await seedTurn("run_c", RunPhase.RUN_PENDING);
    let checks = 0;
    let reads = 0;
    const faultOnReread: InterruptDeps = {
      ...deps(),
      engineState: () => (++checks === 1 ? { connected: true, engine: stubConnectedEngine() } : ENGINE_DISCONNECTED),
      store: faulty({
        // The session, then the run's load, then the re-read after its refusal.
        getResource: ((...args: Parameters<Store["getResource"]>) =>
          ++reads === 3 ? Promise.reject(new Error("disk")) : temp.store.getResource(...args)) as Store["getResource"],
      }),
    };
    expect((await refusal(stop(faultOnReread))).code).toBe(Code.Internal);
  });
});

