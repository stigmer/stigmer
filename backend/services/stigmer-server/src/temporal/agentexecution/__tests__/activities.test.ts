/**
 * Server-side activity tests — pins the contracts of activities.ts:
 *
 *   - UpdateExecutionStatus reuses #17's merge chokepoint (atomic persist
 *     + StreamBroker broadcast) — one implementation for the RPC, the
 *     regular-activity mode, and the local-activity mode;
 *   - LoadAgentExecution returns proto-JSON that survives the payload
 *     boundary INCLUDING int64 fields (the bigint rule: a Message
 *     instance would crash the default converter);
 *   - ReadHarnessStateId's empty-input and not-found contracts (Go
 *     read_harness_state_id.go);
 *   - DeleteExecutionContext delegates to #15's idempotent seam;
 *   - CompleteExternalActivity: empty-token skip, base64 token decode,
 *     error-over-result precedence — the DD-001 lane Go cannot deliver
 *     (oss#861), so the ERROR path is the load-bearing assertion.
 */
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { StreamBroker } from "../../../domain/agentexecution/stream-broker.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { createAgentExecutionActivities } from "../activities.js";
import {
  COMPLETE_EXTERNAL_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";
import { DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME } from "../../../domain/executioncontext/temporal/delete-execution-context.js";

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

interface CompletionCall {
  readonly kind: "complete" | "fail";
  readonly taskToken: Buffer;
  readonly payload: unknown;
}

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

  const broker = new StreamBroker(silentLogger);
  const completions: CompletionCall[] = [];
  const stubClient = {
    activity: {
      complete: async (taskToken: Buffer, payload: unknown): Promise<void> => {
        completions.push({ kind: "complete", taskToken, payload });
      },
      fail: async (taskToken: Buffer, error: unknown): Promise<void> => {
        completions.push({ kind: "fail", taskToken, payload: error });
      },
    },
  } as unknown as Client;

  const activities = createAgentExecutionActivities({
    store,
    logger: silentLogger,
    broker,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    statusObservers: [],
    responseDecorators: [],
    client: () => stubClient,
  });
  return { store, broker, activities, completions };
}

async function saveExecution(
  store: Store,
  id: string,
  phase = ExecutionPhase.EXECUTION_IN_PROGRESS,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent_execution,
    id,
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { id, name: "test-exec", org: "test-org" },
      spec: { agentId: "agt_1", sessionId: "ses_1" },
      status: {
        phase,
        streamingUsage: { totalTokens: 1234n, estimatedCostUsd: 0.05 },
      },
    }),
  );
}

describe("UpdateExecutionStatus activity", () => {
  it("merges the proto-JSON status through the #17 chokepoint and broadcasts", async () => {
    const { store, broker, activities } = newFixture();
    await saveExecution(store, "aex_upd_1");
    const broadcasts: AgentExecution[] = [];
    const originalBroadcast = broker.broadcast.bind(broker);
    broker.broadcast = (execution) => {
      broadcasts.push(execution);
      originalBroadcast(execution);
    };

    const update = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_FAILED,
      error: "boom",
    });
    await (
      activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
        id: string,
        status: JsonValue,
      ) => Promise<void>
    )("aex_upd_1", toJson(AgentExecutionStatusSchema, update));

    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      "aex_upd_1",
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(persisted.status?.error).toBe("boom");
    expect(broadcasts).toHaveLength(1);
  });

  it("fails as an ordinary activity error on malformed status JSON", async () => {
    const { store, activities } = newFixture();
    await saveExecution(store, "aex_upd_bad");
    await expect(
      (
        activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
          id: string,
          status: JsonValue,
        ) => Promise<void>
      )("aex_upd_bad", { phase: { not: "a phase" } }),
    ).rejects.toThrow();
  });

  it("fails on an unknown execution (Go store.UpdateResource NotFound parity)", async () => {
    const { activities } = newFixture();
    await expect(
      (
        activities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as (
          id: string,
          status: JsonValue,
        ) => Promise<void>
      )("aex_missing", { phase: "EXECUTION_FAILED" }),
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
    const parsed = fromJson(AgentExecutionSchema, raw);
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
        spec: { agentInstanceId: "ain_1", harnessStateId: "cursor-agent-42" },
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

describe("DeleteExecutionContext activity", () => {
  it("deletes the ExecutionContext for the execution and is idempotent", async () => {
    const { store, activities } = newFixture();
    await store.saveResource(
      ApiResourceKind.execution_context,
      "ectx_1",
      ExecutionContextSchema,
      create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        metadata: { id: "ectx_1", name: "ec", org: "o" },
        spec: { executionId: "aex_del_1" },
      }),
    );

    const remove = activities[DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME] as (
      executionId: string,
    ) => Promise<void>;
    await remove("aex_del_1");
    await expect(
      store.getResource(
        ApiResourceKind.execution_context,
        "ectx_1",
        ExecutionContextSchema,
      ),
    ).rejects.toThrow();
    // Best-effort seam: a second delete (nothing left) must not throw.
    await expect(remove("aex_del_1")).resolves.toBeUndefined();
  });
});

describe("CompleteExternalActivity", () => {
  type CompleteFn = (input: {
    callbackToken: string;
    result?: unknown;
    errorMessage?: string;
  }) => Promise<void>;

  it("skips an empty token (backward compatibility)", async () => {
    const { activities, completions } = newFixture();
    await (activities[COMPLETE_EXTERNAL_ACTIVITY_NAME] as CompleteFn)({
      callbackToken: "",
    });
    expect(completions).toHaveLength(0);
  });

  it("completes with the result, decoding the base64 token", async () => {
    const { activities, completions } = newFixture();
    const token = Buffer.from("task-token-1");
    await (activities[COMPLETE_EXTERNAL_ACTIVITY_NAME] as CompleteFn)({
      callbackToken: token.toString("base64"),
      result: { agent_execution_id: "aex_1" },
    });
    expect(completions).toHaveLength(1);
    expect(completions[0]!.kind).toBe("complete");
    expect(Buffer.compare(completions[0]!.taskToken, token)).toBe(0);
    expect(completions[0]!.payload).toEqual({ agent_execution_id: "aex_1" });
  });

  it("fails with the error message — and error takes precedence over result (DD-001, oss#861)", async () => {
    const { activities, completions } = newFixture();
    await (activities[COMPLETE_EXTERNAL_ACTIVITY_NAME] as CompleteFn)({
      callbackToken: Buffer.from("task-token-2").toString("base64"),
      result: { should: "be ignored" },
      errorMessage: "agent execution failed: boom",
    });
    expect(completions).toHaveLength(1);
    expect(completions[0]!.kind).toBe("fail");
    expect((completions[0]!.payload as Error).message).toBe(
      "agent execution failed: boom",
    );
  });
});
