// Conformance suite for what a run does with an MCP server its agent writes
// itself (AgentSpec.mcp_servers), on a real engine (Class B).
// Domain: agentic / run — the server planned at create, dialed at turn
// start, gated, filled with its values and its login, and named to hooks.
//
// The surface is the harness's HTTP MCP fixture (harness/mcp-server.ts),
// written straight into the agent, never pushed as a plugin: each arm's
// agent writes exactly one server, named SERVER, at one of the fixture's
// tool surfaces, and no plugin of the fixture rides the same turn (the
// native engine binds MCP tools by bare name, so one turn holds one fixture
// server). The fixture records each JSON-RPC request with its headers, so
// what reached the server is read where it arrived.
//
// The contract under test:
//   - a run of an agent that writes its own server dials it at turn start
//     and calls its tool, the call named under the server's own name;
//   - a tool the server marks destructive asks first, as a plugin's does,
//     and reaches the server only once allowed;
//   - a server that sends no Authorization header of its own takes an
//     optional login, `<NAME>_ACCESS_TOKEN`: a connection saved in My vault
//     at the server's address arrives as `Authorization: Bearer <token>`;
//     with no connection and no secret the server is called with no
//     Authorization header at all;
//   - a `${NAME}` a header reads is planned for the server, a TOOL declarer
//     naming the agent and its version, and never for the agent's shell;
//     the value arrives in the header;
//   - a header reading the caller's identity is filled by the runner, and no
//     vault value stands in for it, even one saved under that name;
//   - a run of a pinned earlier version dials the address that version
//     wrote, after an edit moved the server elsewhere;
//   - a Claude Code PreToolUse hook sees the call as
//     `mcp__<name>__<tool>` with `mcp_server` `{name, source: "agent"}`;
//   - an agent and its saved subagent both writing a server of one name is
//     refused at run create, FAILED_PRECONDITION naming both.
//
// Out of scope here: who may write a server, and its shape at save, which
// the CRUD suite pins (suites/agent-mcp-servers.conformance.test.ts); an
// agent eval turning the agent's own servers off in its tries, which the
// agent eval suite pins beside the plugin server arm
// (agent-eval.conformance.test.ts); and a values fetch with the run's own
// credential, which the cloud refuses an outside caller (the manifest is
// read with a plain get instead, support/run-values.ts runSourcesOf).
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Code } from "@connectrpc/connect";
import type { ToolUse, Turn } from "@stigmer/session-log";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  type CapturedMcpRequest,
  DESTRUCTIVE_ECHO_TOOL_NAME,
  ECHO_TOOL_NAME,
  type FixtureTool,
  type McpToolFixture,
} from "../harness/mcp-server";
import { type AgentOptions, type AgentRefInit, agentRefOf, createSubagents, makeAgent, subagentSlugsOf } from "../support/agents";
import { awaitRequiresAction, confirmPerContract } from "../support/answers";
import { uniqueName } from "../support/naming";
import { RunValueDeclarerKind, RunValueOrigin, runSourcesOf, sourcesFor } from "../support/run-values";
import {
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import { toolUseByCallId, turnById, turnOfRun } from "../support/turn";
import { myVaultTarget, setConnectionInput, setSecretsInput } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

// The one server every arm's agent writes, and the login it may take.
const SERVER = "fixture-own";
const LOGIN_KEY = "FIXTURE_OWN_ACCESS_TOKEN";

// The runner's caller-identity key (pinned verbatim to its caller-identity.ts).
const CALLER_VALUE_KEY = "STIGMER_CALLER_IDENTITY_VALUE";

// An address nothing listens on: where an edit moves the server.
const UNREACHABLE_URL = "http://127.0.0.1:9/mcp";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  // A run that ended before it reached the model would take the next arm's
  // script; wait, bounded, for every scripted turn to be claimed. An arm
  // whose create was refused started no run and scripted nothing.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

interface OwnServerOptions {
  // The fixture's tool surface the server is (McpToolFixture.url).
  readonly tools: readonly FixtureTool[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly url?: string;
}

// The one server an agent writes, at the fixture's `tools` surface unless a url is given.
function ownServer(opts: OwnServerOptions) {
  return {
    name: SERVER,
    url: opts.url ?? mcp.url(opts.tools),
    ...(opts.headers !== undefined ? { headers: { ...opts.headers } } : {}),
  };
}

// Saves an agent in `org` that writes the one server, and defers its delete.
async function agentWithOwnServer(
  org: string,
  server: OwnServerOptions,
  extra: Omit<AgentOptions, "org" | "name" | "mcpServers"> = {},
): Promise<Agent> {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-own-server"), ...extra, mcpServers: [ownServer(server)] }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

/** Saves secrets into the caller's My vault in `org`, creating it on the first write. */
async function saveToMyVault(org: string, secrets: Record<string, string>): Promise<void> {
  const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), secrets));
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }).catch(() => undefined));
}

/** Saves a login at `address` into the caller's My vault in `org`. */
async function saveConnection(org: string, address: string, token: string): Promise<void> {
  const mine = await clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), address, token));
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }).catch(() => undefined));
}

// Scripts one `echo` call (the native engine binds the tool by its bare
// name) and a closing text turn, runs the turn on `agentRef` to its end,
// and asserts it completed. Answers the run and its turn.
async function completedEchoRun(
  org: string,
  agentRef: AgentRefInit,
  callId: string,
  opts: { includeMyVault?: boolean } = {},
) {
  mock.enqueue(anthropicToolUse(callId, ECHO_TOOL_NAME, { text: "ping" }));
  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-own-server"),
      agentRef,
      autoApproveAll: true,
      ...(opts.includeMyVault !== undefined ? { includeMyVault: opts.includeMyVault } : {}),
    }),
  );
  const runId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
  const final = await awaitTerminal(clients, runId);
  expect(
    RunPhase[final.status?.phase ?? 0],
    `run ${runId} completes (error: ${final.status?.error ?? ""})`,
  ).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
  return { runId, final, turn: await turnOfRun(clients, final) };
}

// The turn's tool use for the scripted call `callId`; red when the log has none.
function requireToolUse(turn: Turn, callId: string): ToolUse {
  const use = toolUseByCallId(turn, callId);
  expect(use, `turn ${turn.runId}: the call ${callId} is in the log`).toBeDefined();
  return use!;
}

// The tools/call requests the fixture received, with their headers.
function toolCalls(): CapturedMcpRequest[] {
  return mcp.capturedRequests().filter((request) => request.method === "tools/call");
}

// One header of a captured request, as node delivers it (names lowercased).
function headerOf(request: CapturedMcpRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

describe("Run — an agent's own MCP server is dialed and its tool called", () => {
  it("a run calls the tool of the server its agent writes, named under the server's own name, and the server receives the call", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithOwnServer(org, { tools: [ECHO_TOOL_NAME] });

    const { turn } = await completedEchoRun(org, agentRefOf(agent), "call_own_echo");

    const echo = requireToolUse(turn, "call_own_echo");
    expect(echo.name).toBe(ECHO_TOOL_NAME);
    expect(echo.state, "the call ran").toBe("completed");
    expect(echo.mcpServerName, "the call names the agent's own server").toBe(SERVER);
    expect(echo.result?.text, "the server echoed the input back").toContain("ping");
    expect(toolCalls(), "the call reached the fixture as one tools/call").toHaveLength(1);
    expect(mock.remaining(), "both scripted turns were consumed").toBe(0);
  });

  it("a tool the server marks destructive asks first, as a plugin's does, and reaches the server only once allowed", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithOwnServer(org, { tools: [DESTRUCTIVE_ECHO_TOOL_NAME] });

    mock.enqueue(anthropicToolUse("call_own_destructive", DESTRUCTIVE_ECHO_TOOL_NAME, { text: "careful" }));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-own-gate"), agentRef: agentRefOf(agent) }),
    );
    const runId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
    const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    const sessionId = sessionIdOf(gated);
    const [waiting] = await awaitRequiresAction(clients, sessionId, 1);

    const turn = await turnById(clients, sessionId, runId);
    expect(turn.asks.map((ask) => ask.id), "exactly the one call waits").toEqual([waiting]);
    const ask = turn.asks[0]!;
    expect(ask.name).toBe(DESTRUCTIVE_ECHO_TOOL_NAME);
    expect(ask.mcpServerName, "the ask names the agent's own server").toBe(SERVER);
    expect(ask.ask?.policySource, "the default asked because the server marks the tool destructive").toBe(
      "annotation_destructive_tighten",
    );
    expect(toolCalls(), "nothing reached the server before the answer").toEqual([]);

    await confirmPerContract({
      clients,
      sessionId,
      runId,
      expectedRemaining: 0,
      label: "the allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: waiting!, result: "allow" }),
    });
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(requireToolUse(await turnOfRun(clients, final), "call_own_destructive").state).toBe("completed");
    expect(toolCalls(), "the allowed call reached the server").toHaveLength(1);
  });
});

describe("Run — an agent's own server's login and values", () => {
  it("a connection saved in My vault at the server's address arrives as its Authorization bearer", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithOwnServer(org, { tools: [ECHO_TOOL_NAME] });
    await saveConnection(org, mcp.url([ECHO_TOOL_NAME]), "own-server-login");

    const { runId } = await completedEchoRun(org, agentRefOf(agent), "call_own_login", { includeMyVault: true });

    const login = sourcesFor(await runSourcesOf(clients, runId), LOGIN_KEY);
    expect(
      login.map((source) => [source.declarer?.kind, source.declarer?.agentId, source.declarer?.server, source.origin]),
      "the login is planned for the agent's server, from My vault",
    ).toEqual([[RunValueDeclarerKind.TOOL, agent.metadata!.id, SERVER, RunValueOrigin.MY_VAULT]]);
    const calls = toolCalls();
    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0]!, "authorization"), "the login arrives as a bearer").toBe("Bearer own-server-login");
  });

  it("with no connection and no secret, the server is called with no Authorization header at all", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentWithOwnServer(org, { tools: [ECHO_TOOL_NAME] });

    await completedEchoRun(org, agentRefOf(agent), "call_own_no_login", { includeMyVault: true });

    expect(toolCalls(), "the call reached the server").toHaveLength(1);
    for (const request of mcp.capturedRequests()) {
      expect(headerOf(request, "authorization"), `${request.method} carries no Authorization`).toBeUndefined();
    }
  });

  it("[rpc:RunCommandController.create] a key a header reads is planned for the server by agent and version, never for the shell, and arrives in the header", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { FIXTURE_KEY: "own-server-key" });
    const agent = await agentWithOwnServer(org, {
      tools: [ECHO_TOOL_NAME],
      headers: { "X-Api-Key": "${FIXTURE_KEY}" },
    });

    const { runId } = await completedEchoRun(org, agentRefOf(agent), "call_own_key", { includeMyVault: true });

    const sources = sourcesFor(await runSourcesOf(clients, runId), "FIXTURE_KEY");
    expect(
      sources.map((source) => [
        source.declarer?.kind,
        source.declarer?.agentId,
        source.declarer?.agentVersion,
        source.declarer?.server,
        source.origin,
      ]),
      "the key is planned only for the agent's server, at the run's agent version, from My vault",
    ).toEqual([[RunValueDeclarerKind.TOOL, agent.metadata!.id, agent.status!.versionHash, SERVER, RunValueOrigin.MY_VAULT]]);
    expect(
      sources.filter((source) => source.declarer?.kind === RunValueDeclarerKind.AGENT),
      "the agent's shell is never given the header's key",
    ).toEqual([]);
    const calls = toolCalls();
    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0]!, "x-api-key"), "the value arrives in the header").toBe("own-server-key");
  });

  it("a header reading the caller's identity is filled by the runner, and no vault value stands in for it", async () => {
    const { org } = await target.provisionTenancy();
    // A value saved under the runner's own key: it must never reach the server.
    await saveToMyVault(org, { [CALLER_VALUE_KEY]: "vault-forged-identity" });
    const agent = await agentWithOwnServer(org, {
      tools: [ECHO_TOOL_NAME],
      headers: { "X-Caller": `\${${CALLER_VALUE_KEY}}` },
    });

    const { runId, final } = await completedEchoRun(org, agentRefOf(agent), "call_own_identity", {
      includeMyVault: true,
    });
    expect(
      sourcesFor(await runSourcesOf(clients, runId), CALLER_VALUE_KEY),
      "the caller's identity is asked of no vault",
    ).toEqual([]);

    // The expected identity, derived from the session's own audit actor by
    // the resolver's documented precedence (mcp-caller-identity's arm):
    // a creator email, else a creator id that is not the "system"
    // placeholder, else the anonymous sentinel's empty value.
    const session = await clients.sessionQuery.get({ value: sessionIdOf(final) });
    const creator = session.status?.audit?.specAudit?.createdBy;
    const email = creator?.email?.trim() ?? "";
    const creatorId = creator?.id?.trim() ?? "";
    const expected = email !== "" ? email : creatorId !== "" && creatorId !== "system" ? creatorId : "";

    const calls = toolCalls();
    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0]!, "x-caller"), "the runner fills the caller's identity").toBe(expected);
    expect(headerOf(calls[0]!, "x-caller"), "the vault's value never stands in").not.toBe("vault-forged-identity");
  });
});

describe("Run — an agent's own server is read at the version the run planned", () => {
  it("a run of a pinned earlier version dials the address that version wrote, after an edit moved the server", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent-own-pinned");
    const v1 = await clients.agentCommand.apply(
      makeAgent({ org, name, mcpServers: [ownServer({ tools: [ECHO_TOOL_NAME] })] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));
    const v2 = await clients.agentCommand.apply(
      makeAgent({ org, name, mcpServers: [ownServer({ tools: [ECHO_TOOL_NAME], url: UNREACHABLE_URL })] }),
    );
    expect(v2.status?.versionHash, "the edit is a new version").not.toBe(v1.status?.versionHash);
    expect(v2.spec?.mcpServers.map((server) => server.url), "the head points elsewhere").toEqual([UNREACHABLE_URL]);

    const { final, turn } = await completedEchoRun(
      org,
      agentRefOf(v1, v1.status!.versionHash),
      "call_own_pinned",
    );

    expect(final.status?.agentVersionHash, "the run planned the pinned version").toBe(v1.status?.versionHash);
    expect(requireToolUse(turn, "call_own_pinned").state, "the pinned version's server answered").toBe("completed");
    expect(toolCalls(), "the call reached the address the pinned version wrote").toHaveLength(1);
  });
});

describe("Run — hooks see an agent's own server's tools", () => {
  it("a PreToolUse hook sees the call as mcp__<name>__<tool> with its server named as the agent's", async () => {
    const { org } = await target.provisionTenancy();
    // The hook refuses with its whole stdin as the reason (Claude Code's exit
    // 2), so the call's result carries exactly what the hook was shown.
    const agent = await agentWithOwnServer(
      org,
      { tools: [ECHO_TOOL_NAME] },
      {
        hooks: [{
          source: {
            case: "inline",
            value: { groups: [{ event: "PreToolUse", matcher: "mcp__.*__echo", handlers: [{ command: "cat >&2; exit 2" }] }] },
          },
        }],
      },
    );

    const { turn } = await completedEchoRun(org, agentRefOf(agent), "call_own_hooked");

    const refused = requireToolUse(turn, "call_own_hooked");
    expect(refused.state, "the hook refused the call").toBe("failed");
    const text = refused.result?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    expect(start, `the result carries the hook's stdin: ${text}`).toBeGreaterThanOrEqual(0);
    const shown = JSON.parse(text.slice(start, end + 1)) as { tool_name?: unknown; mcp_server?: unknown; tool_input?: unknown };
    expect(shown.tool_name, "the hook sees Claude Code's MCP tool name").toBe(`mcp__${SERVER}__${ECHO_TOOL_NAME}`);
    expect(shown.mcp_server, "the hook sees the server as the agent's own").toEqual({ name: SERVER, source: "agent" });
    expect(shown.tool_input).toEqual({ text: "ping" });
    expect(toolCalls(), "a refused call never reaches the server").toEqual([]);
  });
});

describe("Run — an agent and its subagent writing a server of one name", () => {
  it("[rpc:RunCommandController.create] a run whose agent and saved subagent both write a server of one name is refused, naming both", async () => {
    const { org } = await target.provisionTenancy();
    const [subagent] = await createSubagents(clients, fixtures, org, [
      { name: uniqueName("sub-own-server"), mcpServers: [ownServer({ tools: [ECHO_TOOL_NAME] })] },
    ]);
    const parent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("parent-own-server"),
        subagents: subagentSlugsOf([subagent!]),
        mcpServers: [ownServer({ tools: [ECHO_TOOL_NAME] })],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: parent.metadata!.id }));

    const refused = await expectGrpcCode(
      async () => {
        const created = await clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex-own-clash"), agentRef: agentRefOf(parent) }),
        );
        fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
      },
      Code.FailedPrecondition,
      "a run whose agent and subagent both write one server name",
    );
    expect(refused.rawMessage).toBe(
      `this conversation uses two MCP servers a turn would both name '${SERVER}' ` +
        `(agent '${parent.metadata!.name}' server '${SERVER}' and agent '${subagent!.metadata!.slug}' server '${SERVER}'); ` +
        "rename one of them in its agent, or remove the subagent from the agent",
    );
  });
});
