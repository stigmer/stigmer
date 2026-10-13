/**
 * Server-side activity tests — pins the contracts of activities.ts:
 *
 *   - UpdateExecutionStatus owns only the payload boundary: it decodes
 *     the proto-JSON status into a typed UpdateStatus input (a status a
 *     runner wrote before the run rename, with retired names, included;
 *     any other unknown name refused) and hands it
 *     to the in-process status edge (stigmer#979) — the lane's answer,
 *     success or ConnectError, IS the activity's outcome. The lane itself
 *     (transport, interceptors, handler, merge, hooks, broadcast) is
 *     pinned end to end in own-behalf-status-writes.test.ts;
 *   - LoadAgentExecution returns proto-JSON that survives the payload
 *     boundary INCLUDING int64 fields (the bigint rule: a Message
 *     instance would crash the default converter);
 *   - ReadHarnessStateId's empty-input and not-found contracts (Go
 *     read_harness_state_id.go);
 *   - CountOpenGates counts the turn's asks its session's log holds open
 *     (not one an answer or a result closed, not another run's, never a
 *     change set awaiting review), reads the run's own session when the
 *     input carried none, counts none for a run in no session, and fails
 *     on a store fault;
 *   - the retired DeleteExecutionContext name stays registered for runs
 *     whose history still calls it, and its body does nothing: a run
 *     stores no copy of its values, so there is nothing to delete;
 *   - CloseFileReview keeps the previous turn's undecided edits (origin
 *     next turn, with their `decided` event), the turn before this run's
 *     own message and not the newest, once; a first turn, a run whose
 *     message is not in the log, a previous turn since deleted, and one a
 *     person already decided close nothing; a store fault reading the
 *     previous turn fails the activity.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { FileDecisionSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { RunUpdateStatusInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { fileReviewSeed } from "../../../domain/run/__tests__/file-review-seed.js";
import { ACTOR_USER, recordFileDecisionEventWithActor } from "../../../domain/run/filereview/author.js";
import { projectFileChangeSets } from "../../../domain/run/filereview/project.js";
import { SessionEventBroker } from "../../../domain/session/events/broker.js";
import { draftOf } from "../../../domain/session/events/codec.js";
import { createRunAppendingEvents } from "../../../domain/session/events/run-writes.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { createAgentExecutionActivities } from "../activities.js";
import type { ExecutionStatusWriter } from "../activities.js";
import {
  CLOSE_FILE_REVIEW_ACTIVITY_NAME,
  COUNT_OPEN_GATES_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
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
    store,
    logger: silentLogger,
    statusWriter: () => statusWriter,
    sessionEventBroker: new SessionEventBroker(silentLogger),
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

async function saveExecution(
  store: Store,
  id: string,
  phase = RunPhase.RUN_IN_PROGRESS,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { id, name: "test-exec", org: "test-org" },
      spec: { target: { case: "sessionId", value: "ses_1" } },
      status: {
        agentId: "agt_1",
        phase,
        streamingUsage: { totalTokens: 1234n, estimatedCostUsd: 0.05 },
      },
    }),
  );
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
    )("aex_upd_1", toJson(RunStatusSchema, update));

    expect(writes).toHaveLength(1);
    expect(writes[0]?.runId).toBe("aex_upd_1");
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
      )("aex_upd_bad", { phase: { not: "a phase" } }),
    ).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("decodes a status recorded before the run rename, its retired names read as the current ones", async () => {
    const { activities, writes } = newFixture();
    // The status JSON the user-cancel replay history records for this
    // activity's input, written before agent executions became runs.
    await (
      activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
        id: string,
        status: JsonValue,
      ) => Promise<void>
    )("aex_recorded", {
      messages: [{ type: "MESSAGE_SYSTEM", content: "Execution was cancelled." }],
      phase: "EXECUTION_CANCELLED",
      subAgentExecutions: [{ id: "sub_1", name: "researcher" }],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    expect(writes[0]?.status?.subAgentRuns[0]?.name).toBe("researcher");
    // A free-form string is data, never a name: it survives as written.
    expect(writes[0]?.status?.messages[0]?.content).toBe("Execution was cancelled.");
  });

  it("still refuses a name that is neither current nor retired, before the edge is reached", async () => {
    const { activities, writes } = newFixture();
    const update = activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
      id: string,
      status: JsonValue,
    ) => Promise<void>;
    await expect(update("aex_unknown_value", { phase: "EXECUTION_EXPLODED" })).rejects.toThrow();
    await expect(update("aex_unknown_field", { executionPhase: "RUN_FAILED" })).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("surfaces the edge's ConnectError as the activity's failure (the lane's NotFound for a deleted execution)", async () => {
    const { activities, failWriterWith } = newFixture();
    failWriterWith(
      new ConnectError("AgentExecution not found: aex_missing", Code.NotFound),
    );
    await expect(
      (
        activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
          id: string,
          status: JsonValue,
        ) => Promise<void>
      )("aex_missing", { phase: "RUN_FAILED" }),
    ).rejects.toThrow(/not.?found/i);
  });
});

describe("LoadAgentExecution activity", () => {
  it("returns proto-JSON whose int64 fields survive the payload boundary", async () => {
    const { store, activities } = newFixture();
    await saveExecution(store, "aex_load_1");

    const raw = (await (
      activities[LOAD_AGENT_EXECUTION_ACTIVITY_NAME] as (
        id: string,
      ) => Promise<JsonValue>
    )("aex_load_1")) as Record<string, JsonValue>;

    // The wire form must be plain JSON — bigint would crash the default
    // payload converter's JSON.stringify.
    expect(() => JSON.stringify(raw)).not.toThrow();
    const parsed = fromJson(RunSchema, raw);
    expect(parsed.metadata?.id).toBe("aex_load_1");
    expect(parsed.status?.streamingUsage?.totalTokens).toBe(1234n);
  });

  it("throws on an unknown execution", async () => {
    const { activities } = newFixture();
    await expect(
      (
        activities[LOAD_AGENT_EXECUTION_ACTIVITY_NAME] as (
          id: string,
        ) => Promise<JsonValue>
      )("aex_absent"),
    ).rejects.toThrow();
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
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("counting gates writes no status");
      },
      sessionEventBroker,
    });
    const count = activities[COUNT_OPEN_GATES_ACTIVITY_NAME] as CountActivity;
    const turn = async (id: string, sessionId: string, withSet = false): Promise<void> => {
      await createRunAppendingEvents(
        { store: temp.store, sessionEventBroker },
        create(RunSchema, {
          metadata: { id, org: "test-org" },
          spec: { target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId } },
          status: withSet
            ? { ...fileReviewSeed(id, `${id}:0`).status, phase: RunPhase.RUN_WAITING_FOR_APPROVAL }
            : { phase: RunPhase.RUN_WAITING_FOR_APPROVAL },
        }),
      );
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
    await turn("run_b", SESSION);
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

describe("ReadHarnessStateId activity", () => {
  it("returns empty for an empty session id without error", async () => {
    const { activities } = newFixture();
    await expect(
      (
        activities[READ_HARNESS_STATE_ID_ACTIVITY_NAME] as (
          sessionId: string,
        ) => Promise<string>
      )(""),
    ).resolves.toBe("");
  });

  it("returns the stored harness_state_id", async () => {
    const { store, activities } = newFixture();
    await store.saveResource(
      ApiResourceKind.session,
      "ses_h1",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_h1", name: "s", org: "o" },
        spec: { harnessStateId: "cursor-agent-42" },
      }),
    );
    await expect(
      (
        activities[READ_HARNESS_STATE_ID_ACTIVITY_NAME] as (
          sessionId: string,
        ) => Promise<string>
      )("ses_h1"),
    ).resolves.toBe("cursor-agent-42");
  });

  it("fails on a missing session with the pinned message shape", async () => {
    const { activities } = newFixture();
    await expect(
      (
        activities[READ_HARNESS_STATE_ID_ACTIVITY_NAME] as (
          sessionId: string,
        ) => Promise<string>
      )("ses_missing"),
    ).rejects.toThrow(/load session ses_missing for harness_state_id/);
  });
});

describe("the retired DeleteExecutionContext activity", () => {
  it("stays registered under its byte-pinned name for runs whose history calls it", () => {
    expect(RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME).toBe("DeleteExecutionContext");
    const { activities } = newFixture();
    expect(activities[RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]).toBeTypeOf("function");
  });

  it("does nothing: no status write and no store change, however often it is called", async () => {
    const { store, activities, writes } = newFixture();
    const remove = activities[RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME] as (
      executionId: string,
    ) => Promise<void>;
    await expect(remove("run_old")).resolves.toBeUndefined();
    await expect(remove("run_old")).resolves.toBeUndefined();
    expect(writes).toEqual([]);
    expect(await store.listResources(ApiResourceKind.run)).toEqual([]);
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
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("CloseFileReview writes no status through the in-process edge");
      },
      sessionEventBroker,
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
    const decisions = async (id: string) => {
      const run = await temp.store.getResource(ApiResourceKind.run, id, RunSchema);
      return run.status?.fileChangeSets[0]?.decisions ?? [];
    };
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

    expect((await decisions("run_a")).map((d) => d.origin)).toEqual([FileDecisionOrigin.POLICY_NEXT_TURN]);
    const run = await store.getResource(ApiResourceKind.run, "run_a", RunSchema);
    expect(run.status?.fileChangeSets[0]?.status).toBe(FileChangeSetStatus.DECIDED);
    expect(await decidedRuns()).toEqual(["run_a"]);
  });

  it("closes the turn before this run's own message, not the newest, and only once", async () => {
    const { close, turn, decisions, decidedRuns } = closeFixture();
    await turn("run_a", true);
    await turn("run_b", true);
    await turn("run_c", true);

    await close("run_b", SESSION);
    await close("run_b", SESSION);

    expect((await decisions("run_a")).map((d) => d.origin)).toEqual([FileDecisionOrigin.POLICY_NEXT_TURN]);
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
    await store.updateResource(ApiResourceKind.run, "run_a", RunSchema, (run) => {
      const decision = create(FileDecisionSchema, {
        id: "run_a:0:run_a:0",
        changeSetId: "run_a:0",
        scope: FileDecisionScope.CHANGE_SET,
        action: FileDecisionAction.REJECT,
        origin: FileDecisionOrigin.USER,
      });
      recordFileDecisionEventWithActor(run.status, "run_a", decision, ACTOR_USER);
      run.status!.fileChangeSets = projectFileChangeSets(run.status!.fileReviewEventStream);
    });
    await turn("run_b", false);

    await close("run_b", SESSION);

    expect((await decisions("run_a")).map((d) => d.origin)).toEqual([FileDecisionOrigin.USER]);
    expect(await decidedRuns()).toEqual([]);
  });
});
