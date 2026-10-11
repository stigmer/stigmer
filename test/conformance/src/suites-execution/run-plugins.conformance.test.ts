// Conformance suite for a turn's plugins (Class B): a turn runs its plugins
// whole.
// Domain: agentic / run — what a plugin listed by an agent (AgentSpec.plugins)
// or by a conversation (SessionSpec.plugins) gives a turn, read where the
// model and the client see it: the requests the mock provider captured and
// the run's transcript.
//
// The contract under test:
//   - a plugin is one thing: listing it gives the turn every part of it,
//     each named under the plugin. Its skills reach the model as
//     `<plugin>:<skill>`, its agents as the sub-agents `<plugin>:<agent>`,
//     its MCP server's tools by their own names (a call records the server
//     as `plugin_<plugin>_<server>`), and its hooks decide its tool calls,
//     the row naming the plugin;
//   - the same holds for an Assistant chat (no agent) that lists the plugin
//     on its conversation: the built-in assistant gets the plugin's skills,
//     agents, tools and hooks exactly as an agent does;
//   - a plugin's local program (a stdio MCP server) runs only where a
//     person's own runner runs it: a conversation on the cloud target served
//     by a cloud-mode sandbox is refused at run create naming the plugin and
//     the server, while a local-target conversation keeps it. The refusal is
//     gated on CapabilityFlags.cloudTargetRefusesLocalPrograms (no target
//     this suite drives composes that lane; target.ts says why).
//
// Deliberately out of scope: the session-create refusal for a local program
// (the session suite's), tool lists scoping a plugin's tools (run-tool-lists),
// the approval default over a plugin tool's destructive mark (run-approval),
// the values a plugin's server reads (vault-resolution), the wording of the
// skill and sub-agent prompts (assertions read names, never prose), and the
// Cursor harness, which this suite does not drive.
import { Code, ConnectError } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { oneServerPlugin, pluginRefOf, pushPlugin, toolServerSegment } from "../support/plugins";
import {
  allToolCalls,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/runs";
import { STIGMER_STDIO_SERVER, stigmerMcpPlugin } from "../support/stigmer-mcp-stdio";
import { createTarget, type TargetProfile } from "../targets";

// The plugin's parts, by their names inside it.
const SKILL = "triage";
const AGENT = "scout";

// A PreToolUse hook that refuses a recursive delete and lets everything else
// through, in Claude Code's answers (exit 2 with the reason on stderr).
const GUARD = [
  "#!/usr/bin/env bash",
  "input=$(cat)",
  'case "$input" in',
  "  *'\"command\":\"rm -rf'*) echo 'recursive deletes are not allowed' >&2; exit 2 ;;",
  "esac",
  "exit 0",
  "",
].join("\n");

const collectionTarget = createTarget();

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
  // script; wait, bounded, for every scripted turn to be claimed.
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

// A plugin carrying one of every part: a skill, an agent, a hook and an MCP
// server on the fixture's echo surface.
async function wholePlugin(org: string): Promise<Plugin> {
  return pushPlugin(
    clients,
    fixtures,
    org,
    oneServerPlugin({
      name: uniqueName("whole"),
      server: { url: mcp.url([ECHO_TOOL_NAME]) },
      skills: [{ name: SKILL, description: "Triage an incoming bug report", body: "# Triage\nSort it by severity." }],
      agents: [
        {
          file: AGENT,
          frontmatter: { description: "Scouts the codebase for the code a question is about" },
          body: "You scout the codebase and report the files that matter, with one line each.",
        },
      ],
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard"' }] },
        ],
      },
      files: { "hooks/guard": GUARD },
    }),
  );
}

// Scripts the turn: a shell delete the plugin's hook refuses, then the
// plugin's echo tool, then an answer.
function scriptTurn(): void {
  mock.enqueue(anthropicToolUse("call_plugin_rm", "execute", { command: "rm -rf build" }));
  mock.enqueue(anthropicToolUse("call_plugin_echo", ECHO_TOOL_NAME, { text: "ping" }));
  mock.enqueue(anthropicText("Done."));
}

// What one finished turn shows of the plugin: the model's first request
// names its skill, its agent and its tool, the hook refused the delete
// naming the plugin, and the echo ran on the plugin's server.
function expectWholePlugin(plugin: Plugin, final: Run): void {
  const id = final.metadata?.id ?? "";
  const name = plugin.metadata!.name;
  expect(final.status?.phase, `run ${id}: ${final.status?.error || "(no error)"}`).toBe(RunPhase.RUN_COMPLETED);

  const first = mock.scriptedRequests()[0];
  expect(first, `run ${id}: the turn reached the model`).toBeDefined();
  const request = readAnthropicRequest(first!.body);
  const wire = JSON.stringify(request);
  expect(wire, "the plugin's skill reaches the model named under the plugin").toContain(`${name}:${SKILL}`);
  expect(wire, "the plugin's agent is a sub-agent named under the plugin").toContain(`${name}:${AGENT}`);
  expect((request.tools ?? []).map((tool) => tool.name), "the plugin server's tool is offered").toContain(
    ECHO_TOOL_NAME,
  );

  const calls = allToolCalls(final);
  const refused = calls.find((call) => call.id === "call_plugin_rm");
  expect(refused, `run ${id}: the refused delete has a row`).toBeDefined();
  expect(ToolCallStatus[refused!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
  expect(refused!.error).toContain("recursive deletes are not allowed");
  expect(refused!.approvalPolicyHook, "the row names the plugin whose hook decided").toBe(plugin.metadata!.slug);

  const echo = calls.find((call) => call.id === "call_plugin_echo");
  expect(ToolCallStatus[echo?.status ?? ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]).toBe(
    ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED],
  );
  expect(echo?.mcpServerSlug, "the call names the plugin's server").toBe(toolServerSegment(name));
}

describe("Run — a turn runs its plugins whole", () => {
  it("an agent that lists a plugin gets its skill, its agent, its tool and its hook, each named under the plugin", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await wholePlugin(org);
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-whole"), plugins: [plugin.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    scriptTurn();
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-whole"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    expectWholePlugin(plugin, await awaitTerminal(clients, executionId));
  });

  it("an Assistant chat that lists a plugin on its conversation gets the same parts as an agent does", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await wholePlugin(org);

    scriptTurn();
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-assistant-whole"),
        sessionSpec: { plugins: [pluginRefOf(plugin)] },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    expectWholePlugin(plugin, await awaitTerminal(clients, executionId));
  });
});

describe("Run — a plugin's local program runs where a person's own runner runs", () => {
  it("[rpc:RunCommandController.create] a local-target conversation listing a plugin with a local program is created and runs", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(clients, fixtures, org, stigmerMcpPlugin(uniqueName("local-program")));

    mock.enqueue(anthropicText("Nothing to look up."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-local-program"),
        sessionSpec: { executionTarget: ExecutionTarget.LOCAL, plugins: [pluginRefOf(plugin)] },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.error ?? "", `run ${executionId}: a local target keeps its local programs`).not.toContain(
      "as a local program",
    );
  });

  describe.skipIf(!collectionTarget.capabilities.cloudTargetRefusesLocalPrograms)(
    "on a target whose cloud conversations run in a cloud-mode sandbox",
    () => {
      it("[rpc:RunCommandController.create] a cloud-target conversation listing a plugin with a local program is refused at run create, naming the plugin and the server", async () => {
        const { org } = await target.provisionTenancy();
        const plugin = await pushPlugin(clients, fixtures, org, stigmerMcpPlugin(uniqueName("hosted-program")));

        let refused: ConnectError | undefined;
        try {
          const created = await clients.agentExecutionCommand.create(
            makeAgentExecution({
              org,
              name: uniqueName("aex-hosted-program"),
              sessionSpec: { executionTarget: ExecutionTarget.CLOUD, plugins: [pluginRefOf(plugin)] },
            }),
          );
          fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
        } catch (error) {
          refused = ConnectError.from(error);
        }
        expect(refused?.code, "a hosted conversation cannot start a local program").toBe(Code.FailedPrecondition);
        expect(refused?.rawMessage).toContain(
          `plugin '${plugin.metadata!.name}' runs its MCP server '${STIGMER_STDIO_SERVER}' as a local program`,
        );
      });
    },
  );
});
