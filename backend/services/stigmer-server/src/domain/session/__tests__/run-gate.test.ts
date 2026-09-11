/**
 * Pins the run gate's SPLICE in session-create over the real router (P1
 * sp.run-gate): the AuthorizeRunTarget step sits after
 * ResolveDefaultAgentInstance and before Persist, so (1) a denied caller
 * answers PERMISSION_DENIED with the domain's byte-pinned copy and leaves
 * no session row; (2) the check names the instance the CHAIN resolved,
 * not only the one the caller typed — the session-first shape (empty
 * spec) is checked against the platform default agent's default instance;
 * (3) an allowed caller creates the session exactly as before. The
 * authorizer under test answers only run-gate checks (runGateOnlyAuthorizer),
 * so every refusal here is the run gate's and nobody else's.
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
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { AuthzDecision } from "../../../extensions/authorizer.js";
import { runGateOnlyAuthorizer } from "../../../pipeline/__tests__/support.js";
import {
  DEFAULT_AGENT_LABEL,
  DEFAULT_AGENT_LABEL_VALUE,
} from "../../agent/defaultagent.js";
import { runAgentInstanceDeniedMessage } from "../constants.js";

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
let agentQuery: Client<typeof AgentQueryController>;
let sessionCommand: Client<typeof SessionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-run-gate-test-"));
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
  agentQuery = createClient(AgentQueryController, transport);
  sessionCommand = createClient(SessionCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function sessionCount(): Promise<number> {
  return (await server.store.listResources(ApiResourceKind.session)).length;
}

async function createAgent(name: string): Promise<string> {
  const agent = await agentCommand.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: { instructions: "You are the agent the run-gate tests target." },
  });
  return agent.metadata!.id;
}

/** The default-agent label is operator-seeded state; stamp it on the row. */
async function markDefaultAgent(agentId: string): Promise<void> {
  const stored = await server.store.getResource(
    ApiResourceKind.agent,
    agentId,
    AgentSchema,
  );
  stored.metadata!.labels[DEFAULT_AGENT_LABEL] = DEFAULT_AGENT_LABEL_VALUE;
  stored.metadata!.visibility = ApiResourceVisibility.visibility_public;
  await server.store.saveResource(
    ApiResourceKind.agent,
    agentId,
    AgentSchema,
    stored,
  );
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

describe("session-create run gate (composed server)", () => {
  it("denies a caller-named instance with the pinned copy and persists nothing", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const before = await sessionCount();

    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Denied session", org: ORG },
        spec: { agentInstanceId: "agi_01private" },
      }),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentInstanceDeniedMessage("agi_01private"));
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent_instance,
        resourceId: "agi_01private",
      },
    ]);
    expect(await sessionCount(), "no row behind a denial").toBe(before);
  });

  it("checks the instance the chain RESOLVED for the session-first shape", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const agentId = await createAgent("Default agent for the run gate");
    await markDefaultAgent(agentId);

    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Session-first", org: ORG },
        spec: {},
      }),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    // ResolveDefaultAgentInstance created (or found) the default agent's
    // default instance BEFORE the gate — the inherited pre-gate side
    // effect the slot table records — and the gate names exactly it.
    const agent = await agentQuery.get({ value: agentId });
    const resolvedInstanceId = agent.status?.defaultInstanceId ?? "";
    expect(resolvedInstanceId).not.toBe("");
    expect(gate.runGateChecks).toHaveLength(1);
    expect(gate.runGateChecks[0].resourceId).toBe(resolvedInstanceId);
    expect(err.rawMessage).toBe(
      runAgentInstanceDeniedMessage(resolvedInstanceId),
    );
  });

  it("not-found answers NOT_FOUND naming the instance (the stigmer#224 order)", async () => {
    decision = { kind: "not-found" };
    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Missing instance", org: ORG },
        spec: { agentInstanceId: "agi_01missing" },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain("agi_01missing");
  });

  it("an allowed caller creates the session exactly as before", async () => {
    decision = { kind: "allow" };
    gate.runGateChecks.length = 0;
    const agentId = await createAgent("Allowed agent");
    const agent = await agentQuery.get({ value: agentId });
    const instanceId = agent.status?.defaultInstanceId ?? "";
    expect(instanceId, "agent create seeds a default instance").not.toBe("");

    const session = await sessionCommand.create({
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name: "Allowed session", org: ORG },
      spec: { agentInstanceId: instanceId },
    });

    expect(session.metadata?.id).toMatch(/^ses_/);
    expect(session.spec?.agentInstanceId).toBe(instanceId);
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([instanceId]);
  });
});
