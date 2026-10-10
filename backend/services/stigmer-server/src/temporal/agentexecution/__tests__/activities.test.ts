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
 *   - the retired DeleteExecutionContext name stays registered for runs
 *     whose history still calls it, and its body does nothing: a run
 *     stores no copy of its values, so there is nothing to delete.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunUpdateStatusInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { createAgentExecutionActivities } from "../activities.js";
import type { ExecutionStatusWriter } from "../activities.js";
import {
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
