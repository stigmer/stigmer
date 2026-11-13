/**
 * Server-side activity tests — pins the contracts of activities.ts:
 *
 *   - UpdateExecutionStatus owns only the payload boundary: it decodes
 *     the proto-JSON status into a typed UpdateStatus input (a name the
 *     contract does not have refused) and hands it
 *     to the in-process status edge (stigmer#979) — the lane's answer,
 *     success or ConnectError, IS the activity's outcome. The lane itself
 *     (transport, interceptors, handler, merge, hooks) is
 *     pinned end to end in own-behalf-status-writes.test.ts;
 *   - CountOpenGates counts the turn's asks its session's log holds open
 *     (not one an answer or a result closed, not another run's, never a
 *     change set awaiting review), reads the run's own session when the
 *     input carried none, counts none for a run in no session, and fails
 *     on a store fault;
 *   - CloseFileReview keeps the previous turn's undecided edits (a
 *     next_turn `decided` event in the log), the turn before this run's
 *     own message and not the newest, once; a first turn, a run whose
 *     message is not in the log, a previous turn since deleted, and one
 *     the log shows a person decided close nothing; a store fault reading
 *     the previous turn fails the activity;
 *   - EnsureSessionSandbox runs the request's ensure with the caller's
 *     facts from the input and answers its word; on `no_room` it tells the
 *     session's liveness streams how long the turn has waited, and on
 *     another answer after a wait it sends a liveness without the wait; a
 *     turn that never waited sends nothing; a run since deleted is
 *     `skipped`; and it heartbeats while the ensure runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunUpdateStatusInput } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { fileReviewSeed } from "../../../domain/run/__tests__/file-review-seed.js";
import { decidedEvent } from "../../../domain/run/filereview/decided.js";
import { dropQueuedMessages, enqueueMessage } from "../../../domain/session/events/queue.js";
import { SessionEventBroker } from "../../../domain/session/events/broker.js";
import { draftOf, eventOf } from "../../../domain/session/events/codec.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../../domain/session/events/run-writes.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { createAgentExecutionActivities } from "../activities.js";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  ROUTING_SESSION,
} from "../../../domain/run/temporal/config.js";
import { SESSION_EVENT_LIVENESS_TYPE } from "../../../domain/session/events/broker.js";
import { SandboxNoRoomError, type SandboxFacts, type SandboxProvisioner } from "../../../sandbox/provisioner.js";
import type { EnsureSessionSandboxInput } from "../sandbox-wait.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { WITHOUT_SANDBOX } from "./activity-deps.js";
import type { ExecutionStatusWriter } from "../activities.js";
import {
  CLOSE_FILE_REVIEW_ACTIVITY_NAME,
  COUNT_OPEN_GATES_ACTIVITY_NAME,
  DEFAULT_ACTIVITY_TASK_QUEUE,
  ENSURE_SESSION_SANDBOX_ACTIVITY_NAME,
  START_QUEUED_TURN_ACTIVITY_NAME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function newFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "activities-test-"));
  const store: Store = SqliteStore.open(
    path.join(dir, "activities.sqlite"),
    silentLogger,
  );
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // The in-process status edge as a recording fake: these are UNIT pins
  // of the activity's payload boundary, so the lane is a seam here (the
  // real lane is exercised in own-behalf-status-writes.test.ts).
  const writes: RunUpdateStatusInput[] = [];
  let writerFault: ConnectError | undefined;
  const statusWriter: ExecutionStatusWriter = {
    updateStatus: (input) => {
      if (writerFault !== undefined) {
        return Promise.reject(writerFault);
      }
      writes.push(input);
      return Promise.resolve(create(UpdateStatusResponseSchema));
    },
  };

  const activities = createAgentExecutionActivities({
    ...WITHOUT_SANDBOX,
    store,
    logger: silentLogger,
    statusWriter: () => statusWriter,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    queuedTurns: async () => undefined,
  });
  return {
    store,
    activities,
    writes,
    failWriterWith(error: ConnectError): void {
      writerFault = error;
    },
  };
}

describe("UpdateExecutionStatus activity", () => {
  it("decodes the proto-JSON status into a typed UpdateStatus input for the in-process edge", async () => {
    const { activities, writes } = newFixture();
    const update = create(RunStatusSchema, {
      phase: RunPhase.RUN_FAILED,
      error: "boom",
      // An int64 field crossing the payload boundary as JSON and coming
      // back typed — the bigint rule the module header states.
      streamingUsage: { totalTokens: 1234n },
    });

    await (
      activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
        id: string,
        status: JsonValue,
      ) => Promise<void>
    )("run_upd_1", toJson(RunStatusSchema, update));

    expect(writes).toHaveLength(1);
    expect(writes[0]?.runId).toBe("run_upd_1");
    expect(writes[0]?.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(writes[0]?.status?.error).toBe("boom");
    expect(writes[0]?.status?.streamingUsage?.totalTokens).toBe(1234n);
  });

  it("fails as an ordinary activity error on malformed status JSON, before the edge is reached", async () => {
    const { activities, writes } = newFixture();
    await expect(
      (
        activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
          id: string,
          status: JsonValue,
        ) => Promise<void>
      )("run_upd_bad", { phase: { not: "a phase" } }),
    ).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("refuses a name the contract does not have, before the edge is reached", async () => {
    const { activities, writes } = newFixture();
    const update = activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
      id: string,
      status: JsonValue,
    ) => Promise<void>;
    await expect(update("run_unknown_value", { phase: "EXECUTION_CANCELLED" })).rejects.toThrow();
    await expect(update("run_unknown_field", { executionPhase: "RUN_FAILED" })).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("surfaces the edge's ConnectError as the activity's failure (the lane's NotFound for a deleted execution)", async () => {
    const { activities, failWriterWith } = newFixture();
    failWriterWith(
      new ConnectError("AgentExecution not found: run_missing", Code.NotFound),
    );
    await expect(
      (
        activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
          id: string,
          status: JsonValue,
        ) => Promise<void>
      )("run_missing", { phase: "RUN_FAILED" }),
    ).rejects.toThrow(/not.?found/i);
  });
});

describe("StartQueuedTurn activity", () => {
  it("starts the turn its session's queued messages wait for, and lets a fault through for Temporal to retry", async () => {
    const temp = tempStore();
    cleanups.push(() => temp.cleanup());
    const started: string[] = [];
    let fail = false;
    const activities = createAgentExecutionActivities({
      ...WITHOUT_SANDBOX,
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("starting a queued turn writes no status");
      },
      sessionEventBroker: new SessionEventBroker(silentLogger),
      queuedTurns: async (sessionId) => {
        if (fail) {
          throw new Error("unavailable");
        }
        started.push(sessionId);
        return undefined;
      },
    });
    const start = activities[START_QUEUED_TURN_ACTIVITY_NAME] as (sessionId: string) => Promise<void>;
    await start("ses_q");
    expect(started).toEqual(["ses_q"]);
    fail = true;
    await expect(start("ses_q")).rejects.toThrow("unavailable");
  });
});

describe("CountOpenGates activity", () => {
  const SESSION = "ses_gates";
  type CountActivity = (executionId: string, sessionId: string) => Promise<number>;

  function gatesFixture() {
    const temp = tempStore();
    cleanups.push(() => temp.cleanup());
    const sessionEventBroker = new SessionEventBroker(silentLogger);
    const activities = createAgentExecutionActivities({
      ...WITHOUT_SANDBOX,
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("counting gates writes no status");
      },
      sessionEventBroker,
      queuedTurns: async () => undefined,
    });
    const count = activities[COUNT_OPEN_GATES_ACTIVITY_NAME] as CountActivity;
    // `beside` stores a second waiting turn of the session as a session
    // written before one turn at a time held could hold it.
    const turn = async (id: string, sessionId: string, withSet = false, beside = false): Promise<void> => {
      const run = create(RunSchema, {
        metadata: { id, org: "test-org" },
        spec: { target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId } },
        status: withSet
          ? { ...fileReviewSeed(id, `${id}:0`).status, phase: RunPhase.RUN_WAITING_FOR_APPROVAL }
          : { phase: RunPhase.RUN_WAITING_FOR_APPROVAL },
      });
      if (beside) {
        await temp.store.saveResource(ApiResourceKind.run, id, RunSchema, run);
        return;
      }
      await createRunAppendingEvents({ store: temp.store, sessionEventBroker }, run);
    };
    const log = async (runId: string, events: ReadonlyArray<SessionEvent>): Promise<void> => {
      await temp.store.sessionEvents.append(SESSION, "test-org", events.map(draftOf), {
        kind: ApiResourceKind.run,
        id: runId,
        schema: RunSchema,
        admit: () => undefined,
      });
    };
    return { store: temp.store, count, turn, log };
  }

  const ask = (runId: string, id: string): SessionEvent =>
    create(SessionEventSchema, {
      runId,
      event: { case: "agentToolUse", value: { id, name: "Write", input: {}, evaluatedPermission: "ask" } },
    });

  it("counts the turn's open asks: not one answered, not one its result closed, not another run's, never a set awaiting review", async () => {
    const { count, turn, log } = gatesFixture();
    await turn("run_a", SESSION, true);
    await turn("run_b", SESSION, false, true);
    expect(await count("run_a", SESSION)).toBe(0);
    await log("run_a", [ask("run_a", "run_a.1"), ask("run_a", "run_a.2"), ask("run_a", "run_a.3"), ask("run_a", "run_a.4")]);
    await log("run_b", [ask("run_b", "run_b.1")]);
    await log("run_a", [
      create(SessionEventSchema, {
        runId: "run_a",
        event: { case: "userToolConfirmation", value: { id: "sevt_tc_1", toolUseId: "run_a.1", result: "allow" } },
      }),
      create(SessionEventSchema, {
        runId: "run_a",
        event: { case: "agentToolResult", value: { id: "run_a.2.r", toolUseId: "run_a.2" } },
      }),
    ]);
    expect(await count("run_a", SESSION)).toBe(2);
    expect(await count("run_b", SESSION)).toBe(1);
  });

  it("reads the run's own session when the input carried none, and counts none for a run in no session", async () => {
    const { count, turn, log } = gatesFixture();
    await turn("run_a", SESSION);
    await log("run_a", [ask("run_a", "run_a.1")]);
    expect(await count("run_a", "")).toBe(1);
    await turn("run_alone", "");
    expect(await count("run_alone", "")).toBe(0);
  });

  it("fails on a store fault, so the workflow waits for the signal", async () => {
    const { store, count, turn } = gatesFixture();
    await turn("run_a", SESSION);
    vi.spyOn(store.sessionEvents, "openGates").mockRejectedValueOnce(new Error("disk"));
    await expect(count("run_a", SESSION)).rejects.toThrow("disk");
    await expect(count("run_absent", "")).rejects.toThrow();
  });
});

describe("CloseFileReview activity", () => {
  const SESSION = "ses_close";
  type CloseActivity = (executionId: string, sessionId: string) => Promise<void>;

  /** A store opened with the list indexes (a run write carries events), and the activity over it. */
  function closeFixture() {
    const temp = tempStore();
    cleanups.push(() => temp.cleanup());
    const sessionEventBroker = new SessionEventBroker(silentLogger);
    const activities = createAgentExecutionActivities({
      ...WITHOUT_SANDBOX,
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("CloseFileReview writes no status through the in-process edge");
      },
      sessionEventBroker,
      queuedTurns: async () => undefined,
    });
    const close = activities[CLOSE_FILE_REVIEW_ACTIVITY_NAME] as CloseActivity;
    /** Creates a turn the way the run chain does: its user message into the log. */
    const turn = async (id: string, withSet: boolean): Promise<void> => {
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
    };
    /** The origins of the run's decided events in the log. */
    const decisions = async (id: string) =>
      (
        await temp.store.sessionEvents.list(SESSION, {
          order: "asc",
          runId: id,
          types: ["stigmer.file_review.decided"],
          limit: 10,
        })
      ).flatMap((record) => {
        const event = eventOf(record);
        return event.event.case === "stigmerFileReviewDecided" ? [event.event.value.origin] : [];
      });
    const decidedRuns = async (): Promise<string[]> =>
      (
        await temp.store.sessionEvents.list(SESSION, {
          order: "asc",
          types: ["stigmer.file_review.decided"],
          limit: 10,
        })
      ).map((record) => record.runId);
    return { store: temp.store, close, turn, decisions, decidedRuns };
  }

  it("keeps the previous turn's undecided set, origin next turn, with its decided event", async () => {
    const { store, close, turn, decisions, decidedRuns } = closeFixture();
    await turn("run_a", true);
    await turn("run_b", false);

    await close("run_b", SESSION);

    expect(await decisions("run_a")).toEqual(["next_turn"]);
    const run = await store.getResource(ApiResourceKind.run, "run_a", RunSchema);
    expect(run.status?.fileChanges.map((cs) => cs.id), "the record keeps the set").toEqual(["run_a:0"]);
    expect(await decidedRuns()).toEqual(["run_a"]);
  });

  it("reads past a message dropped from the queue and a message this run read while it worked, to the previous turn", async () => {
    const { store, close, turn, decisions } = closeFixture();
    const writes = { store, sessionEventBroker: new SessionEventBroker(silentLogger) };
    await turn("run_a", true);
    await enqueueMessage(writes, {
      sessionId: SESSION,
      org: "test-org",
      sender: "person-a",
      turn: create(RunSchema, { spec: { message: "dropped" } }),
    });
    await dropQueuedMessages(writes, SESSION, "test-org");
    await turn("run_b", false);
    await store.sessionEvents.append(
      SESSION,
      "test-org",
      [
        draftOf(
          create(SessionEventSchema, {
            runId: "run_b",
            event: { case: "userMessage", value: { id: "sevt_read_mid_turn", content: [{ type: "text", text: "also" }] } },
          }),
        ),
      ],
      { kind: ApiResourceKind.run, id: "run_b", schema: RunSchema, admit: () => undefined },
    );

    await close("run_b", SESSION);

    expect(await decisions("run_a")).toEqual(["next_turn"]);
    expect(await decisions("run_b")).toEqual([]);
  });

  it("reads back past a full page of messages that were never a turn's", async () => {
    const { store, close, turn, decisions } = closeFixture();
    const writes = { store, sessionEventBroker: new SessionEventBroker(silentLogger) };
    await turn("run_a", true);
    for (let i = 0; i < 101; i++) {
      await enqueueMessage(writes, {
        sessionId: SESSION,
        org: "test-org",
        sender: "person-a",
        turn: create(RunSchema, { spec: { message: `dropped ${i}` } }),
      });
    }
    await dropQueuedMessages(writes, SESSION, "test-org");
    await turn("run_b", false);

    await close("run_b", SESSION);

    expect(await decisions("run_a")).toEqual(["next_turn"]);
  });

  it("closes the turn before this run's own message, not the newest, and only once", async () => {
    const { close, turn, decisions, decidedRuns } = closeFixture();
    await turn("run_a", true);
    await turn("run_b", true);
    await turn("run_c", true);

    await close("run_b", SESSION);
    await close("run_b", SESSION);

    expect(await decisions("run_a")).toEqual(["next_turn"]);
    expect(await decisions("run_b"), "the run's own set is not its to close").toEqual([]);
    expect(await decisions("run_c")).toEqual([]);
    expect(await decidedRuns()).toEqual(["run_a"]);
  });

  it("a first turn, and a run whose message is not in the log, close nothing", async () => {
    const { close, turn, decisions, decidedRuns } = closeFixture();
    await turn("run_a", true);

    await close("run_a", SESSION);
    await close("run_absent", SESSION);
    await close("run_a", "");

    expect(await decisions("run_a")).toEqual([]);
    expect(await decidedRuns()).toEqual([]);
  });

  it("a previous turn deleted since its message was written has nothing to close", async () => {
    const { store, close, turn } = closeFixture();
    await turn("run_a", true);
    await turn("run_b", false);
    // The row alone goes (a run's removal takes its message too; this is
    // the race between the read and the delete).
    await store.deleteResource(ApiResourceKind.run, "run_a");

    await expect(close("run_b", SESSION)).resolves.toBeUndefined();
  });

  it("fails on a store fault reading the previous turn, so the activity is retried", async () => {
    const { store, close, turn, decisions } = closeFixture();
    await turn("run_a", true);
    await turn("run_b", false);
    vi.spyOn(store, "getResource").mockRejectedValueOnce(new Error("store down"));

    await expect(close("run_b", SESSION)).rejects.toThrow("store down");
    expect(await decisions("run_a"), "nothing was kept").toEqual([]);
  });

  it("leaves a previous turn a person already decided as it is", async () => {
    const { store, close, turn, decisions, decidedRuns } = closeFixture();
    await turn("run_a", true);
    // The person's decision, as the decision core writes it: its decided
    // event in the log.
    await updateRunAppendingEvents({ store, sessionEventBroker: new SessionEventBroker(silentLogger) }, "run_a", () => ({
      last: [
        decidedEvent("run_a", {
          changeSetId: "run_a:0",
          scope: "change_set",
          fileChangeId: "",
          action: "undo",
          expectedDigest: "",
          origin: "person",
          reason: "",
          decidedBy: "usr_person",
        }),
      ],
    }));
    await turn("run_b", false);

    await close("run_b", SESSION);

    expect(await decisions("run_a")).toEqual(["person"]);
    expect(await decidedRuns(), "the person's decided event, and no keep").toEqual(["run_a"]);
  });
});

describe("EnsureSessionSandbox activity", () => {
  type Ensure = (input: EnsureSessionSandboxInput) => Promise<string>;

  /** No mint: these pins are about the ensure's answer, not its credential. */
  const credentials: RunnerCredentialProvider = {
    isEnabled: () => false,
    mint: () => {
      throw new Error("the lane mints nothing here");
    },
    verify: () => {
      throw new Error("verify is not under test");
    },
  };

  /** A provisioner whose ensure answers each call in turn: room, no room, or a promise the test settles. */
  function scriptedProvisioner(answers: Array<"ready" | "no_room" | Promise<void>>) {
    const facts: SandboxFacts[] = [];
    const provisioner: SandboxProvisioner = {
      ensureSessionSandbox: async (_id, given) => {
        facts.push(given);
        const answer = answers.shift() ?? "ready";
        if (answer === "no_room") {
          throw new SandboxNoRoomError("no free Substrate worker for sandbox s: none");
        }
        if (answer !== "ready") {
          await answer;
        }
      },
      deprovisionSessionSandbox: async () => undefined,
      createConnectSandbox: async (id) => id,
      deprovisionConnectSandbox: async () => undefined,
      probe: async () => "absent",
    };
    return { provisioner, facts };
  }

  /** A CLOUD session and its run, the activity over `provisioner`, and a stream that asked for liveness. */
  async function sandboxFixture(provisioner: SandboxProvisioner, heartbeat: () => void = () => undefined) {
    const temp = tempStore();
    cleanups.push(() => temp.cleanup());
    await temp.store.saveResource(
      ApiResourceKind.session,
      "ses_wait",
      SessionSchema,
      create(SessionSchema, { metadata: { id: "ses_wait", name: "ses_wait" }, spec: { executionTarget: ExecutionTarget.CLOUD } }),
    );
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_wait",
      RunSchema,
      create(RunSchema, { metadata: { id: "run_wait", name: "run_wait" }, spec: { target: { case: "sessionId", value: "ses_wait" } } }),
    );
    const broker = new SessionEventBroker(silentLogger);
    const stream = broker.subscribe("ses_wait", [SESSION_EVENT_LIVENESS_TYPE]);
    const ensure = createAgentExecutionActivities({
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("the ensure writes no status");
      },
      sessionEventBroker: broker,
      queuedTurns: async () => undefined,
      sandboxLane: { enabled: true, provisioner, credentials },
      personAccounts: undefined,
      temporalConfig: new AgentExecutionTemporalConfig(
        "agent_execution_stigmer",
        DEFAULT_ACTIVITY_TASK_QUEUE,
        ROUTING_SESSION,
        DEFAULT_EXECUTION_TARGET_CLOUD,
      ),
      heartbeat,
      now: () => 100_000,
    })[ENSURE_SESSION_SANDBOX_ACTIVITY_NAME] as Ensure;
    /** The liveness the stream received since the last read: its run, and its sandbox wait in ms. */
    const sent = (): Array<{ runId: string; sandboxMs: number | undefined }> => {
      const received: Array<{ runId: string; sandboxMs: number | undefined }> = [];
      for (let frame = broker.take(stream); frame !== undefined; frame = broker.take(stream)) {
        if (frame.frame.case === "stigmerRunLiveness") {
          const wait = frame.frame.value.awaitingSandboxFor;
          received.push({ runId: frame.frame.value.runId, sandboxMs: wait === undefined ? undefined : Number(wait.seconds) * 1000 });
        }
      }
      return received;
    };
    return { ensure, sent };
  }

  it("runs the request's ensure with the caller's facts and answers ready, telling no stream when the turn never waited", async () => {
    const { provisioner, facts } = scriptedProvisioner(["ready"]);
    const { ensure, sent } = await sandboxFixture(provisioner);
    expect(await ensure({ execution_id: "run_wait", caller_class: "user", routine_id: "rtn_1", caller_identity_id: "ida_1" })).toBe("ready");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ taskQueue: "session:ses_wait", callerClass: "user", routineId: "rtn_1" });
    expect(sent()).toEqual([]);
  });

  it("on no_room tells the streams how long the turn has waited, then clears it once room comes", async () => {
    const { provisioner } = scriptedProvisioner(["no_room", "no_room", "ready"]);
    const { ensure, sent } = await sandboxFixture(provisioner);
    expect(await ensure({ execution_id: "run_wait", caller_class: "user" })).toBe("no_room");
    expect(sent(), "the first ask: the wait has just begun").toEqual([{ runId: "run_wait", sandboxMs: 0 }]);
    expect(await ensure({ execution_id: "run_wait", caller_class: "user", waiting_since_ms: 20_000 })).toBe("no_room");
    expect(sent()).toEqual([{ runId: "run_wait", sandboxMs: 80_000 }]);
    expect(await ensure({ execution_id: "run_wait", caller_class: "user", waiting_since_ms: 20_000 })).toBe("ready");
    expect(sent(), "a liveness without the wait, so the stream stops counting").toEqual([{ runId: "run_wait", sandboxMs: undefined }]);
  });

  it("answers skipped for a run since deleted", async () => {
    const { provisioner, facts } = scriptedProvisioner(["ready"]);
    const { ensure } = await sandboxFixture(provisioner);
    expect(await ensure({ execution_id: "run_gone", caller_class: "user" })).toBe("skipped");
    expect(facts).toEqual([]);
  });

  it("heartbeats while the ensure runs, and stops when it ends", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let finish: () => void = () => undefined;
      const slow = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const { provisioner, facts } = scriptedProvisioner([slow]);
      let beats = 0;
      const { ensure } = await sandboxFixture(provisioner, () => {
        beats += 1;
      });
      const running = ensure({ execution_id: "run_wait", caller_class: "user" });
      await vi.waitFor(() => expect(facts).toHaveLength(1));
      vi.advanceTimersByTime(25_000);
      expect(beats, "every 10 s").toBe(2);
      finish();
      expect(await running).toBe("ready");
      vi.advanceTimersByTime(60_000);
      expect(beats, "no beat once the ensure ended").toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
