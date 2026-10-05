/**
 * Pins the run gate's SPLICE in session create and update over the real
 * router: AuthorizeRunTarget runs after the reference rule and
 * ResolveSessionAgent, on the agent id the pin resolved from
 * spec.agent_ref, and before Persist, so
 *   (1) a denied caller answers PERMISSION_DENIED with the domain's
 *       byte-pinned copy naming the resolved agent, and leaves no row;
 *   (2) the built-in-assistant shape (no agent_ref) makes NO run-gate
 *       check and creates the session even under a denying run-gate
 *       authorizer: the organization's own create permission admitted it;
 *   (3) a not-found answer reads as NOT_FOUND naming the agent (the
 *       stigmer#224 order);
 *   (4) an allowed caller creates the session pinned to the agent;
 *   (5) the reference rule answers before the permission: a
 *       same-organization slug that names no agent is the rule's
 *       "missing", and the gate is never asked;
 *   (6) on update the gate asks only about an agent the write introduces
 *       or changes: repointing to an agent the caller may not run is
 *       refused and leaves the stored pin, an echo of the stored reference
 *       and a move to `latest` on the same agent ask nothing.
 * The authorizer under test answers only run-gate checks
 * (runGateOnlyAuthorizer), so every refusal here is the run gate's and
 * nobody else's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import type { Client, Transport } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { AuthzDecision } from "../../../extensions/authorizer.js";
import { runGateOnlyAuthorizer } from "../../../pipeline/__tests__/support.js";
import { runAgentDeniedMessage } from "../constants.js";

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
  sessionCommand = createClient(SessionCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function sessionCount(): Promise<number> {
  return (await server.store.listResources(ApiResourceKind.session)).length;
}

/** Creates an agent as an allowed caller; answers its id and slug. */
async function createAgent(
  name: string,
): Promise<{ id: string; slug: string }> {
  const saved = decision;
  decision = { kind: "allow" };
  try {
    const agent = await agentCommand.create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name, org: ORG },
      spec: { instructions: "You are the agent the run-gate tests target." },
    });
    return { id: agent.metadata!.id, slug: agent.metadata!.slug };
  } finally {
    decision = saved;
  }
}

function agentRef(slug: string, version = ""): ApiResourceReference {
  return create(ApiResourceReferenceSchema, {
    kind: ApiResourceKind.agent,
    org: ORG,
    slug,
    version,
  });
}

/** The stored session with its spec edited, as a client sends an update. */
function edited(session: Session, edit: (spec: SessionSpec) => void): Session {
  const next = clone(SessionSchema, session);
  next.spec ??= create(SessionSpecSchema);
  edit(next.spec);
  return next;
}

async function captureError(
  run: () => Promise<unknown>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to reject");
}

describe("session-create run gate (composed server)", () => {
  it("denies an agent the caller may not run with the pinned copy and persists nothing", async () => {
    const agent = await createAgent("Denied agent");
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const before = await sessionCount();

    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Denied session", org: ORG },
        spec: { agentRef: agentRef(agent.slug) },
      }),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentDeniedMessage(agent.id));
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: agent.id,
      },
    ]);
    expect(await sessionCount(), "no row behind a denial").toBe(before);
  });

  it("makes no check for the built-in assistant (no agent_ref) and creates the session", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const before = await sessionCount();

    const session = await sessionCommand.create({
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name: "Session-first", org: ORG },
      spec: {},
    });

    // No agent, no blueprint to spend, no target: the gate is silent and
    // the denying authorizer is never asked.
    expect(gate.runGateChecks).toHaveLength(0);
    expect(session.spec?.agentRef).toBeUndefined();
    expect(session.status?.agentId ?? "").toBe("");
    expect(await sessionCount()).toBe(before + 1);
  });

  it("not-found answers NOT_FOUND naming the agent (the stigmer#224 order)", async () => {
    const agent = await createAgent("Hidden agent");
    decision = { kind: "not-found" };
    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Hidden agent session", org: ORG },
        spec: { agentRef: agentRef(agent.slug) },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain(agent.id);
  });

  it("answers the reference rule's missing before the permission for an unknown slug", async () => {
    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const err = await captureError(() =>
      sessionCommand.create({
        apiVersion: API_VERSION,
        kind: "Session",
        metadata: { name: "Missing agent", org: ORG },
        spec: { agentRef: agentRef("no-such-agent") },
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toContain("no-such-agent");
    expect(gate.runGateChecks).toHaveLength(0);
  });

  it("an allowed caller creates the session pinned to the agent", async () => {
    decision = { kind: "allow" };
    const agent = await createAgent("Allowed agent");
    gate.runGateChecks.length = 0;

    const session = await sessionCommand.create({
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name: "Allowed session", org: ORG },
      spec: { agentRef: agentRef(agent.slug) },
    });

    expect(session.metadata?.id).toMatch(/^ses_/);
    expect(session.spec?.agentRef?.slug).toBe(agent.slug);
    expect(session.status?.agentId).toBe(agent.id);
    expect(session.status?.agentVersionHash).not.toBe("");
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([agent.id]);
  });
});

describe("session-update run gate (composed server)", () => {
  async function createPinnedSession(agentSlug: string, name: string) {
    decision = { kind: "allow" };
    return sessionCommand.create({
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name, org: ORG },
      spec: { agentRef: agentRef(agentSlug) },
    });
  }

  it("refuses repointing to an agent the caller may not run and keeps the stored pin", async () => {
    const first = await createAgent("Update first agent");
    const second = await createAgent("Update second agent");
    const session = await createPinnedSession(first.slug, "Repointed session");

    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const err = await captureError(() =>
      sessionCommand.update(
        edited(session, (spec) => {
          spec.agentRef = agentRef(second.slug);
        }),
      ),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentDeniedMessage(second.id));
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([second.id]);
    const stored = await server.store.getResource(
      ApiResourceKind.session,
      session.metadata!.id,
      SessionSchema,
    );
    expect(stored.status?.agentId).toBe(first.id);
  });

  it("asks nothing for an echo of the stored reference or a latest that resolves to the pinned version", async () => {
    const agent = await createAgent("Update kept agent");
    const session = await createPinnedSession(agent.slug, "Kept session");

    decision = { kind: "deny", reason: "" };
    gate.runGateChecks.length = 0;
    const echoed = await sessionCommand.update(
      edited(session, (spec) => {
        spec.subject = "Renamed by an echo";
      }),
    );
    const latest = await sessionCommand.update(
      edited(echoed, (spec) => {
        spec.agentRef = agentRef(agent.slug, "latest");
      }),
    );

    expect(gate.runGateChecks).toHaveLength(0);
    expect(echoed.status?.agentId).toBe(agent.id);
    expect(latest.status?.agentId).toBe(agent.id);
  });
});
