// Conformance suite for a turn's subagents (Class B): a subagent is a saved
// agent the conversation's agent lists (AgentSpec.subagents), and it runs its
// own definition.
// Domain: agentic / run — what a hand-off gives the subagent, read where the
// model and the client see it: the requests the mock provider captured (each
// request's model, its offered tools, its system prompt and what a tool round
// fed back) and the run's transcript, the subagent's record included.
//
// Delegation is the built-in `task` tool: the parent emits a tool_use naming
// the subagent (`subagent_type`, the listed agent's slug, or `<plugin>:<agent>`
// for a plugin's agent), the runner runs the subagent on the same LLM loop,
// its final text becomes the task tool's result, and the parent takes one
// more turn to answer. The mock is one FIFO for both, so the arrival order is
// parent, subagent, parent, and each captured request is read by its index.
//
// The contract under test:
//   - a saved subagent runs its own model (its run defaults, chosen for this
//     engine), its own plugins' tools, which the parent lacks, and its own
//     tool lists, never the parent's: a tool the parent disallows runs in the
//     subagent; its record carries the delegation's full shape;
//   - a plugin's agent whose file names a model id the engine lists runs on
//     that model, under its plugin's lists for it;
//   - a subagent's declared value reaches its shell alone, and the parent's
//     never reaches the subagent's shell;
//   - the parent's plugin hook decides a subagent's tool call, the row
//     naming the plugin (a delegation never escapes the conversation's hooks);
//   - one level: no subagent's model request offers the `task` tool;
//   - a subagent is not given the conversation's own plugin, nor the
//     platform's own tools (the memory tool stands for them where the target
//     captures memory: a hermetic target provisions no channel that
//     messages, so the channel's send tool is asserted absent beside it);
//   - the parent pinned its subagent at save: an edit to the subagent
//     reaches a new conversation only once the parent is saved again;
//   - on the Cursor engine, a subagent that brings its own tool lists is
//     refused at turn start with one sentence;
//   - a hosted conversation whose subagent uses a local program (a stdio MCP
//     server) is refused at run create, naming the plugin and the server,
//     gated on CapabilityFlags.cloudTargetRefusesLocalPrograms (no target
//     this suite drives composes that lane; target.ts says why).
//
// Deliberately out of scope: the save rules (pinning, one level at save,
// listing once, the delete guard) are the agent suite's, who may list which
// agent is the run gate's, the local stores' retirement of inline sub-agents
// is the store suites' (a conformance target cannot seed a pre-upgrade
// store), and the prompt wording (assertions read names, models and
// markers, never prose).
import { Code, ConnectError } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, SubAgentStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionTarget, Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, FAIL_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { requireRegistryRow } from "../harness/model-registry";
import {
  AGENT_API_VERSION,
  AGENT_KIND,
  type AgentOptions,
  type SubagentOption,
  agentRefOf,
  createSubagents,
  makeAgent,
  makeAgentSpec,
  subagentSlugsOf,
} from "../support/agents";
import { provisionOrgWithFacts } from "../support/memories";
import { uniqueName } from "../support/naming";
import { FIXTURE_SERVER, oneServerPlugin, pluginRefOf, pluginToolName, pushPlugin } from "../support/plugins";
import { RunValueDeclarerKind, runSourcesOf, sourcesFor } from "../support/run-values";
import {
  type AgentExecutionOptions,
  allToolCalls,
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/runs";
import { STIGMER_STDIO_SERVER, stigmerMcpPlugin } from "../support/stigmer-mcp-stdio";
import { createTarget, type TargetProfile } from "../targets";

// The built-in delegation tool the native engine binds when a turn has
// subagents.
const TASK_TOOL_NAME = "task";
// The native engine's shell tool, which Claude's `Bash` names.
const NATIVE_SHELL_TOOL = "execute";
// The platform's own tools a subagent is never given: memory capture, and a
// channel's send tool.
const MEMORY_TOOL_NAME = "remember";
const CHANNEL_SEND_TOOL_NAME = "send_channel_message";

// Two native registry ids whose provider ids differ from them and from each
// other, so the model each request ran on is read off the wire.
const PARENT_MODEL = "claude-sonnet-4.6";
const SUBAGENT_MODEL = "claude-haiku-4.5";

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

const SUBAGENT_ANSWER = "The subagent finished the work it was given.";

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

/** The id the provider receives for a registry model id. */
async function providerIdOf(registryId: string): Promise<string> {
  if (target.modelRegistryDocument === undefined) {
    throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
  }
  const row = requireRegistryRow(await target.modelRegistryDocument(), registryId);
  return row.apiModelId ?? row.id;
}

/** Saves `subagents` first, then the parent listing them; answers both. */
async function parentWith(
  org: string,
  subagents: readonly SubagentOption[],
  parent: Omit<AgentOptions, "org" | "name" | "subagents"> = {},
) {
  const saved = await createSubagents(clients, fixtures, org, subagents);
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("parent"), ...parent, subagents: subagentSlugsOf(saved) }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { agent, subagents: saved };
}

/** The parent's tool_use handing work to `subagentType`. */
function handOff(toolCallId: string, subagentType: string) {
  return anthropicToolUse(toolCallId, TASK_TOOL_NAME, {
    description: "Do the delegated work",
    prompt: "Do the work and report back in one sentence.",
    subagent_type: subagentType,
  });
}

/** Creates the turn, awaits its end and asserts it completed. */
async function completedTurn(options: Omit<AgentExecutionOptions, "name">): Promise<Run> {
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ name: uniqueName("aex-subagent"), autoApproveAll: true, ...options }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  const final = await awaitTerminal(clients, executionId);
  expect(
    RunPhase[final.status?.phase ?? 0],
    `execution ${executionId} completes (error: ${final.status?.error ?? ""})`,
  ).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
  return final;
}

/** The captured scripted request at `index`, parsed. */
function requestAt(index: number) {
  const captured = mock.scriptedRequests()[index];
  expect(captured, `scripted model request ${index}`).toBeDefined();
  return readAnthropicRequest(captured!.body);
}

/** The tool names the scripted request at `index` offered the model. */
function offeredAt(index: number): string[] {
  return (requestAt(index).tools ?? []).map((tool) => tool.name);
}

/** The model the scripted request at `index` ran on. */
function modelAt(index: number): string {
  return requestAt(index).model;
}

/** The scripted request at `index`, as text. */
function wireAt(index: number): string {
  return JSON.stringify(mock.scriptedRequests()[index]?.body);
}


/** The subagent's record on a finished turn, asserted completed. */
function subagentRecordOf(final: Run, name: string) {
  const record = (final.status?.subAgentRuns ?? []).find((run) => run.name === name);
  expect(record, `the subagent ran as ${name} (ran: ${(final.status?.subAgentRuns ?? []).map((run) => run.name).join(", ")})`).toBeDefined();
  expect(SubAgentStatus[record!.status]).toBe(SubAgentStatus[SubAgentStatus.SUB_AGENT_COMPLETED]);
  return record!;
}

describe("Run — a subagent runs its own definition", () => {
  it("a native turn hands off to a saved agent, which runs on its own model with its own plugin's tool the parent lacks and a tool the parent disallows; its record carries the delegation", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: uniqueName("helper-tools"),
      tools: [ECHO_TOOL_NAME],
    });
    const { agent, subagents } = await parentWith(
      org,
      [
        {
          name: uniqueName("researcher"),
          instructions: "You research what you are asked with your tools and report in one sentence.",
          harness: Harness.NATIVE,
          runConfig: { modelName: SUBAGENT_MODEL },
          plugins: [plugin.metadata!.slug],
        },
      ],
      { harness: Harness.NATIVE, runConfig: { modelName: PARENT_MODEL }, disallowedTools: ["Bash"] },
    );
    const name = subagents[0]!.metadata!.slug;

    // Parent hands off; the subagent calls its plugin's echo and the shell
    // the parent disallows, then answers; the parent answers.
    mock.enqueue(handOff("toolu_task_research", name));
    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_sub_echo", toolName: ECHO_TOOL_NAME, toolInput: { text: "from the subagent" } },
        { toolCallId: "call_sub_shell", toolName: NATIVE_SHELL_TOOL, toolInput: { command: "echo shell-ran-in-subagent" } },
      ]),
    );
    mock.enqueue(anthropicText(SUBAGENT_ANSWER));
    mock.enqueue(anthropicText(`The researcher reported: ${SUBAGENT_ANSWER}`));

    const final = await completedTurn({ org, agentRef: agentRefOf(agent) });
    expect(mock.remaining(), "parent, subagent, subagent, parent: every scripted turn was consumed").toBe(0);
    expect(mock.scriptedRequests(), "four model requests").toHaveLength(4);

    // Models: the parent's requests on its model, the subagent's on its own.
    const parentModel = await providerIdOf(PARENT_MODEL);
    const subagentModel = await providerIdOf(SUBAGENT_MODEL);
    expect([0, 1, 2, 3].map(modelAt), "parent, subagent, subagent, parent").toEqual([
      parentModel,
      subagentModel,
      subagentModel,
      parentModel,
    ]);

    // Tools: the parent has neither the subagent's plugin tool nor the shell
    // it disallows; the subagent is offered both, and never `task`.
    const parentOffered = offeredAt(0);
    expect(parentOffered, "the parent is offered the hand-off").toContain(TASK_TOOL_NAME);
    expect(parentOffered, "the subagent's plugin tool is not the parent's").not.toContain(ECHO_TOOL_NAME);
    expect(parentOffered, "the parent's lists remove its shell").not.toContain(NATIVE_SHELL_TOOL);
    const subagentOffered = offeredAt(1);
    expect(subagentOffered, "the subagent is offered its own plugin's tool").toContain(ECHO_TOOL_NAME);
    expect(subagentOffered, "the parent's lists do not reach the subagent").toContain(NATIVE_SHELL_TOOL);
    expect(subagentOffered, "one level: a subagent is never offered the hand-off").not.toContain(TASK_TOOL_NAME);

    const calls = allToolCalls(final);
    const echo = calls.find((call) => call.id === "call_sub_echo");
    expect(ToolCallStatus[echo?.status ?? 0], "the subagent's plugin tool ran").toBe(
      ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED],
    );
    expect(echo!.result).toContain("from the subagent");
    const shell = calls.find((call) => call.id === "call_sub_shell");
    expect(ToolCallStatus[shell?.status ?? 0], "the shell the parent disallows ran in the subagent").toBe(
      ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED],
    );
    expect(shell!.result).toContain("shell-ran-in-subagent");

    // The parent's transcript: a completed `task` call whose result is the
    // subagent's answer; the subagent's record, the shape a console reads.
    const task = (final.status?.messages ?? []).flatMap((m) => m.toolCalls).find((tc) => tc.name === TASK_TOOL_NAME);
    expect(task, "the parent recorded the hand-off").toBeDefined();
    expect(ToolCallStatus[task!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(task!.result, "the hand-off's result is the subagent's answer").toContain(SUBAGENT_ANSWER);
    expect((final.status?.subAgentRuns ?? []).map((run) => run.name), "exactly the listed agent ran").toEqual([name]);
    const record = subagentRecordOf(final, name);
    expect(record.id, "a subagent's run has its own id").not.toBe("");
    expect(record.subject, "the hand-off's description is the subagent's subject").not.toBe("");
    expect(record.startedAt).not.toBe("");
    expect(record.completedAt).not.toBe("");
    expect(record.output, "the subagent's final text is its output").toContain(SUBAGENT_ANSWER);
  });

  it("a turn hands off to a plugin's agent whose file names a model id the engine lists, which runs on that model under its plugin's lists", async () => {
    const { org } = await target.provisionTenancy();
    const pluginName = uniqueName("desk");
    const inScope = pluginToolName(pluginName, FIXTURE_SERVER, ECHO_TOOL_NAME);
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: pluginName,
        server: { url: mcp.url([ECHO_TOOL_NAME, FAIL_TOOL_NAME]) },
        agents: [
          {
            file: "clerk",
            frontmatter: { description: "Looks orders up at the desk.", tools: [inScope], model: SUBAGENT_MODEL },
            body: "You look orders up with the desk's echo tool and report what it answers.",
          },
        ],
      }),
    );
    expect(plugin.status?.agents.map((a) => [a.name, a.model]), "the file's model is kept as written").toEqual([
      ["clerk", SUBAGENT_MODEL],
    ]);
    const name = `${pluginName}:clerk`;
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("parent-desk"),
        plugins: [plugin.metadata!.slug],
        harness: Harness.NATIVE,
        runConfig: { modelName: PARENT_MODEL },
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(handOff("toolu_task_desk", name));
    mock.enqueue(anthropicToolUse("call_desk_echo", ECHO_TOOL_NAME, { text: "ORD-4821" }));
    mock.enqueue(anthropicText("The desk answered ORD-4821."));
    mock.enqueue(anthropicText("The clerk found ORD-4821."));

    const final = await completedTurn({ org, agentRef: agentRefOf(agent) });
    expect(mock.remaining(), "parent, subagent, subagent, parent: every scripted turn was consumed").toBe(0);
    subagentRecordOf(final, name);

    const parentModel = await providerIdOf(PARENT_MODEL);
    const subagentModel = await providerIdOf(SUBAGENT_MODEL);
    expect([0, 1, 2, 3].map(modelAt), "the plugin's agent runs on the model its file names").toEqual([
      parentModel,
      subagentModel,
      subagentModel,
      parentModel,
    ]);
    const offered = offeredAt(1);
    expect(offered, "the tool its list names is offered").toContain(ECHO_TOOL_NAME);
    expect(offered, "a tool its list does not name is not offered").not.toContain(FAIL_TOOL_NAME);
    expect(offered, "one level: a plugin's agent is never offered the hand-off").not.toContain(TASK_TOOL_NAME);
    const echo = allToolCalls(final).find((call) => call.id === "call_desk_echo");
    expect(ToolCallStatus[echo?.status ?? 0]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
  });

  it("[rpc:RunCommandController.create] a subagent's declared value reaches its own shell alone, and the parent's never reaches the subagent's", async () => {
    const { org } = await target.provisionTenancy();
    const { agent, subagents } = await parentWith(
      org,
      [
        {
          name: uniqueName("shell-helper"),
          env: { SUBAGENT_ONLY_KEY: { description: "the subagent's own setting", value: "subagent-held-value" } },
        },
      ],
      { env: { PARENT_ONLY_KEY: { description: "the parent's own setting", value: "parent-held-value" } } },
    );
    const name = subagents[0]!.metadata!.slug;

    // `env | grep`, not `printenv A B`: BSD printenv prints one name.
    const printKeys = { command: "env | grep '_ONLY_KEY=' ; true" };
    mock.enqueue(anthropicToolUse("call_parent_env", NATIVE_SHELL_TOOL, printKeys));
    mock.enqueue(handOff("toolu_task_env", name));
    mock.enqueue(anthropicToolUse("call_subagent_env", NATIVE_SHELL_TOOL, printKeys));
    mock.enqueue(anthropicText(SUBAGENT_ANSWER));
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-subagent-env"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    // Planned at create: the subagent's key is declared by the subagent, by
    // its name in the turn.
    const sources = await runSourcesOf(clients, executionId);
    expect(
      sourcesFor(sources, "SUBAGENT_ONLY_KEY").map((source) => [source.declarer?.kind, source.declarer?.name]),
      "the subagent's key is planned for the subagent alone",
    ).toEqual([[RunValueDeclarerKind.SUBAGENT, name]]);

    const final = await awaitTerminal(clients, executionId);
    expect(
      RunPhase[final.status?.phase ?? 0],
      `execution ${executionId} completes (error: ${final.status?.error ?? ""})`,
    ).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
    expect(mock.remaining(), "every scripted turn was consumed").toBe(0);

    // Requests: 0 parent, 1 parent after its shell, 2 subagent, 3 subagent
    // after its shell, 4 parent after the hand-off.
    const afterParentShell = wireAt(1);
    expect(afterParentShell, "the parent's value reaches the parent's shell").toContain("parent-held-value");
    expect(afterParentShell, "the subagent's value never reaches the parent's shell").not.toContain("subagent-held-value");
    const afterSubagentShell = wireAt(3);
    expect(afterSubagentShell, "the subagent's value reaches its shell").toContain("subagent-held-value");
    expect(afterSubagentShell, "the parent's value never reaches the subagent's shell").not.toContain("parent-held-value");
  });

  it("the parent's plugin hook decides a subagent's tool call, the row naming the plugin", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: uniqueName("guarded"),
        server: { url: mcp.url([ECHO_TOOL_NAME]) },
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard"' }] },
          ],
        },
        files: { "hooks/guard": GUARD },
      }),
    );
    const { agent, subagents } = await parentWith(org, [{ name: uniqueName("cleaner") }], {
      plugins: [plugin.metadata!.slug],
    });
    const name = subagents[0]!.metadata!.slug;

    mock.enqueue(handOff("toolu_task_clean", name));
    mock.enqueue(anthropicToolUse("call_subagent_rm", NATIVE_SHELL_TOOL, { command: "rm -rf build" }));
    mock.enqueue(anthropicText(SUBAGENT_ANSWER));
    mock.enqueue(anthropicText("Done."));

    const final = await completedTurn({ org, agentRef: agentRefOf(agent) });
    const record = subagentRecordOf(final, name);
    const refused = record.messages.flatMap((message) => message.toolCalls).find((call) => call.id === "call_subagent_rm");
    expect(refused, "the subagent's refused delete has a row on its record").toBeDefined();
    expect(ToolCallStatus[refused!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
    expect(refused!.error).toContain("recursive deletes are not allowed");
    expect(refused!.approvalPolicyHook, "the row names the parent's plugin whose hook decided").toBe(plugin.metadata!.slug);
  });
});

describe("Run — what a subagent is not given", () => {
  it("a subagent is not given the conversation's own plugin", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: uniqueName("chat-tools"),
      tools: [ECHO_TOOL_NAME],
    });
    const { agent, subagents } = await parentWith(org, [{ name: uniqueName("helper") }]);
    const name = subagents[0]!.metadata!.slug;

    mock.enqueue(handOff("toolu_task_chat", name));
    mock.enqueue(anthropicText(SUBAGENT_ANSWER));
    mock.enqueue(anthropicText("Done."));

    const final = await completedTurn({ org, agentRef: agentRefOf(agent), sessionSpec: { plugins: [pluginRefOf(plugin)] } });
    subagentRecordOf(final, name);
    expect(offeredAt(0), "the conversation's plugin is the parent's").toContain(ECHO_TOOL_NAME);
    expect(offeredAt(1), "the conversation's plugin is not the subagent's").not.toContain(ECHO_TOOL_NAME);
  });

  describe.skipIf(!collectionTarget.capabilities.firstPartyMemoryCapture)(
    "on a target that captures memory",
    () => {
      it("a subagent is given none of the platform's own tools: the memory tool the parent is offered, and no channel's send tool", async () => {
        const { org } = await provisionOrgWithFacts(clients, fixtures, [], async (slug) => {
          await target.fundTenancy?.(slug);
        });
        const { agent, subagents } = await parentWith(org, [{ name: uniqueName("helper") }]);
        const name = subagents[0]!.metadata!.slug;

        mock.enqueue(handOff("toolu_task_platform", name));
        mock.enqueue(anthropicText(SUBAGENT_ANSWER));
        mock.enqueue(anthropicText("Done."));

        const final = await completedTurn({ org, agentRef: agentRefOf(agent) });
        subagentRecordOf(final, name);
        expect(offeredAt(0), "memory is on: the parent is offered the memory tool").toContain(MEMORY_TOOL_NAME);
        const offered = offeredAt(1);
        expect(offered, "the platform's memory tool is not the subagent's").not.toContain(MEMORY_TOOL_NAME);
        expect(offered, "a subagent cannot post to a channel").not.toContain(CHANNEL_SEND_TOOL_NAME);
      });
    },
  );
});

describe("Run — the parent pinned its subagent at save", () => {
  it("[rpc:AgentCommandController.update] an edit to the subagent reaches a new conversation only once the parent is saved again", async () => {
    const { org } = await target.provisionTenancy();
    const before = "You are the BEFORE-EDIT helper; answer in one sentence.";
    const after = "You are the AFTER-EDIT helper; answer in one sentence.";
    const { agent, subagents } = await parentWith(org, [{ name: uniqueName("helper"), instructions: before }]);
    const sub = subagents[0]!;
    const name = sub.metadata!.slug;

    const subMeta = sub.metadata!;
    await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: { id: subMeta.id, name: subMeta.name, slug: subMeta.slug, org: subMeta.org },
      spec: makeAgentSpec({ instructions: after }),
    });

    /** A new conversation on the parent that hands off once; answers the subagent's request as text. */
    async function subagentRequestOfNewConversation(): Promise<string> {
      mock.reset();
      mock.enqueue(handOff("toolu_task_pinned", name));
      mock.enqueue(anthropicText(SUBAGENT_ANSWER));
      mock.enqueue(anthropicText("Done."));
      const final = await completedTurn({ org, agentRef: agentRefOf(agent) });
      subagentRecordOf(final, name);
      return wireAt(1);
    }

    const unsaved = await subagentRequestOfNewConversation();
    expect(unsaved, "the parent still runs the version it pinned").toContain("BEFORE-EDIT");
    expect(unsaved, "the edit has not reached the parent").not.toContain("AFTER-EDIT");

    const parentMeta = agent.metadata!;
    const resaved = await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: { id: parentMeta.id, name: parentMeta.name, slug: parentMeta.slug, org: parentMeta.org },
      spec: makeAgentSpec({ subagents: [name] }),
    });
    expect(resaved.spec?.subagents[0]?.version, "saving the parent again pins the subagent's current version").not.toBe(
      agent.spec?.subagents[0]?.version,
    );

    const saved = await subagentRequestOfNewConversation();
    expect(saved, "the parent saved again runs the edited subagent").toContain("AFTER-EDIT");
    expect(saved).not.toContain("BEFORE-EDIT");
  });
});

describe("Run — the Cursor engine and a subagent's own configuration", () => {
  it("a Cursor turn whose subagent brings its own tool lists is refused at turn start with one sentence", async () => {
    const { org } = await target.provisionTenancy();
    const { agent, subagents } = await parentWith(org, [{ name: uniqueName("listed"), disallowedTools: ["Bash"] }]);
    const name = subagents[0]!.metadata!.slug;

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-cursor-subagent"),
        agentRef: agentRefOf(agent),
        sessionSpec: { harness: Harness.CURSOR },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(RunPhase[final.status?.phase ?? 0], `execution ${executionId} is refused`).toBe(RunPhase[RunPhase.RUN_FAILED]);
    expect(final.status?.error ?? "").toContain(
      `Subagent '${name}' brings its own plugins, hooks or tool lists, which the Cursor engine cannot keep to it: ` +
        "it cannot tell a subagent's tool call from the main agent's. " +
        `Run this agent on the native engine, or remove them from '${name}'.`,
    );
    expect(mock.consumed(), "the refusal comes before any model request").toBe(0);
  });
});

describe("Run — a subagent's local program runs where a person's own runner runs", () => {
  describe.skipIf(!collectionTarget.capabilities.cloudTargetRefusesLocalPrograms)(
    "on a target whose cloud conversations run in a cloud-mode sandbox",
    () => {
      it("[rpc:RunCommandController.create] a cloud-target conversation whose subagent lists a plugin with a local program is refused at run create, naming the plugin and the server", async () => {
        const { org } = await target.provisionTenancy();
        const plugin: Plugin = await pushPlugin(clients, fixtures, org, stigmerMcpPlugin(uniqueName("hosted-program")));
        const { agent } = await parentWith(org, [{ name: uniqueName("local-helper"), plugins: [plugin.metadata!.slug] }]);

        let refused: ConnectError | undefined;
        try {
          const created = await clients.agentExecutionCommand.create(
            makeAgentExecution({
              org,
              name: uniqueName("aex-hosted-subagent"),
              agentRef: agentRefOf(agent),
              sessionSpec: { executionTarget: ExecutionTarget.CLOUD },
            }),
          );
          fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
        } catch (error) {
          refused = ConnectError.from(error);
        }
        expect(refused?.code, "a hosted conversation cannot start a subagent's local program").toBe(Code.FailedPrecondition);
        expect(refused?.rawMessage).toContain(
          `plugin '${plugin.metadata!.name}' runs its MCP server '${STIGMER_STDIO_SERVER}' as a local program`,
        );
      });
    },
  );
});
