/**
 * Pins the tool surface the runtime hands every harness
 * (`resolveMcpServersAndPolicies`, phases 4 to 4b), driven directly over a
 * mocked control plane:
 *  - each synthesized attachment the turn injects (channel messaging,
 *    conversation participation, memory capture) is recorded as a platform
 *    server, outside every tool list, and marks no tool destructive;
 *  - the agent's tool scope is resolved from its two lists, under its slug;
 *  - the built-in assistant (no agent) is unrestricted.
 * The fetch-and-provision phases around it are pinned end to end by the
 * hermetic goldens.
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema, AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema, RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import { resolveMcpServersAndPolicies, type ResolutionDeps } from "../turn-context.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { CHANNEL_ATTACHMENT_SLUG } from "../../shared/channel-attachment.js";
import { CHANNEL_ID_LABEL, CONVERSATION_ATTACHMENT_SLUG } from "../../shared/conversation-attachment.js";
import { MEMORY_ATTACHMENT_SLUG } from "../../shared/memory-attachment.js";
import type { ResolvedBlueprint, RunAgent } from "../../shared/blueprint-resolver.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

const EXECUTION_ID = "aex_mcp_1";

function deps(options: { readonly channels: boolean }): ResolutionDeps {
  const status = create(AgentExecutionStatusSchema, {});
  return {
    input: { executionId: EXECUTION_ID, threadId: "", turnSeq: 0 },
    client: mockStigmerClient({
      listMessagingChannels: vi
        .fn()
        .mockResolvedValue(options.channels ? [{ channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel] : []),
    }),
    config: testConfig({ mcpBridgeEndpoint: "https://mcp.example.com" }),
    status,
    transcript: new TranscriptBuilder(EXECUTION_ID, status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => undefined,
    enterPhase: () => undefined,
    reportProgress: async () => undefined,
  };
}

function args(options: { readonly agentLists?: { tools: string[]; disallowedTools: string[] }; readonly attachments: boolean }) {
  const session = create(SessionSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: "ses_1",
      org: "org",
      labels: options.attachments ? { [CHANNEL_ID_LABEL]: "agch_1" } : {},
    }),
    spec: create(SessionSpecSchema, {}),
  });
  const agent: RunAgent | undefined = options.agentLists
    ? { id: "agt_1", versionHash: "", spec: create(AgentSpecSchema, options.agentLists) }
    : undefined;
  const blueprint: ResolvedBlueprint = {
    agent,
    session,
    sessionSpec: session.spec!,
    instructions: "",
    subAgents: [],
    mergedMcpServerUsages: [],
    mergedSkillRefs: [],
    cloudRepos: [],
  };
  const execution = create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: EXECUTION_ID }),
    spec: create(AgentExecutionSpecSchema, {
      target: { case: "sessionId", value: "ses_1" },
    }),
    status: create(AgentExecutionStatusSchema, {
      recalledMemories: options.attachments ? create(RecalledMemoriesSchema, { enabled: true }) : undefined,
    }),
  });
  return { execution, session, sessionId: "ses_1", blueprint, environment: { envVars: {}, secretKeys: new Set<string>() } };
}

describe("resolveMcpServersAndPolicies — platform servers and the agent's scope", () => {
  it("records every injected attachment as a platform server that marks nothing destructive", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: true }), args({ attachments: true }));

    expect([...mcp.platformServerSlugs].sort()).toEqual(
      [CHANNEL_ATTACHMENT_SLUG, CONVERSATION_ATTACHMENT_SLUG, MEMORY_ATTACHMENT_SLUG].sort(),
    );
    expect(mcp.servers.map((s) => s.slug).sort()).toEqual([...mcp.platformServerSlugs].sort());
    expect(mcp.mcpDefault.destructive.size).toBe(0);
  });

  it("injects no attachment, and records no platform server, when the turn calls for none", async () => {
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), args({ attachments: false }));
    expect(mcp.platformServerSlugs.size).toBe(0);
    expect(mcp.servers).toEqual([]);
  });

  it("resolves the agent's two lists into its scope, under its slug", async () => {
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, agentLists: { tools: ["Read"], disallowedTools: ["Bash"] } }),
    );
    expect(mcp.toolScope.restricted).toBe(true);
    expect(mcp.toolScope.allowsClaudeTool("Read")).toBe(true);
    expect(mcp.toolScope.allowsClaudeTool("Write")).toBe(false);
    expect(mcp.toolScope.owner).toBe("The agent");
  });

  it("leaves the built-in assistant unrestricted", async () => {
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), args({ attachments: false }));
    expect(mcp.toolScope.restricted).toBe(false);
  });
});
