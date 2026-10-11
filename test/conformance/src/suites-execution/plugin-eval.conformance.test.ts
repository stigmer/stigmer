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
//     with-arm tries run on the assistant with the plugin listed and read
//     its skill inside the plugin's mounted tree, the without-arm tries run
//     on the assistant with nothing attached and are offered no skill;
//     a `tool_used: Skill` grader is an indicator only (its reason says it
//     passed on the with-arm and failed on the without), a `regex` grader on
//     the last message scores, `Δ` is computed and not provisional;
//   - each try's run carries one Score, source eval, one criterion per
//     grader, the indicator `not_applicable`;
//   - a case that runs with another plugin is listed "not run" and starts
//     no run;
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
//     delete removes the eval and its tries' conversations;
//   - a case's scaffold builds its starting folder from a fixture beside the
//     case, its file a try changes is read and never counted as created, a
//     reference folder is read under `.stigmer/inputs/`, and an `EVAL_*`
//     variable reaches the shell; a failed scaffold scores the try 0 with
//     its error and starts no turn;
//   - a resumed case's first model request carries the recorded turns, and
//     a Cursor target lists the case as not run;
//   - a mocked server answers under the plugin server's name: a fixed mock
//     and an agent mock (answered by the scripted model) are graded through
//     `mock_calls`, and the case lists its servers; an `expect:` violation
//     stops the try, reported `aborted` with a 0.
//
// Every engine-backed describe runs only where the runner creates the try's
// run as the eval's caller (CapabilityFlags.runnerActsAsRunCreator): on the
// cloud-execution target a try's run belongs to another subject, as for the
// AI judge (stigmer#2105).
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
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CriterionResult, ScoreSource, ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  OrganizationPreferencesSchema,
  OrganizationSpecSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { readAnthropicRequest, readLastUserText, readTurnShapes } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
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
  NOT_STARTED_NO_MOCK,
  engineUnsupportedReason,
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

// Read once at collection time to gate the engine-backed arms (constructing
// a target is side-effect-free; setup() is what boots processes).
const runnerServesTries = createTarget().capabilities.runnerActsAsRunCreator;

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

/** The model reading the plugin's skill where a turn mounts it: inside the plugin's tree, by digest. */
function skillRead(installation: Installed, id: string) {
  const status = installation.plugin.status!;
  const path = status.skills.find((skill) => skill.name === installation.skill)!.path;
  return anthropicToolUse(id, "read_file", { file_path: `.stigmer/plugins/${status.digest}/${path}/SKILL.md` });
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
  opts: { org?: string; hooks?: Readonly<Record<string, unknown>>; files?: Readonly<Record<string, string>> } = {},
): Promise<Installed> {
  const name = uniqueName("pev");
  const skill = `${name}-notes`;
  const plugin = await installPlugin(
    clients,
    fixtures,
    opts.org ?? tenancy.org,
    skillPluginWithEvals(name, {
      skill,
      cases: cases(skill),
      ...(opts.hooks === undefined ? {} : { hooks: opts.hooks }),
      ...(opts.files === undefined ? {} : { files: opts.files }),
    }),
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

describe.skipIf(!runnerServesTries)("PluginEval — a suite with and without the plugin", () => {
  it("[rpc:PluginEvalCommandController.create] [rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] [rpc:SessionQueryController.list] [rpc:SessionQueryController.get] two cases, two tries per arm: the with-arm reads the skill, the regex scores, Δ is computed and not provisional", async () => {
    const installation = await installed((skill) => [
      scoredCase("first-notes", skill),
      scoredCase("second-notes", skill),
      {
        name: "other-plugin",
        prompt: "Summarise the repository.",
        frontmatter: { plugins: ["/plugins/other"] },
        graders: [lastMessageGrader("says-done", "^DONE")],
      },
    ]);
    // Matrix order: the case, then the arm, then the try; the other-plugin case plans none.
    for (let caseIndex = 0; caseIndex < 2; caseIndex++) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        mock.enqueue(skillRead(installation, `call_skill_${caseIndex}_${attempt}`));
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
    expect(ended.status?.provisionalDelta).toBe(false);
    expect(mock.consumed(), "exactly the scripted turns: the other-plugin case started no run").toBe(12);

    const status = ended.status!;
    expect(status.cases.map((c) => c.caseName)).toEqual(["first-notes", "other-plugin", "second-notes"]);
    const scaffold = status.cases.find((c) => c.caseName === "other-plugin")!;
    expect(scaffold.notRunReason).toBe(unsupportedFeatureReason("plugins"));
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
    // A plugin's skill is offered by the name a turn gives it, `<plugin>:<skill>`.
    const offered = requests.map((request) =>
      systemTextOf(request.body).includes(`### ${installation.plugin.metadata!.name}:${installation.skill}`),
    );
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
      // The indicator's own verdict rides in its reason: the with-arm's skill read is the Skill call.
      const indicated = located.arm === "with" ? "passed" : "failed";
      expect(skillFired?.reason.startsWith(`${INDICATOR_ONLY_REASON}; ${indicated}: `), skillFired?.reason).toBe(true);
      expect(score.spec?.value).toEqual({ case: "passed", value: located.arm === "with" });

      // Out of the conversation list, read by id.
      expect(listed.has(attempt.sessionId), `try session ${attempt.sessionId} is not listed`).toBe(false);
      const session = await clients.sessionQuery.get({ value: attempt.sessionId });
      expect(session.metadata?.labels[PLUGIN_EVAL_LABEL]).toBe(created.metadata!.id);
      expect(session.spec?.subject).toBe(located.caseName);
    }
  }, 360_000);
});

describe.skipIf(!runnerServesTries)("PluginEval — grading", () => {
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

describe.skipIf(!runnerServesTries)("PluginEval — what a try is given", () => {
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

    // An ordinary chat with the plugin listed, in that organization, gets both.
    mock.enqueue(anthropicText("Bonjour."));
    const ordinary = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("ordinary"),
        sessionSpec: { plugins: [{ kind: ApiResourceKind.plugin, slug: installation.plugin.metadata!.slug }] },
        autoApproveAll: true,
      }),
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

describe.skipIf(!runnerServesTries)("PluginEval — cancel and delete with an engine", () => {
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

describe.skipIf(!runnerServesTries)("PluginEval — fixtures, resumed conversations, variables and mocks", () => {
  /** The one try of a one-case, one-arm eval. */
  async function onlyTry(installation: Installed, opts: Partial<PluginEvalOptions> = {}) {
    const created = await startEval(installation, { ablation: PluginEvalAblation.none, ...opts });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 240_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const tries = triesOf(ended);
    expect(tries, describeTries(ended)).toHaveLength(1);
    return { ended, attempt: tries[0]!.attempt };
  }

  it("[rpc:PluginEvalQueryController.get] a scaffold builds the starting folder from a shared fixture, a reference folder is read, and an EVAL_* variable reaches the shell", async () => {
    const installation = await installed(
      () => [
        {
          name: "fixture-case",
          prompt: "Bump the version.",
          frontmatter: { allowed_tools: ["Read"], env: { EVAL_X: "eval-x-value" } },
          caseYaml: {
            schema_version: "1.1",
            name: "fixture-case",
            context: { scaffold_script: "setup.sh", add_dirs: ["resources"] },
          },
          files: {
            "setup.sh": 'cp "$(dirname "$0")/../_fixture/app.txt" app.txt\ngit init -q .\n',
            "resources/style.md": "STYLE-MARKER: one line per change.\n",
          },
          graders: [
            { name: "read-reference", frontmatter: { type: "regex", pattern: "STYLE-MARKER", target: "trace" } },
            { name: "env-reached", frontmatter: { type: "regex", pattern: "eval-x-value", target: "trace" } },
            { name: "bumped", frontmatter: { type: "regex", pattern: "version = 2", target: { source: "file", path: "app.txt" } } },
            { name: "not-created", frontmatter: { type: "file_exists", path: "app.txt", exists: false } },
            lastMessageGrader("says-done", "^DONE"),
          ],
        },
      ],
      { files: { "evals/_fixture/app.txt": "version = 1\n" } },
    );
    mock.enqueue(anthropicToolUse("call_ref", "read_file", { file_path: ".stigmer/inputs/resources/style.md" }));
    mock.enqueue(anthropicToolUse("call_env", "execute", { command: 'echo "$EVAL_X"' }));
    mock.enqueue(anthropicToolUse("call_edit", "edit_file", { file_path: "app.txt", old_string: "version = 1", new_string: "version = 2" }));
    mock.enqueue(anthropicText(DONE));

    const { attempt } = await onlyTry(installation, { allowTools: ["Bash", "Edit"] });
    expect(attempt.state, `error "${attempt.error}"`).toBe(PluginEvalTryState.graded);
    const score = await evalScoreOf(attempt.runId);
    expect(score.spec?.criteria.map((c) => [c.name, c.result, c.reason])).toEqual(
      // Grader files are read in path order.
      ["bumped", "env-reached", "not-created", "read-reference", "says-done"].map((name) => [
        name,
        CriterionResult.passed,
        expect.any(String),
      ]),
    );
    expect(attempt.score).toBe(1);
  }, 300_000);

  it("[rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] a failed scaffold scores the try 0 with its error, and starts no turn", async () => {
    const installation = await installed(() => [
      {
        name: "broken-scaffold",
        prompt: "Anything.",
        caseYaml: { schema_version: "1.1", name: "broken-scaffold", context: { scaffold_script: "setup.sh" } },
        files: { "setup.sh": "echo no such repository >&2\nexit 3\n" },
        graders: [{ name: "never-calls-bash", frontmatter: { type: "tool_used", tool: "Bash", max: 0 } }],
      },
    ]);
    const { ended, attempt } = await onlyTry(installation);
    expect(mock.consumed(), "the engine never started").toBe(0);
    expect(attempt.state, describeTries(ended)).toBe(PluginEvalTryState.graded);
    expect(attempt.score, describeTries(ended)).toBe(0);
    expect(attempt.error).toBe("scaffold failed: exit 3: no such repository");
    const score = await evalScoreOf(attempt.runId);
    expect(score.spec?.value).toEqual({ case: "passed", value: false });
    expect(score.spec?.criteria.map((c) => [c.result, c.reason])).toEqual([
      [CriterionResult.not_applicable, "not checked: the scaffold failed"],
    ]);
  }, 300_000);

  it("[rpc:PluginEvalQueryController.get] a resumed case's first request carries the recorded turns, and a Cursor target lists it as not run", async () => {
    const history = [
      JSON.stringify({ type: "user", message: { role: "user", content: "Draft a release note for the rename." } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Draft: renamed getUser to fetchUser." }] } }),
    ].join("\n");
    const installation = await installed(() => [
      {
        name: "resumed",
        prompt: "Now shorten it.",
        caseYaml: { schema_version: "1.1", name: "resumed", context: { history_file: "history.jsonl" } },
        files: { "history.jsonl": `${history}\n` },
        graders: [lastMessageGrader("short", "^Short")],
      },
    ]);
    mock.enqueue(anthropicText("Short: getUser is fetchUser."));

    const { ended, attempt } = await onlyTry(installation, {
      targets: [{ harness: Harness.NATIVE }, { harness: Harness.CURSOR }],
    });
    expect(attempt.score).toBe(1);
    const [request] = mock.scriptedRequests();
    expect(readTurnShapes(request!.body).map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(request!.body)).toContain("Draft a release note for the rename.");
    expect(readLastUserText(request!.body)).toContain("Now shorten it.");
    const resumed = ended.status!.cases[0]!;
    expect(resumed.notes).toContain("resumed from history.jsonl");
    expect(resumed.targets.map((t) => t.notRunReason)).toEqual(["", engineUnsupportedReason("Cursor", "resumed conversations")]);
  }, 300_000);

  it("[rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] both arms of a with-and-without eval get the case's scaffold and EVAL_* variables", async () => {
    const installation = await installed(
      () => [
        {
          name: "both-arms",
          prompt: "Print the variable, then say DONE.",
          frontmatter: { env: { EVAL_X: "eval-x-value" } },
          caseYaml: { schema_version: "1.1", name: "both-arms", context: { scaffold_script: "setup.sh" } },
          files: { "setup.sh": 'cp "$(dirname "$0")/../_fixture/app.txt" app.txt\n' },
          graders: [
            { name: "env-reached", frontmatter: { type: "regex", pattern: "eval-x-value", target: "trace" } },
            { name: "scaffolded", frontmatter: { type: "regex", pattern: "version = 1", target: { source: "file", path: "app.txt" } } },
            lastMessageGrader("says-done", "^DONE"),
          ],
        },
      ],
      { files: { "evals/_fixture/app.txt": "version = 1\n" } },
    );
    // Matrix order: the with-arm's try, then the without-arm's.
    for (const arm of ["with", "without"]) {
      mock.enqueue(anthropicToolUse(`call_env_${arm}`, "execute", { command: 'echo "$EVAL_X"' }));
      mock.enqueue(anthropicText(DONE));
    }

    const created = await startEval(installation, { allowTools: ["Bash"] });
    const ended = await awaitPluginEvalEnd(clients, created.metadata!.id, 300_000);
    expect(ended.status?.phase, describeTries(ended)).toBe(PluginEvalPhase.completed);
    const tries = triesOf(ended);
    expect(tries.map((t) => t.arm)).toEqual(["with", "without"]);
    for (const { arm, attempt } of tries) {
      expect(attempt.state, `${arm}: error "${attempt.error}"`).toBe(PluginEvalTryState.graded);
      const score = await evalScoreOf(attempt.runId);
      expect(score.spec?.criteria.map((c) => [c.name, c.result]), arm).toEqual([
        ["env-reached", CriterionResult.passed],
        ["says-done", CriterionResult.passed],
        ["scaffolded", CriterionResult.passed],
      ]);
      expect(attempt.score, arm).toBe(1);
    }
  }, 360_000);

  /** A one-skill plugin with the MCP servers `tracker` and `wiki`, and the suite's mocks of `tracker`. */
  async function mockedPlugin(cases: (skill: string) => readonly EvalCaseFixture[]): Promise<Installed> {
    const name = uniqueName("pev");
    const skill = `${name}-notes`;
    const plugin = await installPlugin(
      clients,
      fixtures,
      tenancy.org,
      skillPluginWithEvals(name, {
        skill,
        cases: cases(skill),
        mcpServers: {
          tracker: { type: "http", url: "https://tracker.mock.invalid/mcp" },
          wiki: { type: "http", url: "https://wiki.mock.invalid/mcp" },
        },
        files: {
          "evals/mocks/tracker/create_issue.md":
            "---\nexpect:\n  title: string\n---\n\nCreated issue #4821: {{input.title}}\n",
          "evals/mocks/tracker/triage.md": "---\ntype: agent\n---\n\nYou triage issues. Answer with one label.\n",
        },
      }),
    );
    return { plugin, skill };
  }

  it("[rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] a fixed and an agent mock answer under the plugin server's name and are graded through mock_calls", async () => {
    const installation = await mockedPlugin(() => [
      {
        name: "files-a-bug",
        prompt: "File the crash on save, then triage it.",
        graders: [
          { name: "asked-tracker", frontmatter: { type: "regex", pattern: '"title":"Crash on save"', target: "mock_calls" } },
          { name: "fixed-answered", frontmatter: { type: "regex", pattern: "Created issue #4821: Crash on save", target: "trace" } },
          { name: "agent-answered", frontmatter: { type: "regex", pattern: "LABEL-BUG", target: "trace" } },
          lastMessageGrader("says-done", "^DONE"),
        ],
      },
    ]);
    mock.enqueue(anthropicToolUse("call_create", "create_issue", { title: "Crash on save" }));
    mock.enqueue(anthropicToolUse("call_triage", "triage", { issue: 4821 }));
    mock.enqueue(anthropicText("LABEL-BUG")); // the agent mock's own model call
    mock.enqueue(anthropicText(DONE));

    const { ended, attempt } = await onlyTry(installation);
    expect(attempt.state, `error "${attempt.error}"`).toBe(PluginEvalTryState.graded);
    expect(attempt.score).toBe(1);
    const agentMockRequest = mock.scriptedRequests()[2]!;
    expect(systemTextOf(agentMockRequest.body)).toContain("standing in for the MCP server 'tracker'");
    const pluginName = installation.plugin.metadata!.name;
    expect(ended.status!.cases[0]!.mockedServers.map((m) => [m.name, m.tools, m.notStartedReason])).toEqual([
      [`plugin_${pluginName}_tracker`, ["create_issue", "triage"], ""],
      [`plugin_${pluginName}_wiki`, [], NOT_STARTED_NO_MOCK],
    ]);
    // The mocked call is a two-arm indicator, but this eval runs one arm, so every grader scored.
    const score = await evalScoreOf(attempt.runId);
    expect(score.spec?.criteria.every((c) => c.result === CriterionResult.passed)).toBe(true);
  }, 300_000);

  it("[rpc:PluginEvalQueryController.get] [rpc:ScoreQueryController.listByRun] a call that breaks a mock's expect: stops the try, reported aborted with a 0", async () => {
    const installation = await mockedPlugin(() => [
      {
        name: "bad-title",
        prompt: "File the crash.",
        graders: [lastMessageGrader("says-done", "^DONE")],
      },
    ]);
    mock.enqueue(anthropicToolUse("call_create", "create_issue", { title: 7 }));

    const { attempt } = await onlyTry(installation);
    expect(attempt.state).toBe(PluginEvalTryState.graded);
    expect(attempt.score).toBe(0);
    expect(attempt.error).toBe("");
    expect(attempt.aborted).toMatchObject({ server: "tracker", tool: "create_issue", reason: "input.title must be a string" });
    const run = await runOf(attempt.runId);
    expect(run.status?.phase).toBe(RunPhase.RUN_TERMINATED);
    const score = await evalScoreOf(attempt.runId);
    expect(score.spec?.criteria.map((c) => c.reason)).toEqual(["not checked: aborted by tracker.create_issue"]);
  }, 300_000);
});
