// Conformance suite for an agent on the `stigmer mcp-server` over stdio: a
// fixture agent that reads a Stigmer resource through the mcp-server's tools,
// run as an ordinary Run against the real mcp-server over stdio.
// Domain: agentic / run — an agent's tool loop over a stdio MCP server,
// observed through the transcript. This is the one always-on CI proof of the
// runner's stdio lane and the mcp-server roster.
//
// What is real here and what is scripted: the agent's instructions are the
// fixture's (support/stigmer-mcp-stdio.ts; the product ships no such agent),
// the McpServer is the real `@stigmer/mcp-server` full roster spawned by the
// runner as a stdio child (it reaches THIS server through the
// STIGMER_SERVER_ADDRESS the run's runtime env supplies), and the tool call
// (get_agent) executes for real against this server. Only the model's turns
// are scripted on the mock. So a passing arm proves the whole chain: fixture
// prompt → runner → stdio mcp-server → this server → tool result on the
// transcript.
//
// Pinned: the agent's get_agent call is recorded as a ToolCall whose result
// is this server's answer (the agent's own description, a marker no other
// source holds); a second run in the same session starts the stdio server
// again and reads through it the same way.
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { allToolCalls, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { agentRefOf } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import {
  STDIO_READ_TOOL,
  makeStdioAgent,
  makeStigmerMcpServer,
  stigmerMcpServerRuntimeEnv,
} from "../support/stigmer-mcp-stdio";
import { createTarget, type TargetProfile } from "../targets";

// Collection-time gate: the stdio mcp-server child dials the server under test
// with no credential of its own, so the arms run only where the target exposes
// an anonymously reachable unified port (the local targets). On the cloud
// targets the lane needs a bearer the fixture does not mint, and the file
// reports SKIPPED rather than a false green.
const dialsAnonymously = createTarget().httpBaseUrl !== undefined;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

interface StdioAgent {
  org: string;
  slug: string;
  description: string;
  sessionId: string;
  runtimeEnv: ReturnType<typeof stigmerMcpServerRuntimeEnv>;
}

// The fixture agent on the real stigmer mcp-server, with a NATIVE session the
// arms run one or more runs in. Its description is a fresh marker, the answer
// a read through the stdio server must return.
async function provisionStdioAgent(): Promise<StdioAgent> {
  const { org } = await target.provisionTenancy();
  const server = await clients.mcpServerCommand.create(makeStigmerMcpServer({ org, name: uniqueName("stigmer-mcp") }));
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

  const description = uniqueName("read-through-stdio");
  const agent = await clients.agentCommand.create(
    makeStdioAgent({ org, name: uniqueName("reader"), description, stigmerMcpServerSlug: server.metadata!.slug }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("ses-reader"), agentRef: agentRefOf(agent), harness: Harness.NATIVE }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

  return {
    org,
    slug: agent.metadata!.slug,
    description,
    sessionId: session.metadata!.id,
    runtimeEnv: stigmerMcpServerRuntimeEnv(serverAddress()),
  };
}

// The gRPC origin the stdio mcp-server child dials: the server this suite
// talks to. The execution targets expose it as the unified port's base URL.
function serverAddress(): string {
  const url = target.httpBaseUrl?.();
  if (url === undefined) {
    throw new Error(`target ${target.name} exposes no server base URL for the stdio mcp-server to dial`);
  }
  return url;
}

// Scripts one read: a get_agent call on the fixture agent, then an answer.
function scriptRead(agent: StdioAgent, toolCallId: string): void {
  mock.enqueue(anthropicToolUse(toolCallId, STDIO_READ_TOOL, { org: agent.org, slug: agent.slug }));
  mock.enqueue(anthropicText(`The agent's description is ${agent.description}.`));
}

async function runRead(agent: StdioAgent): Promise<Run> {
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: agent.org,
      name: uniqueName("aex-reader"),
      sessionId: agent.sessionId,
      message: `What is the description of ${agent.org}/${agent.slug}?`,
      autoApproveAll: true,
      runtimeEnv: agent.runtimeEnv,
    }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: run.metadata!.id }));
  const final = await awaitTerminal(clients, run.metadata!.id, { timeoutMs: 120_000 });
  expect(
    final.status?.phase,
    `the run should complete; reached ${RunPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(RunPhase.RUN_COMPLETED);
  return final;
}

// The run's get_agent ToolCall, or a named failure.
function readCall(final: Run) {
  const call = allToolCalls(final).find((tc) => tc.name === STDIO_READ_TOOL);
  if (call === undefined) {
    throw new Error(
      `no ${STDIO_READ_TOOL} call on the transcript: ${JSON.stringify(allToolCalls(final).map((tc) => tc.name))}`,
    );
  }
  return call;
}

describe.skipIf(!dialsAnonymously)("An agent on the stigmer mcp-server over stdio", () => {
  it("reads an agent through the real mcp-server, and the tool result is this server's answer", async () => {
    const agent = await provisionStdioAgent();
    scriptRead(agent, "toolu_read_01");

    const final = await runRead(agent);

    const call = readCall(final);
    expect(call.error, "the stdio tool call succeeded").toBe("");
    expect(call.result, "the result carries the agent's description, which only this server holds").toContain(
      agent.description,
    );
    expect(mock.remaining(), "the agent consumed exactly its script").toBe(0);
  });

  it("a second run in the same session starts the stdio server again and reads through it", async () => {
    const agent = await provisionStdioAgent();
    scriptRead(agent, "toolu_read_02");
    scriptRead(agent, "toolu_read_03");

    const first = await runRead(agent);
    const second = await runRead(agent);

    for (const final of [first, second]) {
      expect(readCall(final).result).toContain(agent.description);
    }
    expect(mock.remaining(), "both runs consumed exactly the shared script").toBe(0);
  });
});
