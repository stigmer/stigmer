/**
 * Pins the run gate's SPLICE in agent-execution-create over the real router
 * (P1 sp.run-gate): AuthorizeRunTarget sits after EnsureSessionOrAgentResolved
 * and BEFORE EnsureEngineAvailable, the pre-side-effect slot and
 * CreateDefaultInstanceIfNeeded. Pinned here: (1) each request shape is
 * checked against its own target with its own byte-pinned copy; (2) a
 * denial leaves no execution row AND creates no default instance — the
 * "no side effect precedes the check" property; (3) the gate precedes the
 * engine gate: an ALLOWED create on this engineless server answers the
 * engine's UNAVAILABLE, a DENIED one PERMISSION_DENIED. The authorizer
 * under test answers only run-gate checks (runGateOnlyAuthorizer), so every
 * refusal here is the run gate's and nobody else's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Transport } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
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
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
  runAgentInstanceDeniedMessage,
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
let agentCommand: Client<typeof AgentCommandController>;
let command: Client<typeof AgentExecutionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agentexecution-run-gate-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
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
  agentCommand = createClient(AgentCommandController, transport);
  command = createClient(AgentExecutionCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function count(kind: ApiResourceKind): Promise<number> {
  return (await server.store.listResources(kind)).length;
}

/**
 * An agent whose stored status names NO default instance, so a create by
 * agent_id would have CreateDefaultInstanceIfNeeded mint one — the side
 * effect the gate must precede.
 */
async function createAgentWithoutDefaultInstance(
  name: string,
): Promise<string> {
  const agent = await agentCommand.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: { instructions: "You are the agent the run-gate tests target." },
  });
  const id = agent.metadata!.id;
  const stored = await server.store.getResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
  );
  if (stored.status !== undefined) {
    stored.status.defaultInstanceId = "";
  }
  await server.store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    stored,
  );
  return id;
}

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
  agentId?: string;
  sessionId?: string;
  sessionSpec?: { agentInstanceId: string };
}) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentExecution",
    metadata: { name: "run-gate-exec", org: ORG },
    spec: { message: "hello", ...spec },
  };
}

describe("agent-execution-create run gate (composed server)", () => {
  it("agent_id: denies with the agent copy, persists nothing, mints no default instance", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const agentId = await createAgentWithoutDefaultInstance("Private agent");
    const executionsBefore = await count(ApiResourceKind.agent_execution);
    const instancesBefore = await count(ApiResourceKind.agent_instance);

    const err = await captureError(() =>
      command.create(createInput({ agentId })),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentDeniedMessage(agentId));
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: agentId,
      },
    ]);
    expect(
      await count(ApiResourceKind.agent_execution),
      "no execution row",
    ).toBe(executionsBefore);
    expect(
      await count(ApiResourceKind.agent_instance),
      "no default instance minted",
    ).toBe(instancesBefore);
    const stored = await server.store.getResource(
      ApiResourceKind.agent,
      agentId,
      AgentSchema,
    );
    expect(stored.status?.defaultInstanceId ?? "").toBe("");
  });

  it("session_id: denies with the session copy on session#can_create_execution_in", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(createInput({ sessionId: "ses_01someoneelses" })),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(
      addExecutionToSessionDeniedMessage("ses_01someoneelses"),
    );
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_create_execution_in,
        resourceKind: ApiResourceKind.session,
        resourceId: "ses_01someoneelses",
      },
    ]);
  });

  it("session_spec.agent_instance_id: denies with the instance copy", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(
        createInput({ sessionSpec: { agentInstanceId: "agi_01private" } }),
      ),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentInstanceDeniedMessage("agi_01private"));
    expect(gate.runGateChecks[0]?.resourceKind).toBe(
      ApiResourceKind.agent_instance,
    );
  });

  it("not-found answers NOT_FOUND naming the target (the stigmer#224 order)", async () => {
    decision = { kind: "not-found" };
    const err = await captureError(() =>
      command.create(createInput({ agentId: "agt_01missing" })),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain("agt_01missing");
  });

  it("the gate precedes the engine gate: an ALLOWED create reaches EnsureEngineAvailable", async () => {
    decision = { kind: "allow" };
    gate.runGateChecks.length = 0;
    const agentId = await createAgentWithoutDefaultInstance("Allowed agent");

    const err = await captureError(() =>
      command.create(createInput({ agentId })),
    );

    // The engineless composed server refuses at EnsureEngineAvailable —
    // AFTER the run gate ran and allowed.
    expect(err.code).toBe(Code.Unavailable);
    expect(err.rawMessage).toBe(ENGINE_UNAVAILABLE_MESSAGE);
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([agentId]);
  });
});
