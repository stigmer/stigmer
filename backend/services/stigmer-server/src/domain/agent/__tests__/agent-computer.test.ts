/**
 * Pins an agent's computer (AgentSpec.computer) and what it refuses,
 * through the REAL stack: a composed server on an ephemeral port, a native
 * gRPC client and the full interceptor chain.
 *
 * The agent's save (steps.ts ResolveAgentComputer, RefuseWhatNeedsAComputer):
 *   - a create that names none gets COMPUTER_REQUIRED, the Claude harness
 *     included; COMPUTER_NONE on the Claude harness is refused;
 *   - an agent without one is refused a Bash tool, its own hooks, a plugin
 *     with hooks or a local MCP server, and a subagent that has a computer,
 *     on create and on update; a subagent without one is listed;
 *   - an update and an apply that leave the field unset keep the stored
 *     COMPUTER_NONE; an agent saved before the setting stays unset when
 *     re-applied unchanged, keeping its version hash.
 * A conversation on it (session/resolve-session-computer.ts):
 *   - records the pinned version's computer on status.computer, and the
 *     built-in assistant and a version from before the setting record
 *     none, which reads as having one;
 *   - is refused a repository, the Claude harness and a plugin of its own
 *     with hooks on create, and a repository added by an update after its
 *     first turn;
 *   - keeps the computer it started with once it has run, even when it is
 *     re-pinned to a version that has one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { canonicalSpecHash } from "../../../store/canonical.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { CLAUDE_NEEDS_COMPUTER_MESSAGE } from "../../run/computer.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
let ORG_ID: string;

let dir: string;
let server: ComposedServer;
let transport: Transport;
let agents: Client<typeof AgentCommandController>;
let sessions: Client<typeof SessionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-computer-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: a deterministically closed port.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  ORG_ID = organizationId(await seedOrganizations(transport, [ORG]), ORG);
  agents = createClient(AgentCommandController, transport);
  sessions = createClient(SessionCommandController, transport);
  await seedPlugin("code-style", "hooks");
  await seedPlugin("github-tools", "stdio");
  await seedPlugin("docs", "http");
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A plugin of this organization carrying hooks, a local MCP server, or only a URL one. */
async function seedPlugin(slug: string, carries: "hooks" | "stdio" | "http"): Promise<void> {
  const id = `plg_${slug.replace(/-/g, "_")}`;
  await namingSaves(server.store).saveResource(
    ApiResourceKind.plugin,
    id,
    PluginSchema,
    create(PluginSchema, {
      apiVersion: API_VERSION,
      kind: "Plugin",
      metadata: { id, name: slug, slug, org: ORG_ID, visibility: ApiResourceVisibility.visibility_org },
      status: {
        ...(carries === "hooks"
          ? { hooks: { groups: [{ event: "PreToolUse", matcher: "*", handlers: [{ command: "lint.sh" }] }] } }
          : {}),
        mcpServers: [
          carries === "stdio"
            ? { name: "git-local", transport: { case: "stdio", value: { command: "npx", args: [] } } }
            : { name: "remote", transport: { case: "http", value: { url: "https://remote.example/mcp" } } },
        ],
      },
    }),
  );
}

function agentInput(name: string, spec: MessageInitShape<typeof AgentSpecSchema>) {
  return {
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: { instructions: "You answer support tickets.", ...spec },
  };
}

async function createAgent(spec: MessageInitShape<typeof AgentSpecSchema>, name = uniqueName("agent")): Promise<Agent> {
  return agents.create(agentInput(name, spec));
}

function updateOf(agent: Agent, spec: MessageInitShape<typeof AgentSpecSchema>, paths: string[]) {
  return {
    resource: {
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { id: agent.metadata!.id, name: agent.metadata!.name, slug: agent.metadata!.slug, org: ORG },
      spec,
    },
    updateMask: { paths },
  };
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const pluginRef = (slug: string) => ({ kind: ApiResourceKind.plugin, slug });

describe("an agent's computer on save", () => {
  it("gives a new agent that names none a computer, on either harness", async () => {
    expect((await createAgent({})).spec?.computer).toBe(Computer.REQUIRED);
    expect((await createAgent({ harness: Harness.CLAUDE })).spec?.computer).toBe(Computer.REQUIRED);
    expect((await createAgent({ computer: Computer.NONE })).spec?.computer).toBe(Computer.NONE);
  });

  it("refuses no computer on the Claude harness", async () => {
    const error = await refusal(() => createAgent({ harness: Harness.CLAUDE, computer: Computer.NONE }));
    expect([error.code, error.rawMessage]).toEqual([Code.InvalidArgument, CLAUDE_NEEDS_COMPUTER_MESSAGE]);
  });

  it("refuses a Bash tool and its own hooks on create, and Bash added by an update", async () => {
    const bash = await refusal(() => createAgent({ computer: Computer.NONE, tools: ["Read", "Bash(git *)"] }));
    expect(bash.code).toBe(Code.InvalidArgument);
    expect(bash.rawMessage).toContain("its tools can't list 'Bash(git *)'");
    const hooks = await refusal(() =>
      createAgent({
        computer: Computer.NONE,
        hooks: [{ source: { case: "inline", value: { groups: [{ event: "PreToolUse", matcher: "*", handlers: [{ command: "lint.sh" }] }] } } }],
      }),
    );
    expect(hooks.code).toBe(Code.InvalidArgument);
    expect(hooks.rawMessage).toContain("it can't run its own hooks");

    const agent = await createAgent({ computer: Computer.NONE, tools: ["Read"], disallowedTools: ["Bash"] });
    const update = await refusal(() => agents.update(updateOf(agent, { tools: ["Read", "Bash"] }, ["spec.tools"])));
    expect(update.code).toBe(Code.InvalidArgument);
  });

  it("refuses a plugin with hooks or a local program, and keeps one whose servers are URLs", async () => {
    const hooks = await refusal(() => createAgent({ computer: Computer.NONE, plugins: [pluginRef("code-style")] }));
    expect([hooks.code, hooks.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "this agent has no computer, so it can't use plugin 'code-style', which runs hooks; remove the plugin, or give the agent a computer",
    ]);
    const stdio = await refusal(() => createAgent({ computer: Computer.NONE, plugins: [pluginRef("github-tools")] }));
    expect(stdio.code).toBe(Code.FailedPrecondition);
    expect(stdio.rawMessage).toContain("runs its MCP server 'git-local' as a local program");
    expect((await createAgent({ computer: Computer.NONE, plugins: [pluginRef("docs")] })).spec?.computer).toBe(Computer.NONE);
    // An agent with a computer lists any of them.
    await createAgent({ plugins: [pluginRef("code-style"), pluginRef("github-tools")] });
  });

  it("refuses a subagent with a computer and lists one without", async () => {
    const fixer = await createAgent({}, uniqueName("repo-fixer"));
    const error = await refusal(() =>
      createAgent({ computer: Computer.NONE, subagents: [{ kind: ApiResourceKind.agent, slug: fixer.metadata!.slug }] }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(`can't list subagent '${fixer.metadata!.slug}', which has one`);

    const triage = await createAgent({ computer: Computer.NONE }, uniqueName("triage"));
    const parent = await createAgent({
      computer: Computer.NONE,
      subagents: [{ kind: ApiResourceKind.agent, slug: triage.metadata!.slug }],
    });
    expect(parent.spec?.computer).toBe(Computer.NONE);
  });

  it("keeps a stored COMPUTER_NONE through an update and an apply that leave it unset", async () => {
    const agent = await createAgent({ computer: Computer.NONE });
    const updated = await agents.update(
      updateOf(agent, { instructions: "You answer billing tickets." }, ["spec.instructions", "spec.computer"]),
    );
    expect(updated.spec?.computer).toBe(Computer.NONE);
    const applied = await agents.apply(agentInput(agent.metadata!.name, { instructions: "You answer billing tickets." }));
    expect(applied.metadata?.id).toBe(agent.metadata?.id);
    expect(applied.spec?.computer).toBe(Computer.NONE);
    expect(applied.status?.versionHash).toBe(updated.status?.versionHash);
    const on = await agents.update(updateOf(agent, { computer: Computer.REQUIRED }, ["spec.computer"]));
    expect(on.spec?.computer).toBe(Computer.REQUIRED);
  });

  it("leaves an agent saved before the setting unset, so a re-apply keeps its version hash", async () => {
    const agent = await createAgent({});
    // The row as a server before the setting stored it: no computer, and the
    // head hash of that spec.
    const stored = await server.store.getResource(ApiResourceKind.agent, agent.metadata!.id, AgentSchema);
    stored.spec!.computer = Computer.UNSPECIFIED;
    const before = canonicalSpecHash(AgentSpecSchema, stored.spec!);
    stored.status!.versionHash = before;
    await namingSaves(server.store).saveResource(ApiResourceKind.agent, agent.metadata!.id, AgentSchema, stored);

    const applied = await agents.apply(agentInput(agent.metadata!.name, {}));
    expect(applied.spec?.computer).toBe(Computer.UNSPECIFIED);
    expect(applied.status?.versionHash).toBe(before);
  });
});

let sessionCounter = 0;
async function createSession(spec: MessageInitShape<typeof SessionSpecSchema>): Promise<Session> {
  sessionCounter += 1;
  return sessions.create({
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: { name: `Computer ${sessionCounter}`, org: ORG },
    spec,
  });
}

function sessionUpdate(session: Session, spec: MessageInitShape<typeof SessionSpecSchema>) {
  return {
    resource: {
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { id: session.metadata!.id, name: session.metadata!.name, slug: session.metadata!.slug, org: ORG },
      spec,
    },
    updateMask: { paths: ["*"] },
  };
}

/** Records a turn in `session`, so it has run. */
async function seedRun(session: Session): Promise<void> {
  counter += 1;
  const id = `run_computer_${counter}`;
  await namingSaves(server.store).saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      apiVersion: API_VERSION,
      kind: "Run",
      metadata: { id, name: `Run ${counter}`, org: ORG },
      spec: { target: { case: "sessionId", value: session.metadata!.id } },
      status: { phase: RunPhase.RUN_COMPLETED },
    }),
  );
}

const agentRefOf = (agent: Agent, version = "") => ({ kind: ApiResourceKind.agent, org: ORG, slug: agent.metadata!.slug, version });
const repository = { name: "app", resource: { case: "gitRepository" as const, value: { url: "https://github.com/acme/app" } } };

describe("a conversation on an agent without a computer", () => {
  it("records the agent's computer; the built-in assistant records none, which has one", async () => {
    const agent = await createAgent({ computer: Computer.NONE });
    expect((await createSession({ agentRef: agentRefOf(agent) })).status?.computer).toBe(Computer.NONE);
    expect((await createSession({ agentRef: agentRefOf(await createAgent({})) })).status?.computer).toBe(Computer.REQUIRED);
    expect((await createSession({})).status?.computer).toBe(Computer.UNSPECIFIED);
  });

  it("refuses a repository, the Claude harness and a plugin with hooks on create", async () => {
    const agent = await createAgent({ computer: Computer.NONE });
    const prefix = `agent '${agent.metadata!.slug}' has no computer`;
    const repo = await refusal(() => createSession({ agentRef: agentRefOf(agent), resources: [repository] }));
    expect([repo.code, repo.rawMessage]).toEqual([
      Code.FailedPrecondition,
      `${prefix}, so this conversation can't attach repository 'app'; remove it, or give the agent a computer`,
    ]);
    const claude = await refusal(() => createSession({ agentRef: agentRefOf(agent), harness: Harness.CLAUDE }));
    expect(claude.code).toBe(Code.FailedPrecondition);
    expect(claude.rawMessage).toContain("can't run on the Claude engine");
    const plugin = await refusal(() => createSession({ agentRef: agentRefOf(agent), plugins: [pluginRef("code-style")] }));
    expect(plugin.code).toBe(Code.FailedPrecondition);
    expect(plugin.rawMessage).toContain("can't use plugin 'code-style', which runs hooks");
  });

  it("refuses a repository added by an update after the first turn", async () => {
    const agent = await createAgent({ computer: Computer.NONE });
    const session = await createSession({ agentRef: agentRefOf(agent) });
    await seedRun(session);
    const error = await refusal(() =>
      sessions.update(sessionUpdate(session, { agentRef: agentRefOf(agent), resources: [repository] })),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("can't attach repository 'app'");
  });

  it("keeps the computer it started with once it has run, through a re-pin", async () => {
    const agent = await createAgent({ computer: Computer.NONE });
    const session = await createSession({ agentRef: agentRefOf(agent) });
    await seedRun(session);
    await agents.update(updateOf(agent, { computer: Computer.REQUIRED }, ["spec.computer"]));
    const repinned = await sessions.update(sessionUpdate(session, { agentRef: agentRefOf(agent, "latest") }));
    expect(repinned.status?.agentVersionHash).not.toBe(session.status?.agentVersionHash);
    expect(repinned.status?.computer).toBe(Computer.NONE);

    // A conversation that has not run follows the version it is pinned to.
    const fresh = await createSession({ agentRef: agentRefOf(agent) });
    expect(fresh.status?.computer).toBe(Computer.REQUIRED);
  });
});
