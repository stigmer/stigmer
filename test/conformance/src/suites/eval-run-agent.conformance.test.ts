// Conformance suite for the EvalRun domain about an agent: an eval run of
// test cases on an agent, the cases of the plugins it attaches or of a
// plugin it compares, created, read and refused; no test here waits on a
// try. eval-run.conformance.test.ts holds the eval runs about a plugin and
// the refusals every eval run shares.
// Domain: agentic / evalrun — one run of test cases on the agent itself, a
// child of its agent.
//
// What is pinned here, on every edition:
//   - create resolves spec.agent_version (empty: the current version; an
//     earlier version's hash; a tag where the edition tags versions) and
//     stamps the version's hash on spec.agent_version and
//     status.agent_version_hash; it stamps every plugin a try loads, the
//     attached ones in the agent's order and then a compared plugin the
//     agent does not attach, each with its digest, whether attached and
//     compared, and why its cases do not run ("not selected" when
//     spec.cases leaves it out, "no eval cases at this version"); with no
//     case source it runs the compared plugin's cases when one is compared,
//     else every attached plugin's; it mints the eval run's own id and
//     counts its tries (cases x runs, one arm unless a plugin is compared);
//   - create naming an Eval as a case source, on an agent that attaches no
//     plugin, stamps it in status.evals after the plugins (its id, slug and
//     the digest of the version it runs: the current one, or the one a tag
//     names) and counts its cases' tries; an Eval that is not there is
//     refused INVALID_ARGUMENT naming it, and nothing is stored;
//   - get answers what create stored; listByAgent answers the agent's eval
//     runs newest first, and no other agent's;
//   - create refuses, before anything is stored: an agent version that
//     attaches no plugin and compares none (an earlier one too, while the
//     current one attaches some), a case source the try would not load (a
//     plugin neither attached nor compared, an installed one included), an
//     eval run none of whose selected plugins has cases, an organization
//     that is not the agent's, a version the agent does not hold, an agent
//     that does not exist, an allow_tools entry naming a server of no
//     plugin a try loads (while one naming an attached plugin's server is
//     kept as written, whether that plugin's cases run or not), a target
//     model the catalog does not know, and cases past the limits counted
//     across every plugin.
// Without an engine behind the server (the plain local targets), create
// cannot start the eval run's workflow: it is stored and answered failed,
// naming why, cancelling it changes nothing, delete removes it, and the
// agent's delete removes its eval runs.
//
// On an engine-backed target every accepted create starts the eval run's
// workflow, which runs real tries until cleanup cancels it. So every eval
// run this file creates there is the smallest: one case (case_glob
// "first"), one try unless a test counts tries, no comparison arm unless a
// test compares, and the floor of a try's budget as its spending limit.
//
// Who may run and read an eval run is pinned on the target's enforcing
// lane (the cloud's primary; open source's OIDC sibling): the agent's owner
// creates, cancels and deletes its eval runs, and so does a person granted
// editor on the agent where the edition grants roles on one agent; a
// member who only views the agent does none of them; a viewer of the agent
// in its own organization gets and lists its eval runs; a person who
// cannot view the agent (another organization's, or a member when the
// agent is private) is refused get, listByAgent and create; and a child
// organization's viewer of an agent its parent shares gets an empty
// listByAgent and is refused get, because a try spends the parent's money.
// On the same lane a member runs an organization Eval on an agent of their
// own, and naming another person's private Eval is refused exactly as an
// Eval that is not there (INVALID_ARGUMENT, the same sentence), so a
// refusal never tells a private Eval exists.
// A target with no enforcing lane skips those arms visibly. The relations
// themselves are the authorization model's store tests
// (backend/services/stigmer-server/fga/tests/eval-run-agent-access.fga.yaml).
//
// Out of scope here, pinned in the execution class with an engine
// (suites-execution/eval-run-agent.conformance.test.ts): an eval run to
// its end, what each try runs and is given, a compared plugin left out of
// the without try's turn, delete and the agent's delete refused while it
// runs, cancel of a running eval run, and listByAgent answering an eval run
// without its tries (no eval run here has tries to leave out).
import { Code } from "@connectrpc/connect";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import {
  EVAL_RUN_AGENT_DENIED_MESSAGE,
  EVAL_RUN_NO_CASES_MESSAGE,
  EVAL_RUN_NO_CASE_SOURCES_MESSAGE,
  EVAL_RUN_NOT_STARTED_ERROR,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  type AgentEvalRunOptions,
  type EvalCaseFixture,
  awaitEvalRunEnd,
  cancelAndDeleteEvalRun,
  createAgentWith,
  evalRunOrgMismatchMessage,
  evalRunOtherPluginToolMessage,
  evalRunTooLargeMessage,
  evalRunUnloadedCaseSourceMessage,
  evalRunUnreadableEvalMessage,
  installPlugin,
  isActivePhase,
  lastMessageGrader,
  makeEvalRun,
  skillFiredGrader,
  skillPluginWithEvals,
} from "../support/eval-runs";
import { digestOf, evalFolderArchive } from "../support/evals";
import { organizationRole, grantTriple } from "../support/grants";
import { uniqueName, uniqueOrg } from "../support/naming";
import { claudePlugin } from "../support/plugins";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
// Read at collection time so an edition without an engine (or without a
// capability) reports its cases SKIPPED, never as passes that returned
// early. `scheduleFiring` is the engine-backed flag the eval run about a
// plugin's suite and create-mints-id gate the same boundary on.
const capabilities = createTarget().capabilities;
let clients: ConformanceClients;
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  tenancy = await target.provisionTenancy();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

// A skill's slug is unique in its organization, whichever plugin holds it,
// so every plugin of the file names its own.
function skillOf(pluginName: string): string {
  return `${pluginName}-notes`;
}

function caseNamed(name: string, skill: string): EvalCaseFixture {
  return {
    name,
    prompt: "Write release notes for: renamed getUser to fetchUser.",
    frontmatter: { allowed_tools: ["Read", "Skill"] },
    graders: [skillFiredGrader(skill), lastMessageGrader("says-done", "DONE")],
  };
}

// A plugin with one skill and the cases `first` and `second`, installed in
// `org` by `as` (the file's tenancy and clients by default).
async function installedWithEvals(
  prefix = "evr",
  opts: {
    org?: string;
    as?: ConformanceClients;
    visibility?: ApiResourceVisibility;
    mcpServers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  } = {},
): Promise<Plugin> {
  const name = uniqueName(prefix);
  const skill = skillOf(name);
  return installPlugin(
    opts.as ?? clients,
    fixtures,
    opts.org ?? tenancy.org,
    skillPluginWithEvals(name, {
      skill,
      cases: [caseNamed("first", skill), caseNamed("second", skill)],
      ...(opts.mcpServers === undefined ? {} : { mcpServers: opts.mcpServers }),
    }),
    opts.visibility,
  );
}

// A plugin of one skill and no evals/.
async function installedWithoutEvals(prefix = "evr-bare"): Promise<Plugin> {
  const name = uniqueName(prefix);
  return installPlugin(
    clients,
    fixtures,
    tenancy.org,
    claudePlugin({ name, skills: [{ name: skillOf(name), description: "Notes", body: "# Notes" }] }),
  );
}

const AGENT_INSTRUCTIONS = "Answer as the release desk, one line per change.";

// An agent in the file's tenancy listing `plugins`, deleted after its evals.
async function agentWith(plugins: readonly Plugin[], name = uniqueName("evr-agent")): Promise<Agent> {
  return createAgentWith(clients, fixtures, tenancy.org, plugins, { name, instructions: AGENT_INSTRUCTIONS });
}

// Saves the agent named `name` again with other instructions (a new
// version) listing `plugins`.
async function savedAgain(name: string, plugins: readonly Plugin[], instructions: string): Promise<Agent> {
  return clients.agentCommand.apply(
    makeAgent({ org: tenancy.org, name, instructions, plugins: plugins.map((p) => p.metadata!.slug) }),
  );
}

// The spending limit of the smallest eval: the floor of a try's budget.
const SMALLEST_LIMIT_USD = 0.01;

// The smallest eval a test may start (the header says why): the case
// `first` of every plugin, one try, the floor of a try's budget; `opts`
// overrides.
function smallestEval(opts: AgentEvalRunOptions) {
  return makeEvalRun({ runs: 1, maxCostUsd: SMALLEST_LIMIT_USD, caseGlob: "first", ...opts });
}

// Creates the smallest eval of `agent` and defers its cleanup (cancel when
// it may still run, then delete), which runs before the agent's delete.
async function createEval(agent: Agent, opts: Partial<AgentEvalRunOptions> = {}) {
  const created = await clients.evalRunCommand.create(
    smallestEval({ org: agent.metadata!.org, agentId: agent.metadata!.id, ...opts }),
  );
  fixtures.defer(() => cancelAndDeleteEvalRun(clients, created.metadata!.id));
  return created;
}

function stampedPlugins(
  plugins: ReadonlyArray<{ pluginId: string; pluginSlug: string; pluginDigest: string; notRunReason: string }>,
) {
  return plugins.map((p) => [p.pluginId, p.pluginSlug, p.pluginDigest, p.notRunReason]);
}

// A plugin as a case source: by its slug in its organization.
function sourceOf(plugin: Plugin) {
  return { org: plugin.metadata!.org, slug: plugin.metadata!.slug };
}

// A folder of the cases `first` and `second`, graded on their last
// message; `marker` changes the bytes, so each marker is its own version.
function evalFolder(marker = "v1"): Uint8Array {
  const graders = [lastMessageGrader("says-done", "DONE")];
  return evalFolderArchive([
    { name: "first", prompt: `Write release notes for: renamed getUser to fetchUser (${marker}).`, graders },
    { name: "second", prompt: "Write release notes for: dropped the legacy flag.", graders },
  ]);
}

// Pushes `archive` as an Eval in `org` by `as` under `slug`, deleted after
// the test (after every eval run and agent deferred later).
async function pushEval(
  slug: string,
  archive: Uint8Array,
  opts: { org?: string; as?: ConformanceClients; tag?: string; visibility?: ApiResourceVisibility } = {},
) {
  const as = opts.as ?? clients;
  const pushed = await as.evalCommand.push({
    org: opts.org ?? tenancy.org,
    slug,
    artifact: archive,
    ...(opts.tag === undefined ? {} : { tag: opts.tag }),
    ...(opts.visibility === undefined ? {} : { visibility: opts.visibility }),
  });
  fixtures.defer(() => as.evalCommand.delete({ value: pushed.metadata!.id }).then(() => undefined));
  return pushed;
}

function stampedEvals(evals: ReadonlyArray<{ evalId: string; evalSlug: string; evalDigest: string; notRunReason: string }>) {
  return evals.map((e) => [e.evalId, e.evalSlug, e.evalDigest, e.notRunReason]);
}

describe("EvalRun about an agent — create, get and listByAgent", () => {
  it("[rpc:EvalRunCommandController.create] create stamps the agent's current version and every attached plugin with its digest and not-run reason, mints the eval run's id and counts its tries", async () => {
    const notes = await installedWithEvals("evr-notes");
    const bare = await installedWithoutEvals();
    const extra = await installedWithEvals("evr-extra");
    const agent = await agentWith([notes, bare, extra]);
    const hash = agent.status?.versionHash ?? "";
    expect(hash, "the saved agent has a version").not.toBe("");

    const created = await createEval(agent, {
      cases: [sourceOf(notes), sourceOf(bare)],
      runs: 2,
    });

    expect(created.metadata?.id).toMatch(/^evr_[0-9a-z]{26}$/);
    expect(created.metadata?.org).toBe(tenancy.org);
    expect(created.spec?.subject).toEqual({ case: "agentId", value: agent.metadata!.id });
    expect(created.spec?.agentVersion, "an empty version is stamped with the current version's hash").toBe(hash);
    expect(created.status?.agentVersionHash).toBe(hash);
    // Every attached plugin, in the agent's order, the left-out one included.
    expect(stampedPlugins(created.status?.plugins ?? [])).toEqual([
      [notes.metadata!.id, notes.metadata!.slug, notes.status!.digest, ""],
      [bare.metadata!.id, bare.metadata!.slug, bare.status!.digest, PLUGIN_NO_CASES_REASON],
      [extra.metadata!.id, extra.metadata!.slug, extra.status!.digest, PLUGIN_NOT_SELECTED_REASON],
    ]);
    // One plugin runs, one case kept by the glob, the agent as it runs, one arm, two tries.
    expect(created.status?.triesTotal).toBe(2);
    expect(created.status?.triesFinished ?? 0).toBe(0);
  });

  it("[rpc:EvalRunCommandController.create] create stamps the version it names by hash, though the agent was saved since", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("evr-agent");
    const v1 = await agentWith([notes], name);
    const v2 = await savedAgain(name, [notes], "Answer as the support desk, politely.");
    expect(v2.metadata?.id).toBe(v1.metadata?.id);
    expect(v2.status?.versionHash, "the save is a new version").not.toBe(v1.status?.versionHash);

    const earlier = await createEval(v2, { agentVersion: v1.status!.versionHash });
    expect(earlier.spec?.agentVersion).toBe(v1.status!.versionHash);
    expect(earlier.status?.agentVersionHash).toBe(v1.status!.versionHash);
    const current = await createEval(v2);
    expect(current.status?.agentVersionHash, "an empty version is the current one").toBe(v2.status!.versionHash);
  });

  it("[rpc:EvalRunQueryController.get] get answers what create stored", async () => {
    const notes = await installedWithEvals();
    const agent = await agentWith([notes]);
    const created = await createEval(agent, { caseGlob: "fir*" });

    const read = await clients.evalRunQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.subject).toEqual({ case: "agentId", value: agent.metadata!.id });
    expect(read.spec?.agentVersion).toBe(agent.status!.versionHash);
    expect(read.spec?.caseGlob).toBe("fir*");
    expect(read.status?.agentVersionHash).toBe(agent.status!.versionHash);
    expect(stampedPlugins(read.status?.plugins ?? [])).toEqual(stampedPlugins(created.status?.plugins ?? []));
    expect(read.status?.triesTotal).toBe(1);
  });

  it("[rpc:EvalRunQueryController.listByAgent] listByAgent answers the agent's eval runs newest first, and no other agent's", async () => {
    const notes = await installedWithEvals();
    const agent = await agentWith([notes]);
    const other = await agentWith([notes]);
    const first = await createEval(agent);
    const second = await createEval(agent);
    const elsewhere = await createEval(other);

    const list = await clients.evalRunQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);
    expect(list.nextPageToken).toBe("");
    expect(list.entries.map((e) => e.metadata?.id)).not.toContain(elsewhere.metadata!.id);
  });
});

describe("EvalRun about an agent — comparing a plugin", () => {
  it("[rpc:EvalRunCommandController.create] comparing a plugin the agent does not attach lists it last, compared and not attached, runs its cases by default and doubles the tries", async () => {
    const notes = await installedWithEvals("evr-notes");
    const refund = await installedWithEvals("evr-refund");
    const agent = await agentWith([notes]);

    const created = await createEval(agent, { comparedPluginId: refund.metadata!.id, ablation: EvalRunAblation.with_without });
    expect(created.spec?.comparedPluginId).toBe(refund.metadata!.id);
    expect(
      created.status?.plugins.map((p) => [p.pluginSlug, p.attached, p.compared, p.notRunReason, p.pluginDigest]),
    ).toEqual([
      [notes.metadata!.slug, true, false, PLUGIN_NOT_SELECTED_REASON, notes.status!.digest],
      [refund.metadata!.slug, false, true, "", refund.status!.digest],
    ]);
    // The compared plugin's case kept by the glob, two arms, one try each.
    expect(created.status?.triesTotal).toBe(2);
  });

  it("[rpc:EvalRunCommandController.create] comparing a plugin the agent attaches marks it compared in place, its cases run by default", async () => {
    const notes = await installedWithEvals("evr-notes");
    const tracker = await installedWithEvals("evr-tracker");
    const agent = await agentWith([notes, tracker]);

    const created = await createEval(agent, { comparedPluginId: tracker.metadata!.id, ablation: EvalRunAblation.none });
    expect(created.status?.plugins.map((p) => [p.pluginSlug, p.attached, p.compared, p.notRunReason])).toEqual([
      [notes.metadata!.slug, true, false, PLUGIN_NOT_SELECTED_REASON],
      [tracker.metadata!.slug, true, true, ""],
    ]);
    expect(created.status?.triesTotal).toBe(1);
  });

  it("[rpc:EvalRunCommandController.create] an agent that attaches no plugin is accepted once it compares one", async () => {
    const refund = await installedWithEvals("evr-refund");
    const agent = await agentWith([]);
    const created = await createEval(agent, { comparedPluginId: refund.metadata!.id, ablation: EvalRunAblation.none });
    expect(created.status?.plugins.map((p) => p.pluginSlug)).toEqual([refund.metadata!.slug]);
  });
});

describe.skipIf(!capabilities.versionTagging)("EvalRun about an agent — a tagged version", () => {
  it("[rpc:EvalRunCommandController.create] create resolves a tag to the tagged version's hash", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("evr-agent");
    const v1 = await agentWith([notes], name);
    await clients.agentCommand.tagVersion({ agentId: v1.metadata!.id, versionHash: v1.status!.versionHash, tag: "stable" });
    const v2 = await savedAgain(name, [notes], "Answer as the support desk, politely.");
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    const created = await createEval(v2, { agentVersion: "stable" });
    expect(created.spec?.agentVersion, "the tag is stamped as the hash it names").toBe(v1.status!.versionHash);
    expect(created.status?.agentVersionHash).toBe(v1.status!.versionHash);
  });
});

describe("EvalRun about an agent — an Eval's cases", () => {
  it("[rpc:EvalRunCommandController.create] an Eval named as a case source runs on an agent that attaches no plugin: create stamps its id, slug and current digest and counts its cases' tries", async () => {
    const slug = uniqueName("evr-eval");
    const folder = evalFolder();
    const pushed = await pushEval(slug, folder);
    const agent = await agentWith([]);

    const created = await createEval(agent, { evals: [{ org: tenancy.org, slug }], runs: 2 });

    expect(created.status?.plugins ?? []).toEqual([]);
    expect(stampedEvals(created.status?.evals ?? [])).toEqual([[pushed.metadata!.id, slug, digestOf(folder), ""]]);
    // The case `first` kept by the glob, one arm, two tries.
    expect(created.status?.triesTotal).toBe(2);
    const read = await clients.evalRunQuery.get({ value: created.metadata!.id });
    expect(stampedEvals(read.status?.evals ?? []), "get answers the stamped Eval").toEqual(stampedEvals(created.status?.evals ?? []));
  });

  it("[rpc:EvalRunCommandController.create] an Eval named at a tag runs the tagged version, though a later one was pushed; named bare, its current one", async () => {
    const slug = uniqueName("evr-eval-tag");
    const stable = evalFolder("stable");
    await pushEval(slug, stable, { tag: "stable" });
    const next = evalFolder("next");
    await pushEval(slug, next);
    const agent = await agentWith([]);

    const byTag = await createEval(agent, { evals: [{ org: tenancy.org, slug, version: "stable" }] });
    expect(byTag.status?.evals.map((e) => e.evalDigest)).toEqual([digestOf(stable)]);
    const current = await createEval(agent, { evals: [{ org: tenancy.org, slug }] });
    expect(current.status?.evals.map((e) => e.evalDigest)).toEqual([digestOf(next)]);
  });

  it("[rpc:EvalRunCommandController.create] an Eval that is not there is INVALID_ARGUMENT naming it, and nothing is stored", async () => {
    const agent = await agentWith([]);
    const missing = uniqueName("evr-no-eval");
    const refused = await expectGrpcCode(
      () => clients.evalRunCommand.create(smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, evals: [{ org: tenancy.org, slug: missing }] })),
      Code.InvalidArgument,
      "an eval run naming an Eval that is not there",
    );
    expect(refused.rawMessage).toBe(evalRunUnreadableEvalMessage(missing));
    expect((await clients.evalRunQuery.listByAgent({ agentId: agent.metadata!.id })).entries).toEqual([]);
  });
});

describe("EvalRun about an agent — create refusals", () => {
  it("[rpc:EvalRunCommandController.create] an agent version that attaches no plugin and compares none is FAILED_PRECONDITION", async () => {
    const agent = await agentWith([]);
    const err = await expectGrpcCode(
      () => clients.evalRunCommand.create(smallestEval({ org: tenancy.org, agentId: agent.metadata!.id })),
      Code.FailedPrecondition,
      "create on an agent that attaches no plugin",
    );
    expect(err.rawMessage).toBe(EVAL_RUN_NO_CASE_SOURCES_MESSAGE);
  });

  it("[rpc:EvalRunCommandController.create] an earlier version that attaches no plugin is refused though the current one attaches some", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("evr-agent");
    const v1 = await agentWith([], name);
    const v2 = await savedAgain(name, [notes], "Answer as the support desk, politely.");
    const err = await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          smallestEval({ org: tenancy.org, agentId: v1.metadata!.id, agentVersion: v1.status!.versionHash }),
        ),
      Code.FailedPrecondition,
      "create on an earlier version with no plugin",
    );
    expect(err.rawMessage).toBe(EVAL_RUN_NO_CASE_SOURCES_MESSAGE);
    const current = await createEval(v2);
    expect(current.status?.agentVersionHash, "the current version, which attaches the plugin, is accepted").toBe(
      v2.status!.versionHash,
    );
  });

  it("[rpc:EvalRunCommandController.create] a case source the try would not load is INVALID_ARGUMENT naming it, an installed plugin of the organization included", async () => {
    const notes = await installedWithEvals();
    const unattached = await installedWithEvals("evr-unattached");
    const agent = await agentWith([notes]);
    for (const slug of [unattached.metadata!.slug, "not-attached"]) {
      const err = await expectGrpcCode(
        () =>
          clients.evalRunCommand.create(
            smallestEval({
              org: tenancy.org,
              agentId: agent.metadata!.id,
              cases: [sourceOf(notes), { org: tenancy.org, slug }],
            }),
          ),
        Code.InvalidArgument,
        `create taking cases from ${slug}, which a try would not load`,
      );
      expect(err.rawMessage).toBe(evalRunUnloadedCaseSourceMessage(slug));
    }
  });

  it("[rpc:EvalRunCommandController.create] an eval run none of whose selected plugins has cases is FAILED_PRECONDITION, though another attached plugin has some", async () => {
    const bare = await installedWithoutEvals();
    const onlyBare = await agentWith([bare]);
    const err = await expectGrpcCode(
      () => clients.evalRunCommand.create(smallestEval({ org: tenancy.org, agentId: onlyBare.metadata!.id })),
      Code.FailedPrecondition,
      "create on an agent none of whose plugins has cases",
    );
    expect(err.rawMessage).toBe(EVAL_RUN_NO_CASES_MESSAGE);

    const notes = await installedWithEvals();
    const both = await agentWith([notes, bare]);
    const narrowed = await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          smallestEval({ org: tenancy.org, agentId: both.metadata!.id, cases: [sourceOf(bare)] }),
        ),
      Code.FailedPrecondition,
      "create selecting only the plugin with no cases",
    );
    expect(narrowed.rawMessage).toBe(EVAL_RUN_NO_CASES_MESSAGE);
  });

  it("[rpc:EvalRunCommandController.create] an organization that is not the agent's is FAILED_PRECONDITION naming the agent's", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const other = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(other));
    const err = await expectGrpcCode(
      () => clients.evalRunCommand.create(smallestEval({ org: other.org, agentId: agent.metadata!.id })),
      Code.FailedPrecondition,
      "create in another organization",
    );
    expect(err.rawMessage).toBe(evalRunOrgMismatchMessage("agent", tenancy.org));
  });

  it("[rpc:EvalRunCommandController.create] a version the agent does not hold, by hash or by tag, is NOT_FOUND", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    for (const version of ["9".repeat(64), "no-such-tag"]) {
      await expectGrpcCode(
        () =>
          clients.evalRunCommand.create(
            smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, agentVersion: version }),
          ),
        Code.NotFound,
        `create naming version ${version}`,
      );
    }
  });

  it("[rpc:EvalRunCommandController.create] an agent that does not exist is NOT_FOUND", async () => {
    await expectGrpcCode(
      () => clients.evalRunCommand.create(smallestEval({ org: tenancy.org, agentId: "agt_01jzzzzzzzzzzzzzzzzzzzzzzz" })),
      Code.NotFound,
      "create on a missing agent",
    );
  });

  it("[rpc:EvalRunCommandController.create] an allow_tools entry naming a server of no plugin a try loads is INVALID_ARGUMENT; one naming an attached plugin's server is kept as written, its cases run or not", async () => {
    const notes = await installedWithEvals();
    const tracker = await installedWithEvals("evr-tracker", {
      mcpServers: { github: { type: "http", url: "https://github.mock.invalid/mcp" } },
    });
    const agent = await agentWith([notes, tracker]);
    const foreign = "mcp__plugin_someone-else_github__*";
    const err = await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, allowTools: ["Skill", foreign] }),
        ),
      Code.InvalidArgument,
      "create granting a server no attached plugin has",
    );
    expect(err.rawMessage).toBe(evalRunOtherPluginToolMessage(foreign, "plugin_someone-else_github"));

    // The tracker plugin is attached but left out of spec.cases: a try
    // still attaches it, so a grant naming its server is the agent's.
    const own = `mcp__plugin_${tracker.metadata!.name}_github__*`;
    const created = await createEval(agent, { cases: [sourceOf(notes)], allowTools: ["Skill", own] });
    expect(created.spec?.allowTools).toEqual(["Skill", own]);
    expect(created.status?.plugins.map((p) => p.notRunReason)).toEqual(["", PLUGIN_NOT_SELECTED_REASON]);
  });

  it("[rpc:EvalRunCommandController.create] a target model the catalog does not know is INVALID_ARGUMENT naming the target", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const err = await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          smallestEval({
            org: tenancy.org,
            agentId: agent.metadata!.id,
            targets: [{ harness: Harness.NATIVE, modelName: "surely-not-a-real-model-xyz" }],
          }),
        ),
      Code.InvalidArgument,
      "create with an unknown target model",
    );
    // Prefix only: the refusal appends a did-you-mean drawn from the catalog.
    expect(err.rawMessage).toContain(
      "spec.targets[0].model_name: model 'surely-not-a-real-model-xyz' is not in the model registry",
    );
  });

  it("[rpc:EvalRunCommandController.create] cases past the limits, counted across every plugin, are FAILED_PRECONDITION with the computed counts", async () => {
    const agent = await agentWith([await installedWithEvals("evr-one"), await installedWithEvals("evr-two")]);
    // 2 plugins x 2 cases x 6 targets x 50 tries = 1200 tries, past the 1000
    // an eval may run, though each plugin alone (600) is within them.
    const err = await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          makeEvalRun({
            org: tenancy.org,
            agentId: agent.metadata!.id,
            runs: 50,
            targets: Array.from({ length: 6 }, () => ({ harness: Harness.NATIVE, modelName: "" })),
          }),
        ),
      Code.FailedPrecondition,
      "create of cases past the limits",
    );
    expect(err.rawMessage).toBe(evalRunTooLargeMessage(4, 1200));
  });

  it("[rpc:EvalRunQueryController.listByAgent] a refused create stores nothing", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    await expectGrpcCode(
      () =>
        clients.evalRunCommand.create(
          smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, cases: [{ org: tenancy.org, slug: "not-attached" }] }),
        ),
      Code.InvalidArgument,
      "create selecting a plugin the agent does not attach",
    );
    const list = await clients.evalRunQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toEqual([]);
  });
});

describe.skipIf(capabilities.routineFiring)("EvalRun about an agent — without an engine behind the server", () => {
  it("[rpc:EvalRunCommandController.create] create stores the eval run failed, naming why it could not start", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await createEval(agent);
    expect(created.status?.phase).toBe(EvalRunPhase.failed);
    expect(created.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);
    expect(created.status?.plugins, "the failed eval keeps its stamped plugins").toHaveLength(1);
    const read = await clients.evalRunQuery.get({ value: created.metadata!.id });
    expect(read.status?.phase).toBe(EvalRunPhase.failed);
    expect(read.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);
  });

  it("[rpc:EvalRunCommandController.cancel] cancel of an eval run that has ended changes nothing", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await createEval(agent);
    const before = await clients.evalRunQuery.get({ value: created.metadata!.id });

    const cancelled = await clients.evalRunCommand.cancel({ value: created.metadata!.id });
    expect(cancelled.status?.phase).toBe(EvalRunPhase.failed);
    const after = await clients.evalRunQuery.get({ value: created.metadata!.id });
    expect(after.status).toEqual(before.status);
  });

  it("[rpc:EvalRunCommandController.delete] delete removes the eval run", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await clients.evalRunCommand.create(
      smallestEval({ org: tenancy.org, agentId: agent.metadata!.id }),
    );
    const deleted = await clients.evalRunCommand.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata!.id);
    await expectGrpcCode(
      () => clients.evalRunQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
    const list = await clients.evalRunQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toEqual([]);
  });

  it("deleting the agent deletes its eval runs", async () => {
    const notes = await installedWithEvals();
    // Its own tracker: the agent is deleted here, and its evals with it.
    const agent = await createAgentWith(clients, new FixtureTracker(), tenancy.org, [notes], {
      name: uniqueName("evr-cascade"),
      instructions: AGENT_INSTRUCTIONS,
    });
    const created = await clients.evalRunCommand.create(
      smallestEval({ org: tenancy.org, agentId: agent.metadata!.id }),
    );
    await clients.agentCommand.delete({ value: agent.metadata!.id });
    await expectGrpcCode(
      () => clients.evalRunQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get of an eval whose agent was deleted",
    );
  });
});

// ─── Who may run and read an eval, on a server that enforces it ─────────────

// The arms below run on the target's enforcing lane: the primary on the
// cloud, open source's OIDC sibling on the local targets. A target with no
// lane skips them visibly. The lane's founder created the organization, so
// it is an admin there: only an admin installs a plugin, and the founder
// owns every agent below.
describe("EvalRun about an agent — who may run and read an eval run", () => {
  async function laneTenancy(lane: EnforcingLane): Promise<TenancyContext> {
    const context = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(context));
    return context;
  }

  // An agent listing one installed plugin with eval cases, both saved by the
  // founder at `visibility` (the agent may not be more visible than its plugin).
  async function laneAgent(lane: EnforcingLane, org: string, visibility?: ApiResourceVisibility): Promise<Agent> {
    const plugin = await installedWithEvals("evr-authz", { org, as: lane.clients, visibility });
    return createAgentWith(lane.clients, fixtures, org, [plugin], {
      name: uniqueName("evr-authz-agent"),
      instructions: AGENT_INSTRUCTIONS,
      ...(visibility === undefined ? {} : { visibility }),
    });
  }

  // `as`'s eval of `agent`, cleaned up by the founder before the agent.
  async function laneEval(lane: EnforcingLane, as: ConformanceClients, agent: Agent) {
    const created = await as.evalRunCommand.create(
      smallestEval({ org: agent.metadata!.org, agentId: agent.metadata!.id }),
    );
    const id = created.metadata!.id;
    fixtures.defer(async () => {
      const current = await lane.clients.evalRunQuery.get({ value: id }).catch(() => undefined);
      if (current !== undefined) await cancelAndDeleteEvalRun(lane.clients, id);
    });
    return created;
  }

  // Cancels eval `id` as `as`, waits for its end, deletes it as `as`, and
  // proves it gone.
  async function cancelAndDeleteAs(lane: EnforcingLane, as: ConformanceClients, id: string): Promise<void> {
    const cancelled = await as.evalRunCommand.cancel({ value: id });
    expect(cancelled.metadata?.id).toBe(id);
    if (isActivePhase((await lane.clients.evalRunQuery.get({ value: id })).status?.phase)) {
      await awaitEvalRunEnd(lane.clients, id, 60_000);
    }
    const deleted = await as.evalRunCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);
    await expectGrpcCode(() => lane.clients.evalRunQuery.get({ value: id }), Code.NotFound, "get after the delete");
  }

  // A fresh person holding exactly `role` in `org`, granted by the founder.
  async function personWith(lane: EnforcingLane, org: string, role: string): Promise<ConformanceClients> {
    const person = await lane.provisionIdentity();
    await lane.clients.grantCommand.create(organizationRole(await lane.accountIdOf(person), role, org));
    return person;
  }

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunCommandController.cancel] [rpc:EvalRunCommandController.delete] the agent's owner creates, cancels and deletes its eval runs; a member who only views the agent does none of them", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const agent = await laneAgent(lane, org);
    const agentId = agent.metadata!.id;
    const member = await lane.provisionMember({ org });
    expect((await member.agentQuery.get({ value: agentId })).metadata?.id, "the member views the organization's agent").toBe(
      agentId,
    );

    const refused = await expectGrpcCode(
      () => member.evalRunCommand.create(smallestEval({ org, agentId })),
      Code.PermissionDenied,
      "a member who cannot edit the agent starting an eval",
    );
    expect(refused.rawMessage).toBe(EVAL_RUN_AGENT_DENIED_MESSAGE);
    expect((await lane.clients.evalRunQuery.listByAgent({ agentId })).entries, "the refused create stored nothing").toEqual([]);

    const created = await laneEval(lane, lane.clients, agent);
    const id = created.metadata!.id;
    const before = await lane.clients.evalRunQuery.get({ value: id });
    await expectGrpcCode(
      () => member.evalRunCommand.cancel({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the agent cancelling its eval",
    );
    await expectGrpcCode(
      () => member.evalRunCommand.delete({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the agent deleting its eval",
    );
    const after = await lane.clients.evalRunQuery.get({ value: id });
    expect(after.metadata?.id, "the refused delete left the eval").toBe(id);
    expect(after.status?.partialReason, "the refused cancel changed nothing").toBe(before.status?.partialReason);

    await cancelAndDeleteAs(lane, lane.clients, id);
  });

  it("[rpc:EvalRunCommandController.create] [rpc:EvalRunCommandController.cancel] [rpc:EvalRunCommandController.delete] a person granted editor on the agent creates, cancels and deletes its eval runs", async (ctx) => {
    if (!capabilities.perResourceGrants) {
      return ctx.skip("the edition grants roles on organizations only, so no one can be made an editor of one agent");
    }
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const agent = await laneAgent(lane, org, ApiResourceVisibility.visibility_private);
    const editor = await lane.provisionMember({ org });
    await lane.clients.grantCommand.create(
      grantTriple({ kind: "identity_account", id: await lane.accountIdOf(editor) }, "editor", {
        kind: "agent",
        id: agent.metadata!.id,
      }),
    );

    const created = await laneEval(lane, editor, agent);
    expect(created.spec?.agentVersion).toBe(agent.status!.versionHash);
    expect((await editor.evalRunQuery.get({ value: created.metadata!.id })).metadata?.id).toBe(created.metadata!.id);
    await cancelAndDeleteAs(lane, editor, created.metadata!.id);
  });

  it("[rpc:EvalRunQueryController.get] [rpc:EvalRunQueryController.listByAgent] a viewer of the agent in its own organization reads and lists its eval runs", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const agent = await laneAgent(lane, org);
    const created = await laneEval(lane, lane.clients, agent);
    const viewer = await lane.provisionMember({ org });

    const read = await viewer.evalRunQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.subject).toEqual({ case: "agentId", value: agent.metadata!.id });
    const list = await viewer.evalRunQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries.map((e) => e.metadata?.id)).toEqual([created.metadata!.id]);
  });

  it("[rpc:EvalRunQueryController.get] [rpc:EvalRunQueryController.listByAgent] [rpc:EvalRunCommandController.create] a person who cannot view the agent reads, lists and starts nothing: another organization's person, and a member when the agent is private", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const shared = await laneAgent(lane, org);
    const sharedEval = await laneEval(lane, lane.clients, shared);
    const hidden = await laneAgent(lane, org, ApiResourceVisibility.visibility_private);
    const hiddenEval = await laneEval(lane, lane.clients, hidden);
    const outsider = await lane.provisionIdentity();
    const member = await lane.provisionMember({ org });

    const cases: ReadonlyArray<{ who: string; as: ConformanceClients; agent: Agent; evalId: string }> = [
      { who: "another organization's person", as: outsider, agent: shared, evalId: sharedEval.metadata!.id },
      { who: "a member, of a private agent", as: member, agent: hidden, evalId: hiddenEval.metadata!.id },
    ];
    for (const { who, as, agent, evalId } of cases) {
      await expectGrpcCode(() => as.evalRunQuery.get({ value: evalId }), Code.PermissionDenied, `${who} reading the eval`);
      await expectGrpcCode(
        () => as.evalRunQuery.listByAgent({ agentId: agent.metadata!.id }),
        Code.PermissionDenied,
        `${who} listing the agent's evals`,
      );
      const refused = await expectGrpcCode(
        () => as.evalRunCommand.create(smallestEval({ org, agentId: agent.metadata!.id })),
        Code.PermissionDenied,
        `${who} starting an eval`,
      );
      expect(refused.rawMessage).toBe(EVAL_RUN_AGENT_DENIED_MESSAGE);
    }
  });

  it("[rpc:EvalRunCommandController.create] a member runs an organization Eval on an agent of their own; naming another person's private Eval is refused as an Eval that is not there", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const shared = await pushEval(uniqueName("evr-authz-eval"), evalFolder("shared"), { org, as: lane.clients });
    const hidden = await pushEval(uniqueName("evr-authz-private"), evalFolder("hidden"), {
      org,
      as: lane.clients,
      visibility: ApiResourceVisibility.visibility_private,
    });
    const member = await lane.provisionMember({ org });
    const agent = await createAgentWith(member, fixtures, org, [], {
      name: uniqueName("evr-authz-member-agent"),
      instructions: AGENT_INSTRUCTIONS,
    });
    const agentId = agent.metadata!.id;

    const created = await member.evalRunCommand.create(
      smallestEval({ org, agentId, evals: [{ org, slug: shared.metadata!.slug }] }),
    );
    fixtures.defer(() => cancelAndDeleteEvalRun(member, created.metadata!.id));
    expect(created.status?.evals.map((e) => e.evalId), "the member's eval run stamps the organization's Eval").toEqual([
      shared.metadata!.id,
    ]);

    const hiddenSlug = hidden.metadata!.slug;
    const refused = await expectGrpcCode(
      () => member.evalRunCommand.create(smallestEval({ org, agentId, evals: [{ org, slug: hiddenSlug }] })),
      Code.InvalidArgument,
      "a member naming another person's private Eval",
    );
    expect(refused.rawMessage, "the refusal is the one for an Eval that is not there").toBe(evalRunUnreadableEvalMessage(hiddenSlug));
    expect((await member.evalRunQuery.listByAgent({ agentId })).entries.map((e) => e.metadata?.id)).toEqual([created.metadata!.id]);
  });

  it("[rpc:EvalRunQueryController.listByAgent] [rpc:EvalRunQueryController.get] a child organization's viewer of an agent its parent shares lists none of its eval runs and reads none", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const parent = (await laneTenancy(lane)).org;
    const child = await lane.clients.organizationCommand.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: uniqueOrg() },
      spec: { parentOrg: parent, externalId: uniqueName("cust") },
    });
    const childOrg = child.metadata!.id;
    fixtures.defer(() => lane.clients.organizationCommand.delete({ value: childOrg }));
    const agent = await laneAgent(lane, parent, ApiResourceVisibility.visibility_child_orgs);
    const agentId = agent.metadata!.id;
    const created = await laneEval(lane, lane.clients, agent);
    const childViewer = await personWith(lane, childOrg, "viewer");

    expect(
      (await childViewer.agentQuery.get({ value: agentId })).metadata?.id,
      "the child's viewer views the agent its parent shares",
    ).toBe(agentId);
    const list = await childViewer.evalRunQuery.listByAgent({ agentId });
    expect(list.entries, "a try spends the parent's money: the child's viewer lists no eval").toEqual([]);
    await expectGrpcCode(
      () => childViewer.evalRunQuery.get({ value: created.metadata!.id }),
      Code.PermissionDenied,
      "a child organization's viewer reading the parent's eval",
    );
  });
});
