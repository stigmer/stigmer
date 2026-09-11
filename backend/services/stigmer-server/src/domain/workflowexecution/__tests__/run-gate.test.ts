/**
 * Pins the run gate's SPLICE in workflow-execution-create over the real
 * router (P1 sp.run-gate): AuthorizeRunTarget sits after
 * ValidateWorkflowOrInstance and BEFORE EnsureEngineAvailable and
 * CreateDefaultInstanceIfNeeded (the chain's first side effect and its
 * first store read). Pinned here: (1) each shape is checked against its
 * own target with its own byte-pinned copy; (2) a denial leaves no
 * execution row and reads nothing — a nonexistent workflow_id is DENIED,
 * not NOT_FOUND, because the gate answers before the lookup; (3) the gate
 * precedes the engine gate: an ALLOWED create on this engineless server
 * answers the engine's UNAVAILABLE; (4) the shape-less request is still
 * INVALID_ARGUMENT from ValidateWorkflowOrInstance, which runs first. The
 * authorizer under test answers only run-gate checks.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Client, Transport } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { AuthzDecision } from "../../../extensions/authorizer.js";
import { runGateOnlyAuthorizer } from "../../../pipeline/__tests__/support.js";
import {
  ENGINE_UNAVAILABLE_MESSAGE,
  runWorkflowDeniedMessage,
  runWorkflowInstanceDeniedMessage,
} from "../constants.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

let dir: string;
let server: ComposedServer;
let decision: AuthzDecision = { kind: "allow" };
const gate = runGateOnlyAuthorizer(() => decision);
let command: Client<typeof WorkflowExecutionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-run-gate-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
    extensions: [{ name: "run-gate-test", authorizer: gate.authorizer }],
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(WorkflowExecutionCommandController, transport);
});

afterAll(async () => {
  try {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  } finally {
    vi.unstubAllEnvs();
  }
});

async function captureError(
  run: () => Promise<unknown>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the create to reject");
}

function createInput(spec: {
  workflowId?: string;
  workflowInstanceId?: string;
}) {
  return {
    apiVersion: API_VERSION,
    kind: "WorkflowExecution",
    metadata: { name: "run-gate-wf-exec", org: ORG },
    spec,
  };
}

describe("workflow-execution-create run gate (composed server)", () => {
  it("workflow_id: denies with the workflow copy before any lookup, persists nothing", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const before = (
      await server.store.listResources(ApiResourceKind.workflow_execution)
    ).length;

    // A workflow that does not exist: a lookup-first chain would answer
    // NOT_FOUND; the gate answers first.
    const err = await captureError(() =>
      command.create(createInput({ workflowId: "wf_01private" })),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runWorkflowDeniedMessage("wf_01private"));
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.workflow,
        resourceId: "wf_01private",
      },
    ]);
    expect(
      (await server.store.listResources(ApiResourceKind.workflow_execution))
        .length,
      "no execution row behind a denial",
    ).toBe(before);
  });

  it("workflow_instance_id: denies with the instance copy on workflow_instance#can_execute", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(createInput({ workflowInstanceId: "wfi_01private" })),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(
      runWorkflowInstanceDeniedMessage("wfi_01private"),
    );
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.workflow_instance,
        resourceId: "wfi_01private",
      },
    ]);
  });

  it("not-found answers NOT_FOUND naming the target (the stigmer#224 order)", async () => {
    decision = { kind: "not-found" };
    const err = await captureError(() =>
      command.create(createInput({ workflowId: "wf_01missing" })),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain("wf_01missing");
  });

  it("the gate precedes the engine gate: an ALLOWED create reaches EnsureEngineAvailable", async () => {
    decision = { kind: "allow" };
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(createInput({ workflowId: "wf_01allowed" })),
    );

    expect(err.code).toBe(Code.Unavailable);
    expect(err.rawMessage).toBe(ENGINE_UNAVAILABLE_MESSAGE);
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([
      "wf_01allowed",
    ]);
  });

  it("the shape-less request is still ValidateWorkflowOrInstance's INVALID_ARGUMENT, and the gate makes no check", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;

    const err = await captureError(() => command.create(createInput({})));

    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "either workflow_id or workflow_instance_id must be provided",
    );
    expect(gate.runGateChecks).toEqual([]);
  });
});
