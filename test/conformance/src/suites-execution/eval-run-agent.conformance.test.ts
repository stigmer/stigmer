// Conformance suite for running an eval run about an agent: an EvalRun of
// test cases on an agent taken from create to its end on a real engine,
// every try answered by the scripted model. eval-run.conformance.test.ts
// runs eval runs about a plugin.
// Domain: agentic / evalrun — one run of test cases on the agent itself:
// each try a conversation on the agent pinned to the version the eval run
// stamped, with every plugin a try loads pinned to the digest it stamped,
// graded by its case's graders.
//
// The contract under test:
//   - an agent comparing a plugin it and its subagent both attach: the
//     with try loads it (its run's loaded_versions names it), the without
//     try's run excludes it and loads it nowhere, the subagent's copy
//     included, while both tries' conversations list it; an agent comparing
//     a plugin it does not attach runs that plugin's case in both arms, the
//     without try reading the case all the same;
//   - an agent with instructions and two plugins, each with one case, ends
//     completed with one graded try per plugin: every try's model request
//     carries the agent's instructions, each plugin's case runs with its own
//     plugin's skill offered and read, and each try's conversation names the
//     agent at the stamped hash and every attached plugin at its stamped
//     digest;
//   - a plugin pushed and the agent saved while the eval run runs leave the
//     remaining tries on the stamped versions: the later try's conversation,
//     its run and its model request name the stamped agent version and
//     plugin digest, never the new ones;
//   - another attached plugin's MCP server, which the case cannot mock, is
//     never connected in a try (the harness's MCP fixture records no request
//     while an ordinary turn on the same agent connects it), and the try's
//     run lists it as disallowed; so is a server the agent writes itself,
//     when the eval run allows no real servers (the default);
//   - two eval runs of two versions of one agent both complete, each recording
//     its own agent_version_hash, each try running its own version's
//     instructions;
//   - delete of the eval run and of its agent are refused while it runs,
//     naming cancel; cancel ends it partial `cancelled` and no later try
//     starts;
//   - a spending limit reached stops new tries: the eval run ends partial
//     `cost_ceiling`, the other plugin's try never starting;
//   - a try composes no standing context and no memory, although its
//     organization has both and an ordinary turn on the same agent gets them;
//   - the tries are left out of the session list and of the agent's own
//     session listByAgent, where an ordinary turn on the agent is listed, and
//     listByAgent of the agent's eval runs answers each without its tries;
//   - an Eval pushed with a mock of a server the agent writes itself runs
//     on that agent, which attaches no plugin: the try calls the tool and
//     the fixed mock answers under the server's own name (the real server
//     is never connected), every grader passes on that answer, the case is
//     listed under the Eval with the server it mocked, and the eval run
//     ends naming the Eval at the digest of the folder pushed;
//   - a try with no targets runs the agent's own model and thinking setting
//     (read back from the run's status.run_config and the model the provider
//     received), its target labelled with the agent's model, while a named
//     target runs the named model.
//
// Every describe runs only where the runner creates the try's run as the
// eval run's caller (CapabilityFlags.runnerActsAsRunCreator), as the plugin
// subject's execution suite gates it.
//
// Out of scope here, with the reason: the grading itself (votes, timeouts,
// scaffolds, mocks, a try kept from the plugin's evals/), which every eval
// run shares and eval-run.conformance.test.ts pins.
//
// Every eval run here runs one try at a time (concurrency 1), so the scripted
// turns are consumed in the matrix's order: the agent's plugins in order,
// then each plugin's cases. Each try's session has the case's name as its
// subject, so no title call is made.
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  OrganizationPreferencesSchema,
  OrganizationSpecSchema,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { requireRegistryRow } from "../harness/model-registry";
import {
  EVAL_RUN_LABEL,
  SPENDING_SHARE_REASON,
  type AgentEvalRunOptions,
  type AgentWithOptions,
  type EvalCaseFixture,
  awaitEvalRunEnd,
  cancelAndDeleteEvalRun,
  createAgentWith,
  evalRunActiveDeleteMessage,
  evalRunActiveOnSubjectDeleteMessage,
  installPlugin,
  lastMessageGrader,
  makeEvalRun,
  skillFiredGrader,
  skillPluginWithEvals,
  triesOf,
} from "../support/eval-runs";
import { agentRefOf, makeAgent } from "../support/agents";
import { provisionOrgWithFacts } from "../support/memories";
import { digestOf, evalFolderArchive } from "../support/evals";
import { uniqueName } from "../support/naming";
import { pluginArchive, toolServerSegment } from "../support/plugins";
import {
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

// Read once at collection time to gate the engine-backed arms (constructing
// a target is side-effect-free; setup() is what boots processes).
const runnerServesTries = createTarget().capabilities.runnerActsAsRunCreator;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
  tenancy = await target.provisionTenancy();
});

afterEach(async () => {
  // A try that started after its arm's assertions would take the next arm's
  // script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 30_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

// The final message every case's regex grader passes on.
const DONE = "DONE: one line per change.";

// The agent's instructions, distinct per version so a request names the one it ran.
const INSTRUCTIONS = "AGENT-V1-MARKER: answer as the release desk, one line per change.";
const SAVED_LATER = "AGENT-V2-MARKER: answer as the support desk, politely.";

// Two Stigmer registry ids whose provider ids differ from them and from each
// other, so the model a try ran is read off the wire.
const AGENT_MODEL = "claude-haiku-4.5";
const TARGET_MODEL = "claude-sonnet-4.6";

interface Installed {
  readonly plugin: Plugin;
  readonly name: string;
  readonly skill: string;
}

function scoredCase(name: string, skill: string): EvalCaseFixture {
  return {
    name,
    prompt: "Write release notes for: renamed getUser to fetchUser.",
    frontmatter: { allowed_tools: ["Read", "Skill"] },
    graders: [skillFiredGrader(skill), lastMessageGrader("says-done", "^DONE")],
  };
}

// A case graded on its last message alone; `tools` is its allowed_tools
// (none: the try is offered no skill, the format's read-only default).
function doneCase(name: string, tools?: readonly string[]): EvalCaseFixture {
  return {
    name,
    prompt: "Write release notes for: renamed getUser to fetchUser.",
    ...(tools === undefined ? {} : { frontmatter: { allowed_tools: [...tools] } }),
    graders: [lastMessageGrader("says-done", "^DONE")],
  };
}

// The archive of a one-skill plugin named `name`, with one case (built
// from its skill's name) and any extra files.
function skillPlugin(name: string, cases: (skill: string) => readonly EvalCaseFixture[], files?: Readonly<Record<string, string>>) {
  const skill = `${name}-notes`;
  return {
    skill,
    fixture: skillPluginWithEvals(name, { skill, cases: cases(skill), ...(files === undefined ? {} : { files }) }),
  };
}

// A one-skill plugin carrying `cases`, installed in `org`.
async function installed(
  prefix: string,
  cases: (skill: string) => readonly EvalCaseFixture[],
  org = tenancy.org,
): Promise<Installed> {
  const name = uniqueName(prefix);
  const { skill, fixture } = skillPlugin(name, cases);
  const plugin = await installPlugin(clients, fixtures, org, fixture);
  return { plugin, name, skill };
}

// An agent in `org` listing `plugins`, deleted after its eval runs.
async function agentWith(
  plugins: readonly Plugin[],
  opts: Partial<AgentWithOptions> & { org?: string } = {},
): Promise<Agent> {
  const { org, ...rest } = opts;
  return createAgentWith(clients, fixtures, org ?? tenancy.org, plugins, {
    name: uniqueName("evr-agent"),
    instructions: INSTRUCTIONS,
    ...rest,
  });
}

// Creates an eval run of `agent` and defers its cleanup, which runs before the agent's delete.
async function startEval(agent: Agent, opts: Partial<AgentEvalRunOptions> = {}): Promise<EvalRun> {
  const created = await clients.evalRunCommand.create(
    makeEvalRun({ org: agent.metadata!.org, agentId: agent.metadata!.id, ...opts }),
  );
  fixtures.defer(() => cancelAndDeleteEvalRun(clients, created.metadata!.id));
  return created;
}

/** The model reading `installation`'s skill where a turn mounts it: inside the plugin's tree, by digest. */
function skillRead(installation: Installed, id: string) {
  const status = installation.plugin.status!;
  const path = status.skills.find((skill) => skill.name === installation.skill)!.path;
  return anthropicToolUse(id, "read_file", { file_path: `.stigmer/plugins/${status.digest}/${path}/SKILL.md` });
}

// The system prompt as the model received it on one request.
function systemTextOf(body: unknown): string {
  const system = readAnthropicRequest(body).system;
  if (system === undefined) return "";
  return typeof system === "string" ? system : system.map((block) => block.text).join("\n");
}

// The skill heading a turn offers a plugin's skill under.
function offeredSkill(installation: Installed): string {
  return `### ${installation.plugin.metadata!.name}:${installation.skill}`;
}

function describeTries(evalRun: EvalRun): string {
  return triesOf(evalRun)
    .map(
      (t) =>
        `${t.pluginSlug}/${t.caseName}/${t.attempt.index}: ${EvalRunTryState[t.attempt.state]} ` +
        `score=${t.attempt.score} reason="${t.attempt.notGradedReason}" error="${t.attempt.error}"`,
    )
    .join("; ");
}

async function runOf(runId: string): Promise<Run> {
  return clients.agentExecutionQuery.get({ value: runId });
}

async function providerIdOf(registryId: string): Promise<string> {
  if (target.modelRegistryDocument === undefined) {
    throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
  }
  const row = requireRegistryRow(await target.modelRegistryDocument(), registryId);
  return row.apiModelId ?? row.id;
}

// The references a try's conversation pins, as [slug, version].
function pinnedPlugins(session: { spec?: { plugins: ReadonlyArray<{ slug: string; version: string }> } }) {
  return (session.spec?.plugins ?? []).map((ref) => [ref.slug, ref.version]);
}

// Waits, bounded, until the model has taken `count` scripted turns.
async function untilConsumed(count: number, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (mock.consumed() < count && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  expect(mock.consumed(), what).toBe(count);
}

describe.skipIf(!runnerServesTries)("EvalRun about an agent — each plugin's cases on the agent", () => {
  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] two plugins, one case each: every try carries the agent's instructions, reads its own plugin's skill, and pins the stamped agent version and plugin digests", async () => {
    const notes = await installed("evr-notes", (skill) => [scoredCase("notes-case", skill)]);
    const style = await installed("evr-style", (skill) => [scoredCase("style-case", skill)]);
    const agent = await agentWith([notes.plugin, style.plugin]);
    // Plugin order, then case order: the notes case, then the style case.
    mock.enqueue(skillRead(notes, "call_skill_notes"));
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(skillRead(style, "call_skill_style"));
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent);
    expect(created.status?.phase, "create answers before any try starts").toBe(EvalRunPhase.pending);
    expect(created.status?.triesTotal).toBe(2);

    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    expect(ended.status?.triesFinished).toBe(2);
    expect(ended.status?.agentVersionHash).toBe(agent.status!.versionHash);
    expect(mock.consumed(), "exactly the scripted turns").toBe(4);

    // One block per plugin, one case each, one arm, a passing score.
    const blocks = ended.status!.plugins;
    expect(blocks.map((b) => [b.pluginSlug, b.pluginDigest, b.notRunReason])).toEqual([
      [notes.plugin.metadata!.slug, notes.plugin.status!.digest, ""],
      [style.plugin.metadata!.slug, style.plugin.status!.digest, ""],
    ]);
    for (const block of blocks) {
      expect(block.cases).toHaveLength(1);
      const [result] = block.cases[0]!.targets;
      expect(result?.withPlugin?.score, `${block.pluginSlug}: ${describeTries(ended)}`).toBe(1);
      expect(result?.withoutPlugin, "an eval run comparing nothing has one arm").toBeUndefined();
      expect(result?.delta).toBeUndefined();
      expect(block.aggregates?.casesPassed).toBe(1);
    }
    expect(ended.status?.aggregates?.casesPassed).toBe(2);
    expect(ended.status?.aggregates?.casesTotal).toBe(2);

    // Every request carries the agent's instructions; each case offers its own plugin's skill.
    const requests = mock.scriptedRequests();
    expect(requests).toHaveLength(4);
    for (const [index, request] of requests.entries()) {
      expect(systemTextOf(request.body), `request ${index} carries the agent's instructions`).toContain(INSTRUCTIONS);
    }
    expect(systemTextOf(requests[0]!.body), "the notes case offers the notes skill").toContain(offeredSkill(notes));
    expect(systemTextOf(requests[2]!.body), "the style case offers the style skill").toContain(offeredSkill(style));

    const tries = triesOf(ended);
    expect(tries.map((t) => [t.pluginSlug, t.caseName])).toEqual([
      [notes.plugin.metadata!.slug, "notes-case"],
      [style.plugin.metadata!.slug, "style-case"],
    ]);
    for (const { attempt, caseName } of tries) {
      expect(attempt.state, caseName).toBe(EvalRunTryState.graded);
      const run = await runOf(attempt.runId);
      expect(run.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(run.metadata?.labels[EVAL_RUN_LABEL]).toBe(created.metadata!.id);
      expect(run.status?.agentId).toBe(agent.metadata!.id);
      expect(run.status?.agentVersionHash).toBe(agent.status!.versionHash);
      const session = await clients.sessionQuery.get({ value: attempt.sessionId });
      expect(session.metadata?.labels[EVAL_RUN_LABEL]).toBe(created.metadata!.id);
      expect(session.spec?.subject).toBe(caseName);
      expect(session.spec?.agentRef?.slug).toBe(agent.metadata!.slug);
      expect(session.spec?.agentRef?.version, "the try pins the stamped agent version").toBe(agent.status!.versionHash);
      expect(pinnedPlugins(session), "the try lists every attached plugin at its stamped digest").toEqual([
        [notes.plugin.metadata!.slug, notes.plugin.status!.digest],
        [style.plugin.metadata!.slug, style.plugin.status!.digest],
      ]);
    }
  }, 360_000);

  it("[rpc:EvalRunQueryController.get] a plugin pushed and the agent saved while the eval run runs leave the remaining tries on the stamped versions", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const styleName = uniqueName("evr-style");
    // The style case grants Skill, so its try is offered the plugin's skills
    // and its request names the mounted plugin tree, by digest.
    const v1Style = skillPlugin(styleName, () => [doneCase("style-case", ["Read", "Skill"])]);
    const style: Installed = {
      plugin: await installPlugin(clients, fixtures, tenancy.org, v1Style.fixture),
      name: styleName,
      skill: v1Style.skill,
    };
    const agentName = uniqueName("evr-agent");
    const agent = await agentWith([notes.plugin, style.plugin], { name: agentName });
    // The notes try is held until both changes are saved; the style try follows.
    mock.enqueue(anthropicText(DONE), { delayMs: 120_000 });
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent);
    await untilConsumed(1, "the notes try reached the model");

    const pushed = await clients.pluginCommand.push({
      org: tenancy.org,
      artifact: pluginArchive(skillPlugin(styleName, () => [doneCase("style-case", ["Read", "Skill"])], { "CHANGELOG.md": "v2\n" }).fixture),
    });
    expect(pushed.metadata?.id, "the push updates the attached plugin").toBe(style.plugin.metadata!.id);
    expect(pushed.status?.digest, "the push is a new version").not.toBe(style.plugin.status!.digest);
    const saved = await clients.agentCommand.apply(
      makeAgent({
        org: tenancy.org,
        name: agentName,
        instructions: SAVED_LATER,
        plugins: [notes.plugin.metadata!.slug, style.plugin.metadata!.slug],
      }),
    );
    expect(saved.status?.versionHash, "the save is a new version").not.toBe(agent.status!.versionHash);
    mock.releaseHolds();

    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    expect(ended.status?.agentVersionHash).toBe(agent.status!.versionHash);
    expect(ended.status?.plugins.map((b) => b.pluginDigest)).toEqual([
      notes.plugin.status!.digest,
      style.plugin.status!.digest,
    ]);
    const later = triesOf(ended).find((t) => t.caseName === "style-case");
    expect(later, describeTries(ended)).toBeDefined();
    const session = await clients.sessionQuery.get({ value: later!.attempt.sessionId });
    expect(session.spec?.agentRef?.version).toBe(agent.status!.versionHash);
    expect(session.status?.agentVersionHash).toBe(agent.status!.versionHash);
    expect(pinnedPlugins(session)).toEqual([
      [notes.plugin.metadata!.slug, notes.plugin.status!.digest],
      [style.plugin.metadata!.slug, style.plugin.status!.digest],
    ]);
    const run = await runOf(later!.attempt.runId);
    expect(run.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(run.status?.agentVersionHash, "the later try ran the stamped agent version").toBe(agent.status!.versionHash);

    // The later try's request: the stamped instructions and the stamped plugin tree.
    const requests = mock.scriptedRequests();
    expect(requests).toHaveLength(2);
    const system = systemTextOf(requests[1]!.body);
    expect(system).toContain(INSTRUCTIONS);
    expect(system).not.toContain(SAVED_LATER);
    expect(system).toContain(`.stigmer/plugins/${style.plugin.status!.digest}/`);
    expect(system).not.toContain(pushed.status!.digest);
  }, 360_000);

  it("[rpc:EvalRunQueryController.get] another attached plugin's MCP server, which no case can mock, is never connected in a try, while an ordinary turn on the agent connects it", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const toolsName = uniqueName("evr-mcp");
    const tools = await pushFixturePlugin(clients, mcp, fixtures, { org: tenancy.org, name: toolsName, tools: [ECHO_TOOL_NAME] });
    const agent = await agentWith([notes.plugin, tools]);
    mcp.resetCaptured();
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent, { cases: [{ org: tenancy.org, slug: notes.plugin.metadata!.slug }] });
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    const [only] = triesOf(ended);
    expect(only?.attempt.state, describeTries(ended)).toBe(EvalRunTryState.graded);
    expect(
      mcp.capturedRequests().map((r) => r.method),
      "the try connected the other plugin's server",
    ).toEqual([]);
    const run = await runOf(only!.attempt.runId);
    expect(run.spec?.disallowedTools).toContain(`mcp__${toolServerSegment(toolsName)}`);
    const session = await clients.sessionQuery.get({ value: only!.attempt.sessionId });
    expect(pinnedPlugins(session), "the try still attaches the plugin, pinned").toContainEqual([
      tools.metadata!.slug,
      tools.status!.digest,
    ]);

    // The control: an ordinary turn on the same agent connects the server.
    mock.enqueue(anthropicText("Hello."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org: tenancy.org, name: uniqueName("ordinary"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: ordinary.metadata!.id }));
    const turn = await awaitTerminal(clients, ordinary.metadata!.id);
    expect(turn.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(mcp.capturedRequests().map((r) => r.method), "an ordinary turn connects the server").toContain("initialize");
  }, 360_000);

  it("[rpc:EvalRunQueryController.get] a server the agent writes itself is never connected in a try by default, while an ordinary turn on the agent connects it", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const server = "evr-own";
    const agent = await agentWith([notes.plugin], { mcpServers: [{ name: server, url: mcp.url([ECHO_TOOL_NAME]) }] });
    mcp.resetCaptured();
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent);
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    const [only] = triesOf(ended);
    expect(only?.attempt.state, describeTries(ended)).toBe(EvalRunTryState.graded);
    expect(
      mcp.capturedRequests().map((r) => r.method),
      "the try connected the agent's own server",
    ).toEqual([]);
    const run = await runOf(only!.attempt.runId);
    expect(run.spec?.disallowedTools).toContain(`mcp__${server}`);

    // The control: an ordinary turn on the same agent connects the server.
    mock.enqueue(anthropicText("Hello."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org: tenancy.org, name: uniqueName("ordinary"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: ordinary.metadata!.id }));
    const turn = await awaitTerminal(clients, ordinary.metadata!.id);
    expect(turn.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(mcp.capturedRequests().map((r) => r.method), "an ordinary turn connects the server").toContain("initialize");
  }, 360_000);

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] two eval runs of two versions of one agent both complete, each recording its own version and running its instructions", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const agentName = uniqueName("evr-agent");
    const v1 = await agentWith([notes.plugin], { name: agentName });
    const v2 = await clients.agentCommand.apply(
      makeAgent({ org: tenancy.org, name: agentName, instructions: SAVED_LATER, plugins: [notes.plugin.metadata!.slug] }),
    );
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(anthropicText(DONE));

    const earlier = await startEval(v2, { agentVersion: v1.status!.versionHash });
    const current = await startEval(v2);
    const [endedEarlier, endedCurrent] = await Promise.all([
      awaitEvalRunEnd(clients, earlier.metadata!.id, 300_000),
      awaitEvalRunEnd(clients, current.metadata!.id, 300_000),
    ]);
    const expected: ReadonlyArray<[EvalRun, string]> = [
      [endedEarlier, v1.status!.versionHash],
      [endedCurrent, v2.status!.versionHash],
    ];
    for (const [ended, hash] of expected) {
      expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
      expect(ended.status?.agentVersionHash).toBe(hash);
      const [only] = triesOf(ended);
      expect((await runOf(only!.attempt.runId)).status?.agentVersionHash).toBe(hash);
    }
    const systems = mock.scriptedRequests().map((request) => systemTextOf(request.body));
    expect(systems).toHaveLength(2);
    expect(systems.filter((s) => s.includes(INSTRUCTIONS) && !s.includes(SAVED_LATER)), "one try ran the earlier version").toHaveLength(1);
    expect(systems.filter((s) => s.includes(SAVED_LATER) && !s.includes(INSTRUCTIONS)), "one try ran the current version").toHaveLength(1);
  }, 360_000);
});

describe.skipIf(!runnerServesTries)("EvalRun about an agent — comparing a plugin", () => {
  // The run's plugins as the turn recorded them, by id (RunStatus.loaded_versions).
  function loadedPluginIds(run: Run): string[] {
    return (run.status?.loadedVersions?.plugins ?? []).map((ref) => ref.id);
  }

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] comparing a plugin the agent and its subagent both attach: the with try loads it, the without try leaves it out of the whole turn, the subagent's copy included", async () => {
    const refund = await installed("evr-refund", (skill) => [scoredCase("refund-case", skill)]);
    const helper = await createAgentWith(clients, fixtures, tenancy.org, [refund.plugin], {
      name: uniqueName("evr-helper"),
      instructions: "Help with refunds, one line per answer.",
    });
    const agent = await agentWith([refund.plugin], { subagents: [helper.metadata!.slug] });
    // The case, then the arm: with (reads the skill), then without (offered none).
    mock.enqueue(skillRead(refund, "call_skill_refund"));
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent, {
      comparedPluginId: refund.plugin.metadata!.id,
      ablation: EvalRunAblation.with_without,
    });
    expect(created.status?.triesTotal).toBe(2);
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    expect(mock.consumed(), "exactly the scripted turns").toBe(3);
    expect(ended.status!.plugins.map((p) => [p.pluginSlug, p.attached, p.compared])).toEqual([
      [refund.plugin.metadata!.slug, true, true],
    ]);

    const requests = mock.scriptedRequests();
    expect(systemTextOf(requests[0]!.body), "the with try offers the plugin's skill").toContain(offeredSkill(refund));
    expect(systemTextOf(requests[2]!.body), "the without try offers none").not.toContain(offeredSkill(refund));

    const refundId = refund.plugin.metadata!.id;
    const tries = triesOf(ended);
    expect(tries.map((t) => t.arm)).toEqual(["with", "without"]);
    for (const { arm, attempt } of tries) {
      expect(attempt.state, `${arm}: ${describeTries(ended)}`).toBe(EvalRunTryState.graded);
      const run = await runOf(attempt.runId);
      expect(run.spec?.excludedPluginIds, `${arm} try's exclusion`).toEqual(arm === "with" ? [] : [refundId]);
      expect(loadedPluginIds(run), `${arm} try's loaded plugins, the subagent's included`).toEqual(
        arm === "with" ? [refundId] : [],
      );
      const session = await clients.sessionQuery.get({ value: attempt.sessionId });
      expect(pinnedPlugins(session), `${arm} try's conversation lists the plugin either way`).toEqual([
        [refund.plugin.metadata!.slug, refund.plugin.status!.digest],
      ]);
    }
  }, 360_000);

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] comparing a plugin the agent does not attach: both tries run its case, the without try reading the case all the same", async () => {
    const notes = await installed("evr-notes", (skill) => [scoredCase("notes-case", skill)]);
    const refund = await installed("evr-refund", (skill) => [scoredCase("refund-case", skill)]);
    const agent = await agentWith([notes.plugin]);
    mock.enqueue(skillRead(refund, "call_skill_refund"));
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent, {
      comparedPluginId: refund.plugin.metadata!.id,
      ablation: EvalRunAblation.with_without,
    });
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    expect(ended.status!.plugins.map((p) => [p.pluginSlug, p.attached, p.compared, p.notRunReason])).toEqual([
      [notes.plugin.metadata!.slug, true, false, "not selected"],
      [refund.plugin.metadata!.slug, false, true, ""],
    ]);
    const [result] = ended.status!.plugins[1]!.cases[0]!.targets;
    expect(result?.withPlugin?.score, describeTries(ended)).toBe(1);
    expect(result?.withoutPlugin?.score, "the without try ran the case and was graded").toBe(1);
    expect(result?.delta).toBe(0);

    const refundId = refund.plugin.metadata!.id;
    for (const { arm, attempt } of triesOf(ended)) {
      expect(attempt.state, arm).toBe(EvalRunTryState.graded);
      const run = await runOf(attempt.runId);
      expect(loadedPluginIds(run).includes(refundId), `${arm} try loads the compared plugin`).toBe(arm === "with");
      expect(loadedPluginIds(run), `${arm} try loads the attached plugin`).toContain(notes.plugin.metadata!.id);
      const session = await clients.sessionQuery.get({ value: attempt.sessionId });
      expect(session.spec?.agentRef?.version).toBe(agent.status!.versionHash);
      expect(pinnedPlugins(session), `${arm} try lists the attached plugin, then the compared one`).toEqual([
        [notes.plugin.metadata!.slug, notes.plugin.status!.digest],
        [refund.plugin.metadata!.slug, refund.plugin.status!.digest],
      ]);
    }
  }, 360_000);
});

describe.skipIf(!runnerServesTries)("EvalRun about an agent — cancel and the spending limit", () => {
  it("[rpc:EvalRunCommandController.delete] [rpc:EvalRunCommandController.cancel] delete of the eval run and of its agent are refused while it runs, naming cancel; cancel ends it partial cancelled and no later try starts", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const style = await installed("evr-style", () => [doneCase("style-case")]);
    const agent = await agentWith([notes.plugin, style.plugin]);
    mock.enqueue(anthropicText(DONE), { delayMs: 120_000 });
    const created = await startEval(agent);
    const id = created.metadata!.id;
    // The status records a try once it ends; the held turn reaching the
    // model is what says the first try is running.
    await untilConsumed(1, "the first try reached the model");
    expect((await clients.evalRunQuery.get({ value: id })).status?.phase).toBe(EvalRunPhase.running);

    const refused = await expectGrpcCode(
      () => clients.evalRunCommand.delete({ value: id }),
      Code.FailedPrecondition,
      "delete of a running eval",
    );
    expect(refused.rawMessage).toBe(evalRunActiveDeleteMessage(id));
    const agentRefused = await expectGrpcCode(
      () => clients.agentCommand.delete({ value: agent.metadata!.id }),
      Code.FailedPrecondition,
      "delete of an agent whose eval run runs",
    );
    expect(agentRefused.rawMessage).toBe(evalRunActiveOnSubjectDeleteMessage("agent", id));

    await clients.evalRunCommand.cancel({ value: id });
    const ended = await awaitEvalRunEnd(clients, id, 120_000);
    expect(ended.status?.phase).toBe(EvalRunPhase.partial);
    expect(ended.status?.partialReason).toBe(EvalRunPartialReason.cancelled);
    expect(mock.consumed(), "the other plugin's try never started").toBe(1);
    const runs = await clients.agentExecutionQuery.list({ org: tenancy.org, pageSize: 200 });
    const tries = runs.entries.filter((run) => run.metadata?.labels[EVAL_RUN_LABEL] === id);
    expect(tries, "one try was started").toHaveLength(1);
    const stopped = await awaitTerminal(clients, tries[0]!.metadata!.id);
    expect(stopped.status?.phase, "the try in flight was stopped").not.toBe(RunPhase.RUN_COMPLETED);
  }, 360_000);

  it("[rpc:EvalRunQueryController.get] a spending limit reached stops new tries: the eval run ends partial cost_ceiling and the other plugin's try never starts", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const style = await installed("evr-style", () => [doneCase("style-case")]);
    const agent = await agentWith([notes.plugin, style.plugin]);
    // One turn priced well past the eval run's limit; no later try may start.
    mock.enqueue(anthropicText(DONE, { inputTokens: 1_000_000, outputTokens: 100_000 }));

    const created = await startEval(agent, { maxCostUsd: 0.000001 });
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.partial);
    expect(ended.status?.partialReason).toBe(EvalRunPartialReason.cost_ceiling);
    expect(ended.status?.triesFinished).toBe(1);
    expect(ended.status?.costUsd).toBeGreaterThan(0.000001);
    const tries = triesOf(ended);
    expect(tries.map((t) => [t.pluginSlug, t.attempt.state])).toEqual([
      [notes.plugin.metadata!.slug, EvalRunTryState.not_graded],
      [style.plugin.metadata!.slug, EvalRunTryState.pending],
    ]);
    expect(tries[0]?.attempt.notGradedReason).toBe(SPENDING_SHARE_REASON);
    expect(mock.consumed()).toBe(1);
  }, 360_000);
});

describe.skipIf(!runnerServesTries)("EvalRun about an agent — what a try is given and where it shows", () => {
  it("[rpc:EvalRunQueryController.get] a try composes no standing context and no memory, although its organization has both and an ordinary turn on the agent gets them", async () => {
    const fact = "The team ships on Thursdays.";
    const standing = "Always answer in French.";
    const { org } = await provisionOrgWithFacts(clients, fixtures, [fact], (slug) => target.keyTenancy?.(slug) ?? Promise.resolve());
    const organization = await clients.organizationQuery.get({ value: org });
    const spec = clone(OrganizationSpecSchema, organization.spec ?? create(OrganizationSpecSchema));
    spec.preferences ??= create(OrganizationPreferencesSchema);
    spec.preferences.standingContext = standing;
    await clients.organizationCommand.update({ resource: {
      apiVersion: organization.apiVersion,
      kind: organization.kind,
      metadata: { id: organization.metadata!.id, name: organization.metadata!.name },
      spec,
    }, updateMask: { paths: ["*"] } });
    const notes = await installed("evr-notes", () => [doneCase("plain-notes")], org);
    const agent = await agentWith([notes.plugin], { org });

    // An ordinary turn on the agent, in that organization, gets both.
    mock.enqueue(anthropicText("Bonjour."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("ordinary"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: ordinary.metadata!.id }));
    const ordinaryRun = await awaitTerminal(clients, ordinary.metadata!.id);
    expect(ordinaryRun.status?.declaredPreferences?.orgContext).toBe(standing);
    expect(ordinaryRun.status?.recalledMemories?.facts.map((f) => f.content)).toContain(fact);
    mock.reset();

    mock.enqueue(anthropicText(DONE));
    const created = await startEval(agent);
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    const [only] = triesOf(ended);
    const run = await runOf(only!.attempt.runId);
    expect(run.status?.declaredPreferences?.orgContext ?? "").toBe("");
    expect(run.status?.recalledMemories?.facts ?? []).toEqual([]);
    const [request] = mock.scriptedRequests();
    const system = systemTextOf(request?.body);
    expect(system, "the try still runs the agent's instructions").toContain(INSTRUCTIONS);
    expect(system).not.toContain(standing);
    expect(system).not.toContain(fact);
  }, 360_000);

  it("[rpc:SessionQueryController.list] [rpc:SessionQueryController.listByAgent] [rpc:EvalRunQueryController.listByAgent] the tries are left out of the session list and the agent's own session list, and the agent's eval list answers each eval without its tries", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const agent = await agentWith([notes.plugin]);
    mock.enqueue(anthropicText(DONE));
    const created = await startEval(agent);
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(EvalRunPhase.completed);
    const [only] = triesOf(ended);
    expect(only, describeTries(ended)).toBeDefined();

    // The control: an ordinary conversation on the same agent is listed by both.
    mock.enqueue(anthropicText("Hello."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org: tenancy.org, name: uniqueName("ordinary"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: ordinary.metadata!.id }));
    const turn = await awaitTerminal(clients, ordinary.metadata!.id);
    const ordinarySession = sessionIdOf(turn);
    expect(ordinarySession, "the ordinary turn names its conversation").not.toBe("");

    const listed = (await clients.sessionQuery.list({ org: tenancy.org })).entries.map((s) => s.metadata?.id);
    expect(listed).toContain(ordinarySession);
    expect(listed, `try session ${only!.attempt.sessionId} is not listed`).not.toContain(only!.attempt.sessionId);
    const byAgent = (await clients.sessionQuery.listByAgent({ agentId: agent.metadata!.id })).entries.map((s) => s.metadata?.id);
    expect(byAgent).toContain(ordinarySession);
    expect(byAgent, `try session ${only!.attempt.sessionId} is not on the agent's list`).not.toContain(only!.attempt.sessionId);

    const evals = await clients.evalRunQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(evals.entries.map((e) => e.metadata?.id)).toEqual([created.metadata!.id]);
    const [summary] = evals.entries;
    expect(summary?.status?.triesFinished).toBe(1);
    const listedResult = summary?.status?.plugins[0]?.cases[0]?.targets[0]?.withPlugin;
    expect(listedResult?.score, "the list keeps the score").toBe(ended.status!.plugins[0]!.cases[0]!.targets[0]!.withPlugin!.score);
    expect(listedResult?.tries, "the list leaves the tries out").toEqual([]);
    expect(ended.status!.plugins[0]!.cases[0]!.targets[0]!.withPlugin!.tries, "get answers them").toHaveLength(1);
  }, 360_000);

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] a try with no targets runs the agent's own model and thinking setting, labelled with its model; a named target runs the named model", async () => {
    const notes = await installed("evr-notes", () => [doneCase("notes-case")]);
    const agent = await agentWith([notes.plugin], {
      harness: Harness.STIGMER,
      runConfig: { modelName: AGENT_MODEL, thinkingMode: ThinkingMode.ENABLED },
    });

    mock.enqueue(anthropicText(DONE));
    const asItRuns = await startEval(agent);
    const endedAsItRuns = await awaitEvalRunEnd(clients, asItRuns.metadata!.id, 180_000);
    expect(endedAsItRuns.status?.phase, describeTries(endedAsItRuns)).toBe(EvalRunPhase.completed);
    const defaultTarget = endedAsItRuns.status!.plugins[0]!.cases[0]!.targets;
    expect(defaultTarget.map((t) => t.target?.modelName), "the target is labelled with the agent's model").toEqual([AGENT_MODEL]);
    const [agentTry] = triesOf(endedAsItRuns);
    const agentRun = await runOf(agentTry!.attempt.runId);
    expect(agentRun.spec?.runConfig?.modelName ?? "", "the try names no model").toBe("");
    expect(agentRun.status?.runConfig?.modelName).toBe(AGENT_MODEL);
    expect(agentRun.status?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
    expect(readAnthropicRequest(mock.scriptedRequests()[0]!.body).model).toBe(await providerIdOf(AGENT_MODEL));
    mock.reset();

    mock.enqueue(anthropicText(DONE));
    const named = await startEval(agent, { targets: [{ harness: Harness.STIGMER, modelName: TARGET_MODEL }] });
    const endedNamed = await awaitEvalRunEnd(clients, named.metadata!.id, 180_000);
    expect(endedNamed.status?.phase, describeTries(endedNamed)).toBe(EvalRunPhase.completed);
    expect(endedNamed.status!.plugins[0]!.cases[0]!.targets.map((t) => t.target?.modelName)).toEqual([TARGET_MODEL]);
    const [namedTry] = triesOf(endedNamed);
    const namedRun = await runOf(namedTry!.attempt.runId);
    expect(namedRun.status?.runConfig?.modelName).toBe(TARGET_MODEL);
    expect(readAnthropicRequest(mock.scriptedRequests()[0]!.body).model).toBe(await providerIdOf(TARGET_MODEL));
  }, 360_000);
});

describe.skipIf(!runnerServesTries)("EvalRun about an agent — an Eval's cases", () => {
  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunQueryController.get] an Eval's case mocks a server the agent writes itself: the stand-in answers the try, the case is graded, and the eval run names the Eval at its pushed digest", async () => {
    const server = "tracker";
    const folder = evalFolderArchive(
      [
        {
          name: "files-a-bug",
          prompt: "File the crash on save.",
          graders: [
            { name: "asked-tracker", frontmatter: { type: "regex", pattern: '"title":"Crash on save"', target: "mock_calls" } },
            { name: "mock-answered", frontmatter: { type: "regex", pattern: "Created issue #4821: Crash on save", target: "trace" } },
            lastMessageGrader("says-done", "^DONE"),
          ],
        },
      ],
      { [`mocks/${server}/create_issue.md`]: "---\nexpect:\n  title: string\n---\n\nCreated issue #4821: {{input.title}}\n" },
    );
    const slug = uniqueName("evr-eval");
    const pushed = await clients.evalCommand.push({ org: tenancy.org, slug, artifact: folder });
    fixtures.defer(() => clients.evalCommand.delete({ value: pushed.metadata!.id }).then(() => undefined));
    const agent = await agentWith([], { mcpServers: [{ name: server, url: mcp.url([ECHO_TOOL_NAME]) }] });
    mcp.resetCaptured();
    mock.enqueue(anthropicToolUse("call_create", "create_issue", { title: "Crash on save" }));
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(agent, { evals: [{ org: tenancy.org, slug }] });
    expect(created.status?.plugins).toEqual([]);
    const ended = await awaitEvalRunEnd(clients, created.metadata!.id, 300_000);
    const [block] = ended.status?.evals ?? [];
    const attempt = block?.cases[0]?.targets[0]?.withPlugin?.tries[0];
    const why = `state ${EvalRunTryState[attempt?.state ?? 0]} error "${attempt?.error ?? ""}" reason "${attempt?.notGradedReason ?? ""}"`;
    expect(ended.status?.phase, why).toBe(EvalRunPhase.completed);
    expect([block?.evalId, block?.evalSlug, block?.evalDigest]).toEqual([pushed.metadata!.id, slug, digestOf(folder)]);
    expect(attempt?.state, why).toBe(EvalRunTryState.graded);
    expect(attempt?.score, `every grader passes on the stand-in's answer: ${why}`).toBe(1);
    expect(block?.cases.map((c) => [c.caseName, c.mockedServers.map((m) => [m.name, m.tools, m.notStartedReason])])).toEqual([
      ["files-a-bug", [[server, ["create_issue"], ""]]],
    ]);
    expect(mock.consumed(), "exactly the scripted turns").toBe(2);
    expect(mcp.capturedRequests().map((r) => r.method), "the mocked server is never connected").toEqual([]);
  }, 360_000);
});
