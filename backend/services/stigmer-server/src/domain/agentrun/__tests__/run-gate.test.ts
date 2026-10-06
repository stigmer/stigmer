/**
 * Pins the run gate's two questions in agent-execution create over the
 * real router:
 *   - AuthorizeRunTarget, before anything stored is read: a turn in an
 *     existing session asks session#can_create_run_in with the
 *     session copy, and a denied caller is never asked the second
 *     question;
 *   - AuthorizeRunAgent, after ResolveRunAgent stamped the agent the turn
 *     runs (the session's pin, or the new conversation's agent_ref):
 *     agent#can_execute with the agent copy, so a caller who may still add
 *     to a conversation but may no longer run its agent is refused;
 *   - the built-in assistant (no target) is asked neither question;
 *   - both precede EnsureEngineAvailable and every side effect: a denial
 *     leaves no execution row and no auto-created session, and an ALLOWED
 *     create on this engineless server answers the engine's UNAVAILABLE;
 *   - the thinking-mode validation, which reads the stored session, runs
 *     behind the first question (stigmer/stigmer#1280): a DENIED create
 *     with an invalid thinking mode answers PERMISSION_DENIED, an ALLOWED
 *     one INVALID_ARGUMENT.
 * The authorizer under test answers only run-gate checks
 * (runGateOnlyAuthorizer), by a per-check policy, so every refusal here is
 * the run gate's and nobody else's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, Transport } from "@connectrpc/connect";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { AuthzCheck, AuthzDecision } from "../../../extensions/authorizer.js";
import { runGateOnlyAuthorizer } from "../../../pipeline/__tests__/support.js";
import {
  ENGINE_UNAVAILABLE_MESSAGE,
  addExecutionToSessionDeniedMessage,
  runAgentDeniedMessage,
} from "../constants.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

const ALLOW: AuthzDecision = { kind: "allow" };
const DENY: AuthzDecision = { kind: "deny", reason: "" };

let dir: string;
let server: ComposedServer;
/** The run gate's answer per check; the check is the one just recorded. */
let policy: (check: AuthzCheck) => AuthzDecision = () => ALLOW;
const gate = runGateOnlyAuthorizer(() => policy(gate.runGateChecks.at(-1)!));
let agentCommand: Client<typeof AgentCommandController>;
let sessionCommand: Client<typeof SessionCommandController>;
let command: Client<typeof AgentRunCommandController>;

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
  sessionCommand = createClient(SessionCommandController, transport);
  command = createClient(AgentRunCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function count(kind: ApiResourceKind): Promise<number> {
  return (await server.store.listResources(kind)).length;
}

/** An agent created by an allowed caller; answers its id and slug. */
async function createAgent(
  name: string,
): Promise<{ id: string; slug: string }> {
  const saved = policy;
  policy = () => ALLOW;
  try {
    const agent = await agentCommand.create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name, org: ORG },
      spec: { instructions: "You are the agent the run-gate tests target." },
    });
    return { id: agent.metadata!.id, slug: agent.metadata!.slug };
  } finally {
    policy = saved;
  }
}

/** A session pinned to the agent, created by an allowed caller. */
async function createSession(agentSlug: string): Promise<string> {
  const saved = policy;
  policy = () => ALLOW;
  try {
    const session = await sessionCommand.create({
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name: `run-gate session on ${agentSlug}`, org: ORG },
      spec: { agentRef: agentRef(agentSlug) },
    });
    return session.metadata!.id;
  } finally {
    policy = saved;
  }
}

function agentRef(slug: string) {
  return { kind: ApiResourceKind.agent, org: ORG, slug };
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

type Target =
  | { case: "sessionId"; value: string }
  | { case: "sessionSpec"; value: { agentRef: ReturnType<typeof agentRef> } }
  | { case: undefined; value?: undefined };

function createInput(
  target: Target,
  runConfig?: { modelName?: string; thinkingMode?: ThinkingMode },
) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentRun",
    metadata: { name: "run-gate-exec", org: ORG },
    spec: { message: "hello", target, runConfig },
  };
}

function newConversation(agentSlug: string): Target {
  return { case: "sessionSpec", value: { agentRef: agentRef(agentSlug) } };
}

describe("agent-execution-create run gate (composed server)", () => {
  it("a new conversation: denies the agent with the agent copy, persists nothing, creates no session", async () => {
    const agent = await createAgent("Private agent");
    policy = () => DENY;
    gate.runGateChecks.length = 0;
    const executionsBefore = await count(ApiResourceKind.agent_run);
    const sessionsBefore = await count(ApiResourceKind.session);

    const err = await captureError(() =>
      command.create(createInput(newConversation(agent.slug))),
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
    expect(
      await count(ApiResourceKind.agent_run),
      "no execution row",
    ).toBe(executionsBefore);
    expect(
      await count(ApiResourceKind.session),
      "no session auto-created",
    ).toBe(sessionsBefore);
  });

  it("session_id: denies with the session copy and never asks the second question", async () => {
    policy = () => DENY;
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(
        createInput({ case: "sessionId", value: "ses_01someoneelses" }),
      ),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(
      addExecutionToSessionDeniedMessage("ses_01someoneelses"),
    );
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_create_run_in,
        resourceKind: ApiResourceKind.session,
        resourceId: "ses_01someoneelses",
      },
    ]);
  });

  it("session_id: a caller who may add to the session but no longer run its agent is refused with the agent copy", async () => {
    const agent = await createAgent("Revoked agent");
    const sessionId = await createSession(agent.slug);
    policy = (check) =>
      check.resourceKind === ApiResourceKind.agent ? DENY : ALLOW;
    gate.runGateChecks.length = 0;
    const executionsBefore = await count(ApiResourceKind.agent_run);

    const err = await captureError(() =>
      command.create(createInput({ case: "sessionId", value: sessionId })),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(runAgentDeniedMessage(agent.id));
    expect(gate.runGateChecks).toEqual([
      {
        permission: IamPermission.can_create_run_in,
        resourceKind: ApiResourceKind.session,
        resourceId: sessionId,
      },
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: agent.id,
      },
    ]);
    expect(await count(ApiResourceKind.agent_run)).toBe(
      executionsBefore,
    );
  });

  it("the built-in assistant is asked neither question", async () => {
    policy = () => DENY;
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(createInput({ case: undefined })),
    );

    expect(gate.runGateChecks).toHaveLength(0);
    expect(err.code).toBe(Code.Unavailable);
    expect(err.rawMessage).toBe(ENGINE_UNAVAILABLE_MESSAGE);
  });

  it("not-found answers NOT_FOUND naming the session (the stigmer#224 order)", async () => {
    policy = () => ({ kind: "not-found" });
    const err = await captureError(() =>
      command.create(createInput({ case: "sessionId", value: "ses_01missing" })),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain("ses_01missing");
  });

  it("the gate precedes the engine gate: ALLOWED creates reach EnsureEngineAvailable", async () => {
    policy = () => ALLOW;
    const agent = await createAgent("Allowed agent");
    const sessionId = await createSession(agent.slug);
    const sessionsBefore = await count(ApiResourceKind.session);

    gate.runGateChecks.length = 0;
    const fresh = await captureError(() =>
      command.create(createInput(newConversation(agent.slug))),
    );
    // The engineless composed server refuses at EnsureEngineAvailable —
    // AFTER the run gate ran and allowed, before any session is created.
    expect(fresh.code).toBe(Code.Unavailable);
    expect(fresh.rawMessage).toBe(ENGINE_UNAVAILABLE_MESSAGE);
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([agent.id]);
    expect(await count(ApiResourceKind.session)).toBe(sessionsBefore);

    gate.runGateChecks.length = 0;
    const continued = await captureError(() =>
      command.create(createInput({ case: "sessionId", value: sessionId })),
    );
    expect(continued.code).toBe(Code.Unavailable);
    expect(gate.runGateChecks.map((c) => c.resourceId)).toEqual([
      sessionId,
      agent.id,
    ]);
  });

  it("thinking-mode validation runs behind the gate: a denied caller learns nothing about the session", async () => {
    policy = () => DENY;
    gate.runGateChecks.length = 0;

    const err = await captureError(() =>
      command.create(
        createInput(
          { case: "sessionId", value: "ses_01someoneelses" },
          { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
        ),
      ),
    );

    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(
      addExecutionToSessionDeniedMessage("ses_01someoneelses"),
    );
  });

  it("an allowed create with an invalid thinking mode is refused by the validation, before the engine gate", async () => {
    policy = () => ALLOW;
    const agent = await createAgent("Thinking agent");
    const sessionsBefore = await count(ApiResourceKind.session);

    const err = await captureError(() =>
      command.create(
        createInput(newConversation(agent.slug), {
          modelName: "composer-2.5",
          thinkingMode: ThinkingMode.ENABLED,
        }),
      ),
    );

    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no thinking capability");
    expect(await count(ApiResourceKind.session)).toBe(sessionsBefore);
  });
});
