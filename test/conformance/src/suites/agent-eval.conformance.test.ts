// Conformance suite for the AgentEval domain: an eval of an agent on the
// eval cases of the plugins it attaches, created, read and refused; no test
// here waits on a try.
// Domain: agentic / agenteval — one run of the attached plugins' cases on
// the agent itself, a child of its agent.
//
// What is pinned here, on every edition:
//   - create resolves spec.agent_version (empty: the current version; an
//     earlier version's hash; a tag where the edition tags versions) and
//     stamps the version's hash on spec.agent_version and
//     status.agent_version_hash; it stamps every plugin that version
//     attaches, in the agent's order, with its digest and why its cases do
//     not run ("not selected" when spec.plugins leaves it out, "no eval
//     cases at this version"); it mints the eval's own id and counts its
//     tries (cases x runs, one arm);
//   - get answers what create stored; listByAgent answers the agent's evals
//     newest first, and no other agent's;
//   - create refuses, before anything is stored: an agent version that
//     attaches no plugin (an earlier one too, while the current one
//     attaches some), a spec.plugins slug the version does not attach, an
//     eval none of whose selected plugins has cases, an organization that is
//     not the agent's, a version the agent does not hold, an agent that does
//     not exist, an allow_tools entry naming a server of no attached plugin
//     (while one naming an attached plugin's server is kept as written,
//     whether that plugin's cases run or not), a target model the catalog
//     does not know, and cases past the limits counted across every plugin.
// Without an engine behind the server (the plain local targets), create
// cannot start the eval's workflow: the eval is stored and answered failed,
// naming why, cancelling it changes nothing, delete removes it, and the
// agent's delete removes its evals.
//
// On an engine-backed target every accepted create starts the eval's
// workflow, which runs real tries until cleanup cancels it. So every eval
// this file creates there is the smallest: one case (case_glob "first"),
// one try unless a test counts tries, and the floor of a try's budget as its
// spending limit.
//
// Who may run and read an eval is pinned on the target's enforcing lane (the
// cloud's primary; open source's OIDC sibling): the agent's owner creates,
// cancels and deletes its evals, and so does a person granted editor on the
// agent where the edition grants roles on one agent; a member who only views
// the agent does none of them; a viewer of the agent in its own organization
// gets and lists its evals; a person who cannot view the agent (another
// organization's, or a member when the agent is private) is refused get,
// listByAgent and create; and a child organization's viewer of an agent its
// parent shares gets an empty listByAgent and is refused get, because a try
// spends the parent's money. A target with no enforcing lane skips those
// arms visibly. The relations themselves are the authorization model's
// store tests.
//
// Out of scope here, pinned in the execution class with an engine
// (suites-execution/agent-eval.conformance.test.ts): an eval run to its
// end, what each try runs and is given, delete and the agent's delete
// refused while it runs, cancel of a running eval, and listByAgent answering
// an eval without its tries (no eval here has tries to leave out).
import { Code } from "@connectrpc/connect";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  AGENT_EVAL_CREATE_DENIED_MESSAGE,
  AGENT_EVAL_NO_CASES_MESSAGE,
  AGENT_EVAL_NO_PLUGINS_MESSAGE,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  agentEvalOrgMismatchMessage,
  agentEvalOtherPluginToolMessage,
  agentEvalUnknownPluginMessage,
  awaitAgentEvalEnd,
  cancelAndDeleteAgentEval,
  createAgentWith,
  makeAgentEval,
  type AgentEvalOptions,
} from "../support/agent-evals";
import { makeAgent } from "../support/agents";
import { organizationRole, policyTriple } from "../support/iampolicies";
import { uniqueName, uniqueOrg } from "../support/naming";
import {
  PLUGIN_EVAL_NOT_STARTED_ERROR,
  type EvalCaseFixture,
  installPlugin,
  isActivePhase,
  lastMessageGrader,
  pluginEvalTooLargeMessage,
  skillFiredGrader,
  skillPluginWithEvals,
} from "../support/plugin-evals";
import { claudePlugin } from "../support/plugins";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
// Read at collection time so an edition without an engine (or without a
// capability) reports its cases SKIPPED, never as passes that returned
// early. `scheduleFiring` is the engine-backed flag the plugin-eval and
// create-mints-id suites gate the same boundary on.
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
  prefix = "aev",
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
async function installedWithoutEvals(prefix = "aev-bare"): Promise<Plugin> {
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
async function agentWith(plugins: readonly Plugin[], name = uniqueName("aev-agent")): Promise<Agent> {
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
function smallestEval(opts: AgentEvalOptions) {
  return makeAgentEval({ runs: 1, maxCostUsd: SMALLEST_LIMIT_USD, caseGlob: "first", ...opts });
}

// Creates the smallest eval of `agent` and defers its cleanup (cancel when
// it may still run, then delete), which runs before the agent's delete.
async function createEval(agent: Agent, opts: Partial<AgentEvalOptions> = {}) {
  const created = await clients.agentEvalCommand.create(
    smallestEval({ org: agent.metadata!.org, agentId: agent.metadata!.id, ...opts }),
  );
  fixtures.defer(() => cancelAndDeleteAgentEval(clients, created.metadata!.id));
  return created;
}

function stampedPlugins(agentEvalPlugins: ReadonlyArray<{ pluginId: string; pluginSlug: string; pluginDigest: string; notRunReason: string }>) {
  return agentEvalPlugins.map((p) => [p.pluginId, p.pluginSlug, p.pluginDigest, p.notRunReason]);
}

describe("AgentEval — create, get and listByAgent", () => {
  it("[rpc:AgentEvalCommandController.create] create stamps the agent's current version and every attached plugin with its digest and not-run reason, mints the eval's id and counts its tries", async () => {
    const notes = await installedWithEvals("aev-notes");
    const bare = await installedWithoutEvals();
    const extra = await installedWithEvals("aev-extra");
    const agent = await agentWith([notes, bare, extra]);
    const hash = agent.status?.versionHash ?? "";
    expect(hash, "the saved agent has a version").not.toBe("");

    const created = await createEval(agent, {
      plugins: [notes.metadata!.slug, bare.metadata!.slug],
      runs: 2,
    });

    expect(created.metadata?.id).toMatch(/^aev_[0-9a-z]{26}$/);
    expect(created.metadata?.org).toBe(tenancy.org);
    expect(created.spec?.agentId).toBe(agent.metadata!.id);
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

  it("[rpc:AgentEvalCommandController.create] create stamps the version it names by hash, though the agent was saved since", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("aev-agent");
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

  it("[rpc:AgentEvalQueryController.get] get answers what create stored", async () => {
    const notes = await installedWithEvals();
    const agent = await agentWith([notes]);
    const created = await createEval(agent, { caseGlob: "fir*" });

    const read = await clients.agentEvalQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.agentId).toBe(agent.metadata!.id);
    expect(read.spec?.agentVersion).toBe(agent.status!.versionHash);
    expect(read.spec?.caseGlob).toBe("fir*");
    expect(read.status?.agentVersionHash).toBe(agent.status!.versionHash);
    expect(stampedPlugins(read.status?.plugins ?? [])).toEqual(stampedPlugins(created.status?.plugins ?? []));
    expect(read.status?.triesTotal).toBe(1);
  });

  it("[rpc:AgentEvalQueryController.listByAgent] listByAgent answers the agent's evals newest first, and no other agent's", async () => {
    const notes = await installedWithEvals();
    const agent = await agentWith([notes]);
    const other = await agentWith([notes]);
    const first = await createEval(agent);
    const second = await createEval(agent);
    const elsewhere = await createEval(other);

    const list = await clients.agentEvalQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);
    expect(list.nextPageToken).toBe("");
    expect(list.entries.map((e) => e.metadata?.id)).not.toContain(elsewhere.metadata!.id);
  });
});

describe.skipIf(!capabilities.versionTagging)("AgentEval — a tagged version", () => {
  it("[rpc:AgentEvalCommandController.create] create resolves a tag to the tagged version's hash", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("aev-agent");
    const v1 = await agentWith([notes], name);
    await clients.agentCommand.tagVersion({ agentId: v1.metadata!.id, versionHash: v1.status!.versionHash, tag: "stable" });
    const v2 = await savedAgain(name, [notes], "Answer as the support desk, politely.");
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    const created = await createEval(v2, { agentVersion: "stable" });
    expect(created.spec?.agentVersion, "the tag is stamped as the hash it names").toBe(v1.status!.versionHash);
    expect(created.status?.agentVersionHash).toBe(v1.status!.versionHash);
  });
});

describe("AgentEval — create refusals", () => {
  it("[rpc:AgentEvalCommandController.create] an agent version that attaches no plugin is FAILED_PRECONDITION", async () => {
    const agent = await agentWith([]);
    const err = await expectGrpcCode(
      () => clients.agentEvalCommand.create(smallestEval({ org: tenancy.org, agentId: agent.metadata!.id })),
      Code.FailedPrecondition,
      "create on an agent that attaches no plugin",
    );
    expect(err.rawMessage).toBe(AGENT_EVAL_NO_PLUGINS_MESSAGE);
  });

  it("[rpc:AgentEvalCommandController.create] an earlier version that attaches no plugin is refused though the current one attaches some", async () => {
    const notes = await installedWithEvals();
    const name = uniqueName("aev-agent");
    const v1 = await agentWith([], name);
    const v2 = await savedAgain(name, [notes], "Answer as the support desk, politely.");
    const err = await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
          smallestEval({ org: tenancy.org, agentId: v1.metadata!.id, agentVersion: v1.status!.versionHash }),
        ),
      Code.FailedPrecondition,
      "create on an earlier version with no plugin",
    );
    expect(err.rawMessage).toBe(AGENT_EVAL_NO_PLUGINS_MESSAGE);
    const current = await createEval(v2);
    expect(current.status?.agentVersionHash, "the current version, which attaches the plugin, is accepted").toBe(
      v2.status!.versionHash,
    );
  });

  it("[rpc:AgentEvalCommandController.create] a spec.plugins slug the version does not attach is INVALID_ARGUMENT naming it, an installed plugin of the organization included", async () => {
    const notes = await installedWithEvals();
    const unattached = await installedWithEvals("aev-unattached");
    const agent = await agentWith([notes]);
    for (const slug of [unattached.metadata!.slug, "not-attached"]) {
      const err = await expectGrpcCode(
        () =>
          clients.agentEvalCommand.create(
            smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, plugins: [notes.metadata!.slug, slug] }),
          ),
        Code.InvalidArgument,
        `create selecting ${slug}, which the agent does not attach`,
      );
      expect(err.rawMessage).toBe(agentEvalUnknownPluginMessage(slug));
    }
  });

  it("[rpc:AgentEvalCommandController.create] an eval none of whose selected plugins has cases is FAILED_PRECONDITION, though another attached plugin has some", async () => {
    const bare = await installedWithoutEvals();
    const onlyBare = await agentWith([bare]);
    const err = await expectGrpcCode(
      () => clients.agentEvalCommand.create(smallestEval({ org: tenancy.org, agentId: onlyBare.metadata!.id })),
      Code.FailedPrecondition,
      "create on an agent none of whose plugins has cases",
    );
    expect(err.rawMessage).toBe(AGENT_EVAL_NO_CASES_MESSAGE);

    const notes = await installedWithEvals();
    const both = await agentWith([notes, bare]);
    const narrowed = await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
          smallestEval({ org: tenancy.org, agentId: both.metadata!.id, plugins: [bare.metadata!.slug] }),
        ),
      Code.FailedPrecondition,
      "create selecting only the plugin with no cases",
    );
    expect(narrowed.rawMessage).toBe(AGENT_EVAL_NO_CASES_MESSAGE);
  });

  it("[rpc:AgentEvalCommandController.create] an organization that is not the agent's is FAILED_PRECONDITION naming the agent's", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const other = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(other));
    const err = await expectGrpcCode(
      () => clients.agentEvalCommand.create(smallestEval({ org: other.org, agentId: agent.metadata!.id })),
      Code.FailedPrecondition,
      "create in another organization",
    );
    expect(err.rawMessage).toBe(agentEvalOrgMismatchMessage(tenancy.org));
  });

  it("[rpc:AgentEvalCommandController.create] a version the agent does not hold, by hash or by tag, is NOT_FOUND", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    for (const version of ["9".repeat(64), "no-such-tag"]) {
      await expectGrpcCode(
        () =>
          clients.agentEvalCommand.create(
            smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, agentVersion: version }),
          ),
        Code.NotFound,
        `create naming version ${version}`,
      );
    }
  });

  it("[rpc:AgentEvalCommandController.create] an agent that does not exist is NOT_FOUND", async () => {
    await expectGrpcCode(
      () => clients.agentEvalCommand.create(smallestEval({ org: tenancy.org, agentId: "agt_01jzzzzzzzzzzzzzzzzzzzzzzz" })),
      Code.NotFound,
      "create on a missing agent",
    );
  });

  it("[rpc:AgentEvalCommandController.create] an allow_tools entry naming a server of no attached plugin is INVALID_ARGUMENT; one naming an attached plugin's server is kept as written, its cases run or not", async () => {
    const notes = await installedWithEvals();
    const tracker = await installedWithEvals("aev-tracker", {
      mcpServers: { github: { type: "http", url: "https://github.mock.invalid/mcp" } },
    });
    const agent = await agentWith([notes, tracker]);
    const foreign = "mcp__plugin_someone-else_github__*";
    const err = await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
          smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, allowTools: ["Skill", foreign] }),
        ),
      Code.InvalidArgument,
      "create granting a server no attached plugin has",
    );
    expect(err.rawMessage).toBe(agentEvalOtherPluginToolMessage(foreign, "plugin_someone-else_github"));

    // The tracker plugin is attached but left out of spec.plugins: a try
    // still attaches it, so a grant naming its server is the agent's.
    const own = `mcp__plugin_${tracker.metadata!.name}_github__*`;
    const created = await createEval(agent, { plugins: [notes.metadata!.slug], allowTools: ["Skill", own] });
    expect(created.spec?.allowTools).toEqual(["Skill", own]);
    expect(created.status?.plugins.map((p) => p.notRunReason)).toEqual(["", PLUGIN_NOT_SELECTED_REASON]);
  });

  it("[rpc:AgentEvalCommandController.create] a target model the catalog does not know is INVALID_ARGUMENT naming the target", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const err = await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
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

  it("[rpc:AgentEvalCommandController.create] cases past the limits, counted across every plugin, are FAILED_PRECONDITION with the computed counts", async () => {
    const agent = await agentWith([await installedWithEvals("aev-one"), await installedWithEvals("aev-two")]);
    // 2 plugins x 2 cases x 6 targets x 50 tries = 1200 tries, past the 1000
    // an eval may run, though each plugin alone (600) is within them.
    const err = await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
          makeAgentEval({
            org: tenancy.org,
            agentId: agent.metadata!.id,
            runs: 50,
            targets: Array.from({ length: 6 }, () => ({ harness: Harness.NATIVE, modelName: "" })),
          }),
        ),
      Code.FailedPrecondition,
      "create of cases past the limits",
    );
    expect(err.rawMessage).toBe(pluginEvalTooLargeMessage(4, 1200));
  });

  it("[rpc:AgentEvalQueryController.listByAgent] a refused create stores nothing", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    await expectGrpcCode(
      () =>
        clients.agentEvalCommand.create(
          smallestEval({ org: tenancy.org, agentId: agent.metadata!.id, plugins: ["not-attached"] }),
        ),
      Code.InvalidArgument,
      "create selecting a plugin the agent does not attach",
    );
    const list = await clients.agentEvalQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toEqual([]);
  });
});

describe.skipIf(capabilities.scheduleFiring)("AgentEval — without an engine behind the server", () => {
  it("[rpc:AgentEvalCommandController.create] create stores the eval failed, naming why it could not start", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await createEval(agent);
    expect(created.status?.phase).toBe(PluginEvalPhase.failed);
    expect(created.status?.error).toBe(PLUGIN_EVAL_NOT_STARTED_ERROR);
    expect(created.status?.plugins, "the failed eval keeps its stamped plugins").toHaveLength(1);
    const read = await clients.agentEvalQuery.get({ value: created.metadata!.id });
    expect(read.status?.phase).toBe(PluginEvalPhase.failed);
    expect(read.status?.error).toBe(PLUGIN_EVAL_NOT_STARTED_ERROR);
  });

  it("[rpc:AgentEvalCommandController.cancel] cancel of an eval that has ended changes nothing", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await createEval(agent);
    const before = await clients.agentEvalQuery.get({ value: created.metadata!.id });

    const cancelled = await clients.agentEvalCommand.cancel({ value: created.metadata!.id });
    expect(cancelled.status?.phase).toBe(PluginEvalPhase.failed);
    const after = await clients.agentEvalQuery.get({ value: created.metadata!.id });
    expect(after.status).toEqual(before.status);
  });

  it("[rpc:AgentEvalCommandController.delete] delete removes the eval", async () => {
    const agent = await agentWith([await installedWithEvals()]);
    const created = await clients.agentEvalCommand.create(
      smallestEval({ org: tenancy.org, agentId: agent.metadata!.id }),
    );
    const deleted = await clients.agentEvalCommand.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata!.id);
    await expectGrpcCode(
      () => clients.agentEvalQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
    const list = await clients.agentEvalQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toEqual([]);
  });

  it("deleting the agent deletes its evals", async () => {
    const notes = await installedWithEvals();
    // Its own tracker: the agent is deleted here, and its evals with it.
    const agent = await createAgentWith(clients, new FixtureTracker(), tenancy.org, [notes], {
      name: uniqueName("aev-cascade"),
      instructions: AGENT_INSTRUCTIONS,
    });
    const created = await clients.agentEvalCommand.create(
      smallestEval({ org: tenancy.org, agentId: agent.metadata!.id }),
    );
    await clients.agentCommand.delete({ value: agent.metadata!.id });
    await expectGrpcCode(
      () => clients.agentEvalQuery.get({ value: created.metadata!.id }),
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
describe("AgentEval — who may run and read an eval", () => {
  async function laneTenancy(lane: EnforcingLane): Promise<TenancyContext> {
    const context = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(context));
    return context;
  }

  // An agent listing one installed plugin with eval cases, both saved by the
  // founder at `visibility` (the agent may not be more visible than its plugin).
  async function laneAgent(lane: EnforcingLane, org: string, visibility?: ApiResourceVisibility): Promise<Agent> {
    const plugin = await installedWithEvals("aev-authz", { org, as: lane.clients, visibility });
    return createAgentWith(lane.clients, fixtures, org, [plugin], {
      name: uniqueName("aev-authz-agent"),
      instructions: AGENT_INSTRUCTIONS,
      ...(visibility === undefined ? {} : { visibility }),
    });
  }

  // `as`'s eval of `agent`, cleaned up by the founder before the agent.
  async function laneEval(lane: EnforcingLane, as: ConformanceClients, agent: Agent) {
    const created = await as.agentEvalCommand.create(
      smallestEval({ org: agent.metadata!.org, agentId: agent.metadata!.id }),
    );
    const id = created.metadata!.id;
    fixtures.defer(async () => {
      const current = await lane.clients.agentEvalQuery.get({ value: id }).catch(() => undefined);
      if (current !== undefined) await cancelAndDeleteAgentEval(lane.clients, id);
    });
    return created;
  }

  // Cancels eval `id` as `as`, waits for its end, deletes it as `as`, and
  // proves it gone.
  async function cancelAndDeleteAs(lane: EnforcingLane, as: ConformanceClients, id: string): Promise<void> {
    const cancelled = await as.agentEvalCommand.cancel({ value: id });
    expect(cancelled.metadata?.id).toBe(id);
    if (isActivePhase((await lane.clients.agentEvalQuery.get({ value: id })).status?.phase)) {
      await awaitAgentEvalEnd(lane.clients, id, 60_000);
    }
    const deleted = await as.agentEvalCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);
    await expectGrpcCode(() => lane.clients.agentEvalQuery.get({ value: id }), Code.NotFound, "get after the delete");
  }

  // A fresh person holding exactly `role` in `org`, granted by the founder.
  async function personWith(lane: EnforcingLane, org: string, role: string): Promise<ConformanceClients> {
    const person = await lane.provisionIdentity();
    await lane.clients.iamPolicyCommand.create(organizationRole(await lane.accountIdOf(person), role, org));
    return person;
  }

  it("[rpc:AgentEvalCommandController.create] [rpc:AgentEvalCommandController.cancel] [rpc:AgentEvalCommandController.delete] the agent's owner creates, cancels and deletes its evals; a member who only views the agent does none of them", async (ctx) => {
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
      () => member.agentEvalCommand.create(smallestEval({ org, agentId })),
      Code.PermissionDenied,
      "a member who cannot edit the agent starting an eval",
    );
    expect(refused.rawMessage).toBe(AGENT_EVAL_CREATE_DENIED_MESSAGE);
    expect((await lane.clients.agentEvalQuery.listByAgent({ agentId })).entries, "the refused create stored nothing").toEqual([]);

    const created = await laneEval(lane, lane.clients, agent);
    const id = created.metadata!.id;
    const before = await lane.clients.agentEvalQuery.get({ value: id });
    await expectGrpcCode(
      () => member.agentEvalCommand.cancel({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the agent cancelling its eval",
    );
    await expectGrpcCode(
      () => member.agentEvalCommand.delete({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the agent deleting its eval",
    );
    const after = await lane.clients.agentEvalQuery.get({ value: id });
    expect(after.metadata?.id, "the refused delete left the eval").toBe(id);
    expect(after.status?.partialReason, "the refused cancel changed nothing").toBe(before.status?.partialReason);

    await cancelAndDeleteAs(lane, lane.clients, id);
  });

  it("[rpc:AgentEvalCommandController.create] [rpc:AgentEvalCommandController.cancel] [rpc:AgentEvalCommandController.delete] a person granted editor on the agent creates, cancels and deletes its evals", async (ctx) => {
    if (!capabilities.perResourceGrants) {
      return ctx.skip("the edition grants roles on organizations only, so no one can be made an editor of one agent");
    }
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const agent = await laneAgent(lane, org, ApiResourceVisibility.visibility_private);
    const editor = await lane.provisionMember({ org });
    await lane.clients.iamPolicyCommand.create(
      policyTriple({ kind: "identity_account", id: await lane.accountIdOf(editor) }, "editor", {
        kind: "agent",
        id: agent.metadata!.id,
      }),
    );

    const created = await laneEval(lane, editor, agent);
    expect(created.spec?.agentVersion).toBe(agent.status!.versionHash);
    expect((await editor.agentEvalQuery.get({ value: created.metadata!.id })).metadata?.id).toBe(created.metadata!.id);
    await cancelAndDeleteAs(lane, editor, created.metadata!.id);
  });

  it("[rpc:AgentEvalQueryController.get] [rpc:AgentEvalQueryController.listByAgent] a viewer of the agent in its own organization reads and lists its evals", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const agent = await laneAgent(lane, org);
    const created = await laneEval(lane, lane.clients, agent);
    const viewer = await lane.provisionMember({ org });

    const read = await viewer.agentEvalQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.agentId).toBe(agent.metadata!.id);
    const list = await viewer.agentEvalQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries.map((e) => e.metadata?.id)).toEqual([created.metadata!.id]);
  });

  it("[rpc:AgentEvalQueryController.get] [rpc:AgentEvalQueryController.listByAgent] [rpc:AgentEvalCommandController.create] a person who cannot view the agent reads, lists and starts nothing: another organization's person, and a member when the agent is private", async (ctx) => {
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
      await expectGrpcCode(() => as.agentEvalQuery.get({ value: evalId }), Code.PermissionDenied, `${who} reading the eval`);
      await expectGrpcCode(
        () => as.agentEvalQuery.listByAgent({ agentId: agent.metadata!.id }),
        Code.PermissionDenied,
        `${who} listing the agent's evals`,
      );
      const refused = await expectGrpcCode(
        () => as.agentEvalCommand.create(smallestEval({ org, agentId: agent.metadata!.id })),
        Code.PermissionDenied,
        `${who} starting an eval`,
      );
      expect(refused.rawMessage).toBe(AGENT_EVAL_CREATE_DENIED_MESSAGE);
    }
  });

  it("[rpc:AgentEvalQueryController.listByAgent] [rpc:AgentEvalQueryController.get] a child organization's viewer of an agent its parent shares lists none of its evals and reads none", async (ctx) => {
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
    const list = await childViewer.agentEvalQuery.listByAgent({ agentId });
    expect(list.entries, "a try spends the parent's money: the child's viewer lists no eval").toEqual([]);
    await expectGrpcCode(
      () => childViewer.agentEvalQuery.get({ value: created.metadata!.id }),
      Code.PermissionDenied,
      "a child organization's viewer reading the parent's eval",
    );
  });
});
