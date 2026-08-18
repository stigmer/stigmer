// Conformance suite for the MCP caller-identity header contract (Class B).
// Domain: agentic / agentexecution — the mint → session → execution → headers
// chain (stigmer#382).
//
// The contract under test (docs/guides/integrations/caller-identity-for-mcp-servers.mdx):
// an McpServer that declares the reserved STIGMER_CALLER_IDENTITY_KIND/_VALUE
// env keys (`optional: true`) and templates them into its headers receives the
// platform-verified caller identity on EVERY request — resolved with fixed
// precedence: channel sender (SessionSpec.metadata, cloud-broker-stamped) →
// session creator (`stigmer_user` from the session's audit actor) → the
// anonymous sentinel. A server that never declares the keys never receives
// identity (opt-in by construction — filterEnvToDeclaredKeys).
//
// This chain crosses four components (audit transformer → runner resolver →
// env filter → header templating) and previously had NO automated test that
// observes the headers on the wire — #377 and #380 both shipped contract
// drift caught only by a manual live probe. The observation point here is the
// receiving server itself: the McpToolFixture records each JSON-RPC request's
// method + HTTP headers, so the assertions read exactly what crossed the wire
// on the `tools/call` request that dispatched the tool.
//
// Edition-agnostic by derivation, not by forking: the expected creator
// identity is DERIVED from the session resource's own audit actor via the
// resolver's documented precedence (email → stigmer_user/email; the "system"
// placeholder or an absent creator → anonymous). On cloud the creator is the
// real minted user; on an unconfigured local OSS server it is the "system"
// sentinel — both are correct outcomes of one contract, so the same assertion
// pins both editions without a capability flag.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import type { CapturedMcpRequest, McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/agentexecutions";
import { FixtureTracker } from "../harness/fixtures";
import { makeHttpMcpServer, type HttpMcpServerOptions } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// The reserved env keys (pinned verbatim to the runner's caller-identity.ts).
const KIND_ENV_KEY = "STIGMER_CALLER_IDENTITY_KIND";
const VALUE_ENV_KEY = "STIGMER_CALLER_IDENTITY_VALUE";

// The header names the suite templates. Node lowercases incoming header names,
// so captures are asserted via the lowercase forms.
const KIND_HEADER = "x-stigmer-caller-kind";
const VALUE_HEADER = "x-stigmer-caller-value";

// SessionSpec.metadata keys the cloud broker stamps for channel senders —
// pinned verbatim to the runner's sender-identity.ts (which pins them to
// ChannelRuntimeConstants in stigmer-cloud; drift guards exist on both sides).
const SENDER_IDENTITY_METADATA_KEY = "stigmer.ai/channel-sender-identity";
const SENDER_KIND_METADATA_KEY = "stigmer.ai/channel-sender-kind";

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
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

// An McpServer declaring the reserved keys and templating them into headers —
// the exact shape the docs guide prescribes (rules 1 and 2).
function identityTemplatingServer(
  opts: Pick<HttpMcpServerOptions, "org" | "name" | "url">,
): ReturnType<typeof makeHttpMcpServer> {
  return makeHttpMcpServer({
    ...opts,
    headers: {
      "X-Stigmer-Caller-Kind": `\${${KIND_ENV_KEY}}`,
      "X-Stigmer-Caller-Value": `\${${VALUE_ENV_KEY}}`,
    },
    env: {
      [KIND_ENV_KEY]: { optional: true, description: "Injected by the platform" },
      [VALUE_ENV_KEY]: { optional: true, description: "Injected by the platform" },
    },
  });
}

// Drives one echo-tool run against the given McpServer resource and returns
// the tools/call requests the fixture observed for it. sessionSpec lets the
// channel case stamp sender metadata on the auto-created session.
async function runEchoAndCapture(options: {
  org: string;
  server: ReturnType<typeof makeHttpMcpServer>;
  sessionSpec?: { metadata: Record<string, string> };
}): Promise<{ toolCalls: CapturedMcpRequest[]; sessionId: string }> {
  const server = await clients.mcpServerCommand.create(options.server);
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

  const agent = await clients.agentCommand.create(
    makeAgent({
      org: options.org,
      name: uniqueName("agent-identity"),
      mcpServerRefs: [server.metadata!.slug],
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  mock.enqueue(anthropicToolUse("call_echo_identity", ECHO_TOOL_NAME, { text: "ping" }));
  mock.enqueue(anthropicText("Done."));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: options.org,
      name: uniqueName("aex-identity"),
      agentId: agent.metadata!.id,
      autoApproveAll: true,
      ...(options.sessionSpec !== undefined ? { sessionSpec: options.sessionSpec } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

  const toolCalls = mcp.capturedRequests().filter((r) => r.method === "tools/call");
  expect(toolCalls.length, "the echo dispatch reaches the fixture as a tools/call").toBeGreaterThan(0);
  return { toolCalls: [...toolCalls], sessionId: final.spec?.sessionId ?? "" };
}

describe("MCP caller-identity headers (mint → session → execution → headers)", () => {
  it("carries the session creator identity, derived per the resolver's documented precedence", async () => {
    const { org } = await target.provisionTenancy();
    const { toolCalls, sessionId } = await runEchoAndCapture({
      org,
      server: identityTemplatingServer({ org, name: uniqueName("mcp-identity"), url: mcp.url() }),
    });

    // Derive the expected identity from the session's own audit actor — the
    // exact source and precedence the runner resolves from: a creator email
    // → stigmer_user/<email>; the "system" audit placeholder (or no creator)
    // is not a principal and resolves to the anonymous sentinel.
    expect(sessionId, "a completed run carries its auto-created session id").not.toBe("");
    const session = await clients.sessionQuery.get({ value: sessionId });
    const creator = session.status?.audit?.specAudit?.createdBy;
    const email = creator?.email?.trim() ?? "";
    const creatorId = creator?.id?.trim() ?? "";
    const expected =
      email !== ""
        ? { kind: "stigmer_user", value: email }
        : creatorId !== "" && creatorId !== "system"
          ? { kind: "stigmer_user", value: creatorId }
          : { kind: "anonymous", value: "" };

    for (const call of toolCalls) {
      expect(call.headers[KIND_HEADER], "the kind header carries the resolved identity kind").toBe(
        expected.kind,
      );
      expect(call.headers[VALUE_HEADER], "the value header carries the resolved identity value").toBe(
        expected.value,
      );
    }
  });

  it("prefers the channel-stamped sender identity over the session creator", async () => {
    const { org } = await target.provisionTenancy();
    const { toolCalls } = await runEchoAndCapture({
      org,
      server: identityTemplatingServer({ org, name: uniqueName("mcp-sender"), url: mcp.url() }),
      // What the cloud broker stamps at session creation for a WhatsApp
      // conversation — the resolver's highest-precedence source.
      sessionSpec: {
        metadata: {
          [SENDER_KIND_METADATA_KEY]: "whatsapp_phone",
          [SENDER_IDENTITY_METADATA_KEY]: "15550001111",
        },
      },
    });

    for (const call of toolCalls) {
      expect(call.headers[KIND_HEADER], "the channel sender kind wins over the creator").toBe(
        "whatsapp_phone",
      );
      expect(call.headers[VALUE_HEADER], "the channel sender value wins over the creator").toBe(
        "15550001111",
      );
    }
  });

  it("sends no identity headers to a server that never declared the reserved keys", async () => {
    const { org } = await target.provisionTenancy();
    const { toolCalls } = await runEchoAndCapture({
      org,
      // No env declarations, no templated headers: identity injection is
      // opt-in, so nothing identity-shaped may reach this server.
      server: makeHttpMcpServer({ org, name: uniqueName("mcp-plain"), url: mcp.url() }),
    });

    for (const call of toolCalls) {
      expect(call.headers[KIND_HEADER], "no declaration → no kind header").toBeUndefined();
      expect(call.headers[VALUE_HEADER], "no declaration → no value header").toBeUndefined();
    }
  });
});
