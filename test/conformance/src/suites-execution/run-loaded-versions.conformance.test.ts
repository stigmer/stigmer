// Conformance suite for what a run loaded (Class B).
// Domain: agentic / agentexecution — status.loaded_versions.
//
// A skill or plugin an agent lists without a version follows its latest
// push, so the run's agent version does not name the version that ran. The
// run records it: every skill and plugin a turn of the run loaded, each by id
// at the exact version (a skill's version hash, a plugin's digest), named on
// the way out with its current slug. Each attempt of a turn resolves its
// skills again, so a run paused at an approval gate and resumed after a new
// push of one of its skills ran two versions of it, and says both.
//
// Asserted contract:
// - a run parked at its gate lists the agent's skill at its pushed version
//   hash and its plugin at its digest, each by id, with the slugs filled;
// - after a changed push of the skill while the run waits, the approved run
//   completes and lists the skill at both versions in load order, and the
//   plugin once (the union over id and version).
//
// The gate is the approval suite's: a plugin whose one server is the HTTP MCP
// fixture's destructive echo, scripted on the mock LLM (a tool_use turn, then
// a terminating text turn).
import { ApprovalAction, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { DESTRUCTIVE_ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
  submitApprovalPerContract,
} from "../support/runs";
import { uniqueName } from "../support/naming";
import { makeSkillArtifact } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

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
});

afterAll(async () => {
  await target?.teardown();
});

// What a run's record lists, as [id, version, slug] per entry.
function loadedOf(run: Run) {
  const loaded = run.status?.loadedVersions;
  return {
    skills: (loaded?.skills ?? []).map((ref) => [ref.id, ref.version, ref.slug]),
    plugins: (loaded?.plugins ?? []).map((ref) => [ref.id, ref.version, ref.slug]),
  };
}

describe("Run — what a run loaded", () => {
  it("[rpc:RunQueryController.get] a run lists its skill and plugin at the versions it ran, and both versions of a skill pushed while it waited", async () => {
    const { org } = await target.provisionTenancy();
    const skillName = uniqueName("skill");
    const first = await clients.skillCommand.push({ org, artifact: makeSkillArtifact({ name: skillName, body: "# v1" }) });
    fixtures.defer(() => clients.skillCommand.delete({ value: first.metadata!.id }));
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: uniqueName("gated"),
      tools: [DESTRUCTIVE_ECHO_TOOL_NAME],
    });
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-loaded"), skillRefs: [first.metadata!.slug], plugins: [plugin.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicToolUses([{ toolCallId: "call_echo_loaded", toolName: DESTRUCTIVE_ECHO_TOOL_NAME, toolInput: { text: "hello" } }]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-loaded"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const skillId = first.metadata!.id;
    const skillSlug = first.metadata!.slug;
    const v1 = first.status!.versionHash;
    const pluginEntry = [plugin.metadata!.id, plugin.status!.digest, plugin.metadata!.slug];
    expect(v1, "the pushed skill has a version").not.toBe("");

    const gated = await awaitPhase(clients, executionId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    expect(loadedOf(gated), "the parked run names the skill and plugin it loaded, by id at their versions").toEqual({
      skills: [[skillId, v1, skillSlug]],
      plugins: [pluginEntry],
    });

    // A changed push while the run waits: the resumed attempt loads the new head.
    const second = await clients.skillCommand.push({ org, artifact: makeSkillArtifact({ name: skillName, body: "# v2 changed" }) });
    expect(second.metadata!.id, "the push updates the same skill").toBe(skillId);
    const v2 = second.status!.versionHash;
    expect(v2, "the changed push is a new version").not.toBe(v1);

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approve clears the pending gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, `the approved run completes; reached ${RunPhase[final.status?.phase ?? 0]}`).toBe(RunPhase.RUN_COMPLETED);
    expect(loadedOf(final), "both versions of the skill in load order, the plugin once").toEqual({
      skills: [
        [skillId, v1, skillSlug],
        [skillId, v2, skillSlug],
      ],
      plugins: [pluginEntry],
    });
    expect(mock.remaining(), "both scripted turns were consumed").toBe(0);
  });
});
