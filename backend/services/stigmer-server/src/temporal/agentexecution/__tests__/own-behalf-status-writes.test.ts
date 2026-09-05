/**
 * The agent-execution worker's own-behalf status writes (stigmer#979,
 * stigmer-cloud#610) — pins that the invoke workflow's fallback and
 * re-assertion persists land under an ENFORCING Authorizer because they
 * ride the in-process transport: position 1 mints the internal caller
 * class the Authorize step honors as the server acting as itself, so the
 * Authorizer is never consulted for a write the server makes on its own
 * behalf (the Java UpdateExecutionStatusActivityImpl posture — no
 * authorization step on this write — reached through the shared chain
 * rather than around it).
 *
 * Composed the way the cloud is shaped — a real server over SQLite with a
 * denying, recording Authorizer unit — and driven through the REAL
 * activities with the REAL in-process edge (`server.inProcessTransport`),
 * so the path under test is the production one end to end: activity →
 * transport → interceptors → updateStatus handler → merge → status hooks
 * → broadcast. Failing-first record: against the pre-fix activity (the
 * trusted-local `user` identity handed straight to the domain function)
 * the first arm answered `[permission_denied] unauthorized to update agent
 * execution status` from authorize.ts — the dark production composition's
 * exact log line.
 *
 * The three payload shapes are the workflow's real ones
 * (invoke-agent-execution.ts): updateStatusOnFailure's FAILED with two
 * MESSAGE_SYSTEM lines, updateStatusOnCancellation's CANCELLED with one,
 * and the phase-only persistFinalStatus / persistInterruptedStatus /
 * persistResumedStatus shape. Transcript shape after a late fallback is
 * deliberately NOT asserted here — stigmer#980 owns that cross-edition
 * behavior.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import type { Client } from "@temporalio/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import type { AgentExecutionStatusTransition } from "../../../extensions/status-hooks.js";
import { createAgentExecutionActivities } from "../activities.js";
import type { ExecutionStatusWriter } from "../activities.js";
import { UPDATE_EXECUTION_STATUS_ACTIVITY_NAME } from "../names.js";

const UPDATE_STATUS_PROCEDURE =
  "/ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/updateStatus";

type UpdateStatusActivity = (id: string, status: JsonValue) => Promise<void>;

describe("own-behalf status writes under an enforcing Authorizer", () => {
  let server: ComposedServer;
  let dir: string;
  let statusWriter: ExecutionStatusWriter;
  let updateStatus: UpdateStatusActivity;
  // Captured NDJSON log lines — the chain-traversal proof reads them.
  const logLines: string[] = [];
  const authorizerCalls: Array<{
    identity: CallerIdentity;
    check: AuthzCheck;
  }> = [];
  const transitions: AgentExecutionStatusTransition[] = [];

  // The cloud's shape: every check that reaches the Authorizer is a
  // genuine denial (an FGA store holds no grant for the server's own
  // identity), and every call is recorded so the arms can assert the
  // Authorizer was never asked.
  const denyAndRecord: ServerExtension = {
    name: "deny-and-record",
    authorizer: {
      authorize: (identity, check) => {
        authorizerCalls.push({ identity, check });
        return Promise.resolve({ kind: "deny", reason: "" });
      },
    },
    // A composed terminal observer (the billing settle's shape): the
    // compose-root promise is that the worker's writes reach it.
    statusTransitionHooks: {
      observers: [
        (transition) => {
          transitions.push(transition);
        },
      ],
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "own-behalf-writes-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({
        level: "info",
        pretty: false,
        write: (line) => logLines.push(line),
      }),
      extensions: [denyAndRecord],
      portOverride: 0,
      host: "127.0.0.1",
    });
    await server.start();

    // The worker's edge, built exactly as boot/inprocess.ts builds it:
    // the plain UpdateStatus RPC over the in-process transport.
    const command = createClient(
      AgentExecutionCommandController,
      server.inProcessTransport,
    );
    statusWriter = { updateStatus: (input) => command.updateStatus(input) };
    updateStatus = createAgentExecutionActivities({
      store: server.store,
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      statusWriter: () => statusWriter,
      client: () => ({}) as unknown as Client,
    })[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME] as UpdateStatusActivity;
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    authorizerCalls.length = 0;
    transitions.length = 0;
  });

  async function seedExecution(id: string): Promise<void> {
    // Seeded through the store: the create path is not under test, and
    // the denying Authorizer would refuse it over the wire.
    await server.store.saveResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "AgentExecution",
        metadata: { id, name: "own-behalf", org: "acme" },
        spec: { agentId: "agt_1", sessionId: "ses_1" },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );
  }

  async function persisted(id: string) {
    return server.store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
  }

  it("stamps FAILED with updateStatusOnFailure's payload; the Authorizer is never asked", async () => {
    await seedExecution("aex_ownbehalf_failed");
    const failed = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_FAILED,
      error: "agent execution failed: runner refused",
      messages: [
        {
          type: MessageType.MESSAGE_SYSTEM,
          content:
            "Internal system error occurred during execution. Please contact support if this issue persists.",
        },
        {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Error details: runner refused",
        },
      ],
    });
    const before = logLines.length;

    await updateStatus(
      "aex_ownbehalf_failed",
      toJson(AgentExecutionStatusSchema, failed),
    );

    const execution = await persisted("aex_ownbehalf_failed");
    expect(execution.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(execution.status?.error).toBe(
      "agent execution failed: runner refused",
    );
    expect(
      authorizerCalls,
      "a write the server makes on its own behalf never reaches the Authorizer (the internal-class skip)",
    ).toHaveLength(0);

    // Chain traversal: the logging interceptor (position 2) records the
    // completed in-process RPC — the write went through the transport,
    // not around it.
    const completed = logLines
      .slice(before)
      .filter(
        (line) =>
          line.includes("rpc completed") &&
          line.includes(UPDATE_STATUS_PROCEDURE),
      );
    expect(completed).toHaveLength(1);
  });

  it("fires the composed status observers on the terminal transition (the O4 promise)", async () => {
    await seedExecution("aex_ownbehalf_observed");

    await updateStatus(
      "aex_ownbehalf_observed",
      toJson(
        AgentExecutionStatusSchema,
        create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_FAILED,
          error: "boom",
        }),
      ),
    );

    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.oldPhase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(transitions[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(transitions[0]?.execution.metadata?.id).toBe(
      "aex_ownbehalf_observed",
    );
  });

  it("stamps CANCELLED with updateStatusOnCancellation's payload", async () => {
    await seedExecution("aex_ownbehalf_cancelled");

    await updateStatus(
      "aex_ownbehalf_cancelled",
      toJson(
        AgentExecutionStatusSchema,
        create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_CANCELLED,
          messages: [
            {
              type: MessageType.MESSAGE_SYSTEM,
              content: "Execution was cancelled.",
            },
          ],
        }),
      ),
    );

    const execution = await persisted("aex_ownbehalf_cancelled");
    expect(execution.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    // A user-initiated cancel is a quiet terminal state (stigmer#282).
    expect(execution.status?.error).toBe("");
    expect(authorizerCalls).toHaveLength(0);
  });

  it("re-asserts a phase with the message-less persistInterruptedStatus shape", async () => {
    await seedExecution("aex_ownbehalf_interrupted");
    // The recovery path's first write: a transient FAILED the interrupted
    // runner activity may have left behind …
    await server.store.updateResource(
      ApiResourceKind.agent_execution,
      "aex_ownbehalf_interrupted",
      AgentExecutionSchema,
      (execution) => {
        execution.status!.phase = ExecutionPhase.EXECUTION_PAUSED;
      },
    );

    // … overwritten with IN_PROGRESS so the console shows "resuming".
    await updateStatus(
      "aex_ownbehalf_interrupted",
      toJson(
        AgentExecutionStatusSchema,
        create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        }),
      ),
    );

    const execution = await persisted("aex_ownbehalf_interrupted");
    expect(execution.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(authorizerCalls).toHaveLength(0);
  });

  it("surfaces the lane's NotFound as the activity's failure for a deleted execution", async () => {
    await expect(
      updateStatus("aex_ownbehalf_missing", { phase: "EXECUTION_FAILED" }),
    ).rejects.toThrow(/not found/i);
    expect(authorizerCalls).toHaveLength(0);
  });
});
