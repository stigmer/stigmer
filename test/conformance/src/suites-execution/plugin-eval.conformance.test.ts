// Conformance suite for running a plugin's evals: a PluginEval taken from
// create to its end on a real engine, every try and every AI-graded vote
// answered by the scripted model.
// Domain: agentic / plugineval — one run of an installed plugin's evals/
// cases, each try an ordinary run in a fresh conversation, graded by the
// case's graders and recorded as a Score on the try's run.
//
// The contract under test:
//   - create answers the eval pending; a two-case suite with and without the
//     plugin, two tries each, ends completed with its aggregates: the
//     with-arm tries run on the plugin's composed agent and read its skill,
//     the without-arm tries run on the assistant and are offered no skill;
//     a `tool_used: Skill` grader is an indicator only, a `regex` grader on
//     the last message scores, `Δ` is computed and marked provisional;
//   - each try's run carries one Score, source eval, one criterion per
//     grader, the indicator `not_applicable`;
//   - a case that needs `context.scaffold_script` is listed "not run" and
//     starts no run;
//   - the tries are left out of `session.list` and read by `session.get`;
//   - an `llm` grader is decided by two of its three votes;
//   - a spending limit reached stops new tries: the eval ends partial,
//     `cost_ceiling`, and the try its own share of the limit stopped is not
//     graded, never failed;
//   - a try past its `timeout_seconds` is stopped and graded on what it
//     produced, with the error "timed out after Ns";
//   - a try cannot read the plugin's evals/: a case that does not list
//     `Skill` has its read of the plugin tree refused and is offered no
//     skill, and the plugin tree mounted into its session for its hooks has
//     every other part of the plugin and no evals/, nor the archive that
//     holds them;
//   - a try composes no standing context and no memory, although its
//     organization has both and an ordinary run there gets them;
//   - delete is refused while the eval runs, naming cancel; cancel ends it
//     partial `cancelled`; cancel of an eval that ended changes nothing;
//     delete removes the eval and its tries' conversations.
//
// Out of scope here, with the reason:
//   - a credit refusal ending the eval `out_of_credit`: open source meters
//     no credit (`billingGates`), so it is pinned by the eval workflow's
//     tests on a Temporal test server
//     (backend/services/stigmer-server/src/temporal/evals/__tests__/workflows.temporal.test.ts);
//   - a plugin hook reading a secret from the eval's vaults: the credential
//     resolver's eval branch is pinned by its unit tests
//     (backend/services/stigmer-server/src/domain/vault/__tests__/resolve.test.ts), since a
//     hook that prints a secret into the transcript would need a vault, a
//     hook and a shell grant just to read one value back;
//   - a case that withholds `Skill` on the Cursor engine: the scripted model
//     speaks only Anthropic, so the Cursor half is the runner's goldens.
//
// Every eval here runs one try at a time (concurrency 1), so the scripted
// turns are consumed in the matrix's order (case, target, arm, try), each
// try's turns before its votes. Each try's session has the case's name as
// its subject, so no title call is made.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CriterionResult, ScoreSource, ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  OrganizationPreferencesSchema,
  OrganizationSpecSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf } from "../support/agents";
import { provisionOrgWithFacts } from "../support/memories";
import { uniqueName } from "../support/naming";
import {
  EVAL_METRIC,
  INDICATOR_ONLY_REASON,
  SPENDING_SHARE_REASON,
  PLUGIN_EVAL_LABEL,
  type EvalCaseFixture,
  awaitPluginEvalEnd,
  cancelAndDeletePluginEval,
  followPluginEval,
  installPlugin,
  lastMessageGrader,
  makePluginEval,
  pluginEvalActiveDeleteMessage,
  skillFiredGrader,
  skillPluginWithEvals,
  timedOutError,
  triesOf,
  unsupportedFeatureReason,
  type PluginEvalOptions,
} from "../support/plugin-evals";
import { allToolCalls, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  tenancy = await target.provisionTenancy();
  await target.fundTenancy?.(tenancy.org);
});

afterEach(async () => {
  // A try or a vote that started after its arm's assertions would take the
  // next arm's script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 30_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

// The final message a with-arm try's regex grader passes on, and the one a
// without-arm try fails it with.
const DONE = "DONE: one line per change.";
const UNSURE = "I am not sure how to write those.";

// The skill a with-arm try reads, as the native engine names the mount.
function skillRead(skill: string, id: string) {
  return anthropicToolUse(id, "read_file", { file_path: `.stigmer/skills/${skill}/SKILL.md` });
}

function scoredCase(name: string, skill: string, extra: Partial<EvalCaseFixture> = {}): EvalCaseFixture {
  return {
    name,
    prompt: "Write release notes for: renamed getUser to fetchUser.",
    frontmatter: { allowed_tools: ["Read", "Skill"] },
    graders: [skillFiredGrader(skill), lastMessageGrader("says-done", "^DONE")],
    ...extra,
  };
}

interface Installed {
  readonly plugin: Plugin;
  readonly skill: string;
}

// A one-skill plugin carrying `cases` (built from its skill's name), installed in `org`.
async function installed(
  cases: (skill: string) => readonly EvalCaseFixture[],
  opts: { org?: string; hooks?: Readonly<Record<string, unknown>> } = {},
): Promise<Installed> {
  const name = uniqueName("pev");
  const skill = `${name}-notes`;
  const plugin = await installPlugin(
    clients,
    fixtures,
    opts.org ?? tenancy.org,
    skillPluginWithEvals(name, { skill, cases: cases(skill), ...(opts.hooks === undefined ? {} : { hooks: opts.hooks }) }),
  );
  return { plugin, skill };
}

// Creates an eval and defers its cleanup, which runs before its plugin's delete.
async function startEval(installation: Installed, opts: Partial<PluginEvalOptions> = {}): Promise<PluginEval> {
  const created = await clients.pluginEvalCommand.create(
    makePluginEval({
      org: installation.plugin.metadata!.org,
      pluginId: installation.plugin.metadata!.id,
      ...opts,
    }),
  );
  fixtures.defer(() => cancelAndDeletePluginEval(clients, created.metadata!.id));
  return created;
}

async function runOf(runId: string): Promise<Run> {
  return clients.agentExecutionQuery.get({ value: runId });
}

async function evalScoreOf(runId: string): Promise<Score> {
  const scores = await clients.scoreQuery.listByRun({ runId });
  const score = scores.items.find((item) => item.spec?.metric === EVAL_METRIC);
  if (score === undefined) {
    throw new Error(`run ${runId} carries no eval score; metrics: [${scores.items.map((s) => s.spec?.metric).join(", ")}]`);
  }
  return score;
}

// The system prompt as the model received it on one scripted request.
function systemTextOf(body: unknown): string {
  const system = readAnthropicRequest(body).system;
  if (system === undefined) return "";
  return typeof system === "string" ? system : system.map((block) => block.text).join("\n");
}

function describeTries(pluginEval: PluginEval): string {
  return triesOf(pluginEval)
    .map(
      (t) =>
        `${t.caseName}/${t.arm}/${t.attempt.index}: ${PluginEvalTryState[t.attempt.state]} ` +
        `score=${t.attempt.score} reason="${t.attempt.notGradedReason}" error="${t.attempt.error}"`,
    )
    .join("; ");
}

describe("PluginEval — a suite with and without the plugin", () => {
  it("[rpc:PluginEvalCommandController.create] [rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] [rpc:SessionQueryController.list] [rpc:SessionQueryController.get] two cases, two tries per arm: the with-arm reads the skill, the regex scores, Δ is computed and provisional", async () => {
    const installation = await installed((skill) => [
      scoredCase("first-notes", skill),
      scoredCase("second-notes", skill),
      {
        name: "needs-scaffold",
        prompt: "Summarise the repository.",
        caseYaml: { schema_version: "1.1", name: "needs-scaffold", context: { scaffold_script: "fixture.sh" } },
        graders: [lastMessageGrader("says-done", "^DONE")],
        files: { "fixture.sh": "#!/bin/bash\ntouch README.md\n" },
      },
    ]);
    const { skill } = installation;
    // Matrix order: the case, then the arm, then the try; the scaffold case plans none.
    for (let caseIndex = 0; caseIndex < 2; caseIndex++) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        mock.enqueue(skillRead(skill, `call_skill_${caseIndex}_${attempt}`));
        mock.enqueue(anthropicText(DONE));
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        mock.enqueue(anthropicText(UNSURE));
      }
    }

    const created = await startEval(installation, { runs: 2 });
    expect(created.status?.phase, "create answers before any try starts").toBe(PluginEvalPhase.pending);
    expect(created.status?.triesTotal).toBe(8);

    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    expect(ended.status?.triesFinished).toBe(8);
    expect(ended.status?.provisionalDelta).toBe(true);
    expect(mock.consumed(), "exactly the scripted turns: the scaffold case started no run").toBe(12);

    const status = ended.status!;
    expect(status.cases.map((c) => c.caseName)).toEqual(["first-notes", "needs-scaffold", "second-notes"]);
    const scaffold = status.cases.find((c) => c.caseName === "needs-scaffold")!;
    expect(scaffold.notRunReason).toBe(unsupportedFeatureReason("context.scaffold_script"));
    expect(scaffold.targets.flatMap((t) => [...(t.withPlugin?.tries ?? []), ...(t.withoutPlugin?.tries ?? [])])).toEqual(
      [],
    );
    for (const name of ["first-notes", "second-notes"]) {
      const ran = status.cases.find((c) => c.caseName === name)!;
      expect(ran.notRunReason).toBe("");
      expect(ran.targets).toHaveLength(1);
      const result = ran.targets[0]!;
      expect(result.withPlugin?.score, `${name} with the plugin`).toBe(1);
      expect(result.withPlugin?.gradedTries).toBe(2);
      expect(result.withPlugin?.perfectRuns).toBe(2);
      expect(result.withoutPlugin?.score, `${name} without the plugin`).toBe(0);
      expect(result.withoutPlugin?.gradedTries).toBe(2);
      expect(result.delta).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.passK).toBe(true);
    }
    expect(status.aggregates?.overallScore).toBe(1);
    expect(status.aggregates?.casesPassed).toBe(2);
    expect(status.aggregates?.casesTotal).toBe(2);
    expect(status.aggregates?.casesNotRun).toBe(1);
    expect(status.aggregates?.meanDelta).toBe(1);

    // The with-arm is offered the plugin's skill; the without-arm is not.
    const requests = mock.scriptedRequests();
    expect(requests).toHaveLength(12);
    const offered = requests.map((request) => systemTextOf(request.body).includes(`### ${skill}`));
    expect(offered).toEqual([true, true, true, true, false, false, true, true, true, true, false, false]);

    const tries = triesOf(ended);
    expect(tries).toHaveLength(8);
    const sessions = await clients.sessionQuery.list({ org: tenancy.org });
    const listed = new Set(sessions.entries.map((session) => session.metadata?.id));
    for (const located of tries) {
      const { attempt } = located;
      expect(attempt.state, `${located.caseName}/${located.arm}/${attempt.index}`).toBe(PluginEvalTryState.graded);
      expect(attempt.error).toBe("");
      const run = await runOf(attempt.runId);
      expect(run.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(run.metadata?.labels[PLUGIN_EVAL_LABEL]).toBe(created.metadata!.id);
      const readSkill = allToolCalls(run).some((call) => call.name === "read_file");
      expect(readSkill, `${located.arm}-arm try reads the skill`).toBe(located.arm === "with");

      // One Score per try: source eval, one criterion per grader, the indicator not applicable.
      const score = await evalScoreOf(attempt.runId);
      expect(score.spec?.source).toBe(ScoreSource.eval);
      expect(score.status?.state).toBe(ScoreState.graded);
      expect(score.spec?.criteria.map((c) => c.name)).toEqual(["says-done", "skill-fired"]);
      const [saysDone, skillFired] = score.spec!.criteria;
      expect(saysDone?.result).toBe(located.arm === "with" ? CriterionResult.passed : CriterionResult.failed);
      expect(skillFired?.result).toBe(CriterionResult.not_applicable);
      expect(skillFired?.reason.startsWith(INDICATOR_ONLY_REASON)).toBe(true);
      expect(score.spec?.value).toEqual({ case: "passed", value: located.arm === "with" });

      // Out of the conversation list, read by id.
      expect(listed.has(attempt.sessionId), `try session ${attempt.sessionId} is not listed`).toBe(false);
      const session = await clients.sessionQuery.get({ value: attempt.sessionId });
      expect(session.metadata?.labels[PLUGIN_EVAL_LABEL]).toBe(created.metadata!.id);
      expect(session.spec?.subject).toBe(located.caseName);
    }
  }, 360_000);
});

describe("PluginEval — grading", () => {
  it("[rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] an llm grader is decided by two of its three votes", async () => {
    const installation = await installed(() => [
      {
        name: "judged-notes",
        prompt: "Write release notes for: renamed getUser to fetchUser.",
        frontmatter: { allowed_tools: ["Read"] },
        graders: [{ name: "criteria", frontmatter: { type: "llm" }, body: "PASS if the notes name the rename." }],
      },
    ]);
    const vote = (result: "passed" | "failed") =>
      anthropicText(JSON.stringify({ criteria: { result, reason: `The judge's ${result} vote.` } }));
    mock.enqueue(anthropicText("Renamed getUser to fetchUser."));
    mock.enqueue(vote("passed"));
    mock.enqueue(vote("failed"));
    mock.enqueue(vote("passed"));

    const created = await startEval(installation, { ablation: PluginEvalAblation.none });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const [only] = triesOf(ended);
    expect(only?.attempt.state, describeTries(ended)).toBe(PluginEvalTryState.graded);
    expect(only?.attempt.score).toBe(1);
    expect(mock.consumed(), "the try's turn and three votes").toBe(4);

    const score = await evalScoreOf(only!.attempt.runId);
    expect(score.spec?.criteria.map((c) => [c.name, c.result])).toEqual([["criteria", CriterionResult.passed]]);
    // The votes' runs are gone with their sessions.
    const runs = await clients.agentExecutionQuery.list({ org: tenancy.org, pageSize: 200 });
    const votes = runs.entries.filter((run) => run.metadata?.labels["stigmer.ai/grades-run"] === only!.attempt.runId);
    expect(votes).toEqual([]);
  }, 360_000);

  it("[rpc:PluginEvalQueryController.get] a try past its timeout_seconds is stopped and graded on what it produced", async () => {
    const installation = await installed((skill) => [
      scoredCase("slow-notes", skill, { frontmatter: { allowed_tools: ["Read"], timeout_seconds: 1 } }),
    ]);
    // Held well past the case's one second; the eval stops the run at its deadline.
    mock.enqueue(anthropicText(DONE), { delayMs: 60_000 });

    const created = await startEval(installation, { ablation: PluginEvalAblation.none });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 240_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const [only] = triesOf(ended);
    expect(only?.attempt.error).toBe(timedOutError(1));
    expect(only?.attempt.state, "an agent failure is graded, never left out").toBe(PluginEvalTryState.graded);
    expect(only?.attempt.score, "the run produced no final message").toBe(0);
    const run = await runOf(only!.attempt.runId);
    expect(run.status?.phase).not.toBe(RunPhase.RUN_COMPLETED);
  }, 360_000);

  it("[rpc:PluginEvalQueryController.get] a spending limit reached stops new tries, and the eval ends partial cost_ceiling", async () => {
    const installation = await installed((skill) => [scoredCase("costly-notes", skill)]);
    // One turn priced well past the eval's limit; no later try may start.
    mock.enqueue(anthropicText(DONE, { inputTokens: 1_000_000, outputTokens: 100_000 }));

    const created = await startEval(installation, {
      ablation: PluginEvalAblation.none,
      runs: 3,
      maxCostUsd: 0.000001,
    });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.partial);
    expect(ended.status?.partialReason).toBe(PluginEvalPartialReason.cost_ceiling);
    expect(ended.status?.triesFinished).toBe(1);
    expect(ended.status?.costUsd).toBeGreaterThan(0.000001);
    // The priced turn passes the try's own share of that limit, so the run
    // is stopped at it and the try is not graded, never failed.
    expect(triesOf(ended).map((t) => t.attempt.state)).toEqual([
      PluginEvalTryState.not_graded,
      PluginEvalTryState.pending,
      PluginEvalTryState.pending,
    ]);
    expect(triesOf(ended)[0]?.attempt.notGradedReason).toBe(SPENDING_SHARE_REASON);
    expect(mock.consumed()).toBe(1);
  }, 360_000);
});

describe("PluginEval — what a try is given", () => {
  it("[rpc:PluginEvalQueryController.get] a try cannot read the plugin's evals/: the tree mounted into its session has none", async () => {
    const installation = await installed(
      (skill) => [scoredCase("hidden-cases", skill, { frontmatter: { allowed_tools: ["Read"] } })],
      // A plugin whose agent runs its hooks is mounted into every session it runs in.
      { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }] } },
    );
    const digest = installation.plugin.status!.digest;
    mock.enqueue(
      anthropicToolUse("call_read_case", "read_file", {
        file_path: `.stigmer/plugins/${digest}/evals/hidden-cases/prompt.md`,
      }),
    );
    mock.enqueue(anthropicText(DONE));

    const created = await startEval(installation, { ablation: PluginEvalAblation.none });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const [only] = triesOf(ended);
    const run = await runOf(only!.attempt.runId);
    const caseRead = allToolCalls(run).find((call) => call.id === "call_read_case");
    expect(caseRead, "the scripted read was made").toBeDefined();
    const answered = `${caseRead?.result ?? ""}${caseRead?.error ?? ""}`;
    // The case lists Read only, so the try withholds Skill: a read anywhere in
    // the mounted plugin tree is refused by the turn's tool scope, and the
    // tree below proves the mount carries no evals/ in any case.
    expect(answered, "the read is refused").toContain("is not available to this agent");
    expect(answered, "the case's prompt never reaches the agent").not.toContain("renamed getUser");
    // Withholding Skill also withholds the plugin's skills.
    const [request] = mock.scriptedRequests();
    expect(systemTextOf(request?.body)).not.toContain(`### ${installation.skill}`);

    const home = target.runnerHomeDir?.();
    expect(home, "the target names the runner's home").toBeDefined();
    const plugins = join(home!, ".stigmer", "sessions", only!.attempt.sessionId, "platform", "plugins");
    const mounted = join(plugins, digest);
    expect(existsSync(mounted), `the plugin is mounted for its hooks at ${mounted}`).toBe(true);
    const tree = readdirSync(mounted);
    expect(tree).toEqual(expect.arrayContaining(["hooks", "skills"]));
    expect(tree).not.toContain("evals");
    expect(readdirSync(plugins), "an archive carrying a suite is never cached").not.toContain(`${digest}.zip`);
  }, 360_000);

  it("[rpc:PluginEvalQueryController.get] a try composes no standing context and no memory, although its organization has both", async () => {
    const fact = "The team ships on Thursdays.";
    const standing = "Always answer in French.";
    const { org } = await provisionOrgWithFacts(clients, fixtures, [fact], (slug) => target.fundTenancy?.(slug) ?? Promise.resolve());
    const organization = await clients.organizationQuery.get({ value: org });
    const spec = clone(OrganizationSpecSchema, organization.spec ?? create(OrganizationSpecSchema));
    spec.preferences ??= create(OrganizationPreferencesSchema);
    spec.preferences.standingContext = standing;
    await clients.organizationCommand.update({
      apiVersion: organization.apiVersion,
      kind: organization.kind,
      metadata: { id: organization.metadata!.id, name: organization.metadata!.name },
      spec,
    });
    const installation = await installed((skill) => [scoredCase("plain-notes", skill)], { org });

    // An ordinary run on the plugin's agent in that organization gets both.
    // The agent the plugin's install composed is named after the plugin.
    const agents = await clients.agentQuery.getByReference({
      org,
      kind: ApiResourceKind.agent,
      slug: installation.plugin.metadata!.slug,
    });
    mock.enqueue(anthropicText("Bonjour."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("ordinary"), agentRef: agentRefOf(agents), autoApproveAll: true }),
    );
    const ordinaryRun = await awaitTerminal(clients, ordinary.metadata!.id);
    expect(ordinaryRun.status?.declaredPreferences?.orgContext).toBe(standing);
    expect(ordinaryRun.status?.recalledMemories?.facts.map((f) => f.content)).toContain(fact);
    mock.reset();

    mock.enqueue(anthropicText(DONE));
    const created = await startEval(installation, { ablation: PluginEvalAblation.none });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 180_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const [only] = triesOf(ended);
    const run = await runOf(only!.attempt.runId);
    expect(run.status?.declaredPreferences?.orgContext ?? "").toBe("");
    expect(run.status?.recalledMemories?.facts ?? []).toEqual([]);
    const [request] = mock.scriptedRequests();
    const system = systemTextOf(request?.body);
    expect(system).not.toContain(standing);
    expect(system).not.toContain(fact);
  }, 360_000);
});

describe("PluginEval — cancel and delete with an engine", () => {
  it("[rpc:PluginEvalCommandController.delete] [rpc:PluginEvalCommandController.cancel] delete is refused while the eval runs, naming cancel; cancel ends it partial cancelled", async () => {
    const installation = await installed((skill) => [scoredCase("held-notes", skill)]);
    mock.enqueue(anthropicText(DONE), { delayMs: 120_000 });
    const created = await startEval(installation, { ablation: PluginEvalAblation.none, runs: 2 });
    const id = created.metadata!.id;
    // The status records a try once it ends; the held turn reaching the
    // model is what says the first try is running.
    const deadline = Date.now() + 60_000;
    while (mock.consumed() === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
    expect(mock.consumed(), "the first try reached the model").toBe(1);
    expect((await clients.pluginEvalQuery.get({ value: id })).status?.phase).toBe(PluginEvalPhase.running);

    const refused = await expectGrpcCode(
      () => clients.pluginEvalCommand.delete({ value: id }),
      Code.FailedPrecondition,
      "delete of a running eval",
    );
    expect(refused.rawMessage).toBe(pluginEvalActiveDeleteMessage(id));

    await clients.pluginEvalCommand.cancel({ value: id });
    const ended = await awaitPluginEvalEnd(clients, id, 120_000);
    expect(ended.status?.phase).toBe(PluginEvalPhase.partial);
    expect(ended.status?.partialReason).toBe(PluginEvalPartialReason.cancelled);
    expect(mock.consumed(), "no later try started").toBe(1);
    const runs = await clients.agentExecutionQuery.list({ org: tenancy.org, pageSize: 200 });
    const tries = runs.entries.filter((run) => run.metadata?.labels[PLUGIN_EVAL_LABEL] === id);
    expect(tries, "one try was started").toHaveLength(1);
    const stopped = await awaitTerminal(clients, tries[0]!.metadata!.id);
    expect(stopped.status?.phase, "the try in flight was stopped").not.toBe(RunPhase.RUN_COMPLETED);
  }, 360_000);

  it("[rpc:PluginEvalCommandController.cancel] cancel of an eval that ended changes nothing", async () => {
    const installation = await installed((skill) => [scoredCase("quick-notes", skill)]);
    mock.enqueue(anthropicText(DONE));
    const created = await startEval(installation, { ablation: PluginEvalAblation.none });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 120_000);
    expect(ended.status?.phase).toBe(PluginEvalPhase.completed);

    const answered = await clients.pluginEvalCommand.cancel({ value: created.metadata!.id });
    expect(answered.status?.phase).toBe(PluginEvalPhase.completed);
    const after = await clients.pluginEvalQuery.get({ value: created.metadata!.id });
    expect(after.status).toEqual(ended.status);
  }, 360_000);

  it("[rpc:PluginEvalCommandController.delete] delete removes the eval with its tries' conversations and runs", async () => {
    const installation = await installed((skill) => [scoredCase("gone-notes", skill)]);
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(anthropicText(UNSURE));
    const created = await clients.pluginEvalCommand.create(
      makePluginEval({ org: tenancy.org, pluginId: installation.plugin.metadata!.id }),
    );
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 120_000);
    const tries = triesOf(ended);
    expect(tries).toHaveLength(2);

    await clients.pluginEvalCommand.delete({ value: created.metadata!.id });
    await expectGrpcCode(
      () => clients.pluginEvalQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get of a deleted eval",
    );
    for (const { attempt } of tries) {
      await expectGrpcCode(
        () => clients.sessionQuery.get({ value: attempt.sessionId }),
        Code.NotFound,
        `try session ${attempt.sessionId} after the eval's delete`,
      );
      await expectGrpcCode(
        () => clients.agentExecutionQuery.get({ value: attempt.runId }),
        Code.NotFound,
        `try run ${attempt.runId} after the eval's delete`,
      );
    }
  }, 360_000);
});
