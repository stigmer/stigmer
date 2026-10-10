// Conformance suite for the PluginEval domain: an eval of an installed
// plugin's own evals/ cases, created, read and refused; no test here waits
// on a try.
// Domain: agentic / plugineval — one run of a plugin's suite, a child of its
// plugin.
//
// What is pinned here, on every edition:
//   - create on an installed plugin whose archive carries evals/ stamps the
//     plugin's current digest, mints the eval's own id, counts its tries
//     (cases x targets x arms x runs) and marks the comparison provisional;
//   - get answers what create stored; listByPlugin answers the plugin's
//     evals newest first, and no other plugin's;
//   - create refuses, before anything is stored: a plugin version with no
//     evals/ or with no case in it, a digest that is not the plugin's
//     current version, an organization that is not the plugin's, a target
//     model the catalog does not know, a suite past the limits (with the
//     computed counts), an allow_tools entry naming another plugin's MCP
//     tools, and a plugin that does not exist.
// Without an engine behind the server (the plain local targets), create
// cannot start the eval's workflow: the eval is stored and answered failed,
// naming why, cancelling it changes nothing, and delete removes it.
//
// On an engine-backed target every create that is accepted starts the
// eval's workflow, which runs real tries (spending, or taking the mock
// model's scripted turns) until cleanup cancels it. So every eval this file
// creates on such a target is the smallest: no comparison arm
// (`ablation: none`), one case, one try unless a test counts tries, and the
// floor of a try's budget as its spending limit. Doubling by the comparison
// arm is pinned by the server's own create tests.
//
// Who may run and read an eval is pinned here too, on the target's
// enforcing lane (the cloud's primary; open source's OIDC sibling, where
// the built-in Authorizer evaluates the model): the plugin's owner
// creates, cancels and deletes its evals and a member who only views the
// plugin does none of them; a viewer of the plugin in its own organization
// gets and lists them; a person who cannot view the plugin (another
// organization's, or a member when the plugin is private) is refused get,
// listByPlugin and create with PERMISSION_DENIED; and a child
// organization's viewer of a plugin its parent shares gets an empty
// listByPlugin and is refused get, because a try spends the parent's
// credit. A target with no enforcing lane skips those arms visibly. The
// relations themselves are the authorization model's store tests
// (backend/services/stigmer-server/fga/tests/plugin-eval-access.fga.yaml).
//
// Out of scope here, pinned in the execution class with an engine
// (suites-execution/plugin-eval.conformance.test.ts): an eval answered
// pending and run to its end, delete refused while it runs (naming cancel),
// cancel of a finished eval, and delete removing its tries' conversations.
import { Code } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { organizationRole } from "../support/iampolicies";
import { uniqueName, uniqueOrg } from "../support/naming";
import {
  NO_ENGINE_CAUSE,
  PLUGIN_EVAL_CREATE_DENIED_MESSAGE,
  type EvalCaseFixture,
  awaitPluginEvalEnd,
  cancelAndDeletePluginEval,
  installPlugin,
  isActivePhase,
  lastMessageGrader,
  makePluginEval,
  pluginEvalNoCasesMessage,
  pluginEvalNotStartedMessage,
  pluginEvalOrgMismatchMessage,
  pluginEvalOtherPluginToolMessage,
  pluginEvalTooLargeMessage,
  pluginEvalNotCurrentVersionMessage,
  skillFiredGrader,
  skillPluginWithEvals,
  withEvalCases,
  type PluginEvalOptions,
} from "../support/plugin-evals";
import { claudePlugin, withFile } from "../support/plugins";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
// Read at collection time so an edition without an engine reports its cases
// SKIPPED (the conformance guide's rule), never as passes that returned early.
// `scheduleFiring` is the engine-backed flag the run and create-mints-id
// suites gate the same boundary on.
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

// A plugin of one skill and no evals/ (the cases go on with withEvalCases).
function notesPlugin(prefix: string) {
  const name = uniqueName(prefix);
  return claudePlugin({ name, skills: [{ name: skillOf(name), description: "Notes", body: "# Notes" }] });
}

function caseNamed(name: string, skill = "release-notes"): EvalCaseFixture {
  return {
    name,
    prompt: "Write release notes for: renamed getUser to fetchUser.",
    frontmatter: { allowed_tools: ["Read", "Skill"] },
    graders: [skillFiredGrader(skill), lastMessageGrader("says-done", "DONE")],
  };
}

// A plugin with one skill and two cases, installed in the file's tenancy.
async function installedWithEvals() {
  const name = uniqueName("pev");
  const skill = skillOf(name);
  return installPlugin(
    clients,
    fixtures,
    tenancy.org,
    skillPluginWithEvals(name, { skill, cases: [caseNamed("first", skill), caseNamed("second", skill)] }),
  );
}

// The spending limit of the smallest eval: the floor of a try's budget.
const SMALLEST_LIMIT_USD = 0.01;

// The smallest eval a test may start (the header says why): one arm, one
// try, the floor of a try's budget; `opts` overrides.
function smallestEval(opts: PluginEvalOptions) {
  return makePluginEval({ ablation: PluginEvalAblation.none, runs: 1, maxCostUsd: SMALLEST_LIMIT_USD, ...opts });
}

// Creates the smallest eval of `plugin`'s first case and defers its cleanup
// (cancel when it may still run, then delete), which must run before its
// plugin's delete.
async function createEval(plugin: Plugin, opts: Partial<PluginEvalOptions> = {}) {
  const created = await clients.pluginEvalCommand.create(
    smallestEval({ org: tenancy.org, pluginId: plugin.metadata!.id, caseGlob: "first", ...opts }),
  );
  fixtures.defer(() => cancelAndDeletePluginEval(clients, created.metadata!.id));
  return created;
}

describe("PluginEval — create, get and listByPlugin", () => {
  it("[rpc:PluginEvalCommandController.create] create stamps the current digest, mints the eval's id, counts its tries and marks the comparison provisional", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin, { runs: 3 });

    expect(created.metadata?.id).toMatch(/^pev_[0-9a-z]{26}$/);
    expect(created.metadata?.org).toBe(tenancy.org);
    expect(created.spec?.pluginId).toBe(plugin.metadata!.id);
    expect(created.spec?.pluginDigest, "an empty digest is stamped with the current version").toBe(
      plugin.status!.digest,
    );
    // One case kept by the glob, the case's own (default) target, one arm, three tries.
    expect(created.status?.triesTotal).toBe(3);
    expect(created.status?.triesFinished ?? 0).toBe(0);
    expect(created.status?.provisionalDelta).toBe(true);
  });

  it("[rpc:PluginEvalQueryController.get] get answers what create stored", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin, { caseGlob: "fir*" });

    const read = await clients.pluginEvalQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.pluginDigest).toBe(plugin.status!.digest);
    expect(read.spec?.ablation).toBe(PluginEvalAblation.none);
    expect(read.spec?.caseGlob).toBe("fir*");
    // One case kept by the glob, one arm, one try.
    expect(read.status?.triesTotal).toBe(1);
  });

  it("[rpc:PluginEvalQueryController.listByPlugin] listByPlugin answers the plugin's evals newest first, and no other plugin's", async () => {
    const plugin = await installedWithEvals();
    const other = await installedWithEvals();
    const first = await createEval(plugin);
    const second = await createEval(plugin);
    const elsewhere = await createEval(other);

    const list = await clients.pluginEvalQuery.listByPlugin({ pluginId: plugin.metadata!.id });
    expect(list.items.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);
    expect(list.totalCount).toBe(2);
    expect(list.items.map((e) => e.metadata?.id)).not.toContain(elsewhere.metadata!.id);
  });
});

describe("PluginEval — create refusals", () => {
  it("[rpc:PluginEvalCommandController.create] a plugin version with no evals/ is FAILED_PRECONDITION naming where cases go", async () => {
    const plugin = await installPlugin(
      clients,
      fixtures,
      tenancy.org,
      notesPlugin("pev-none"),
    );
    const err = await expectGrpcCode(
      () => clients.pluginEvalCommand.create(makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id })),
      Code.FailedPrecondition,
      "create on a plugin with no evals/",
    );
    expect(err.rawMessage).toBe(pluginEvalNoCasesMessage("evals"));
  });

  it("[rpc:PluginEvalCommandController.create] an evals/ holding no case is FAILED_PRECONDITION too", async () => {
    const plugin = await installPlugin(
      clients,
      fixtures,
      tenancy.org,
      withFile(
        notesPlugin("pev-empty"),
        "evals/README.md",
        "Cases go here.\n",
      ),
    );
    const err = await expectGrpcCode(
      () => clients.pluginEvalCommand.create(makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id })),
      Code.FailedPrecondition,
      "create on a plugin whose evals/ holds no case",
    );
    expect(err.rawMessage).toBe(pluginEvalNoCasesMessage("evals"));
  });

  it("[rpc:PluginEvalCommandController.create] a digest that is not the plugin's current version is FAILED_PRECONDITION naming the current one", async () => {
    const plugin = await installedWithEvals();
    const digest = "0".repeat(64);
    const err = await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id, pluginDigest: digest }),
        ),
      Code.FailedPrecondition,
      "create naming a digest other than the current version",
    );
    expect(err.rawMessage).toBe(pluginEvalNotCurrentVersionMessage(plugin.status!.digest));
  });

  it("[rpc:PluginEvalCommandController.create] an organization that is not the plugin's is FAILED_PRECONDITION naming the plugin's", async () => {
    const plugin = await installedWithEvals();
    const other = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(other));
    const err = await expectGrpcCode(
      () => clients.pluginEvalCommand.create(makePluginEval({ org: other.org, pluginId: plugin.metadata!.id })),
      Code.FailedPrecondition,
      "create in another organization",
    );
    expect(err.rawMessage).toBe(pluginEvalOrgMismatchMessage(tenancy.org));
  });

  it("[rpc:PluginEvalCommandController.create] a target model the catalog does not know is INVALID_ARGUMENT naming the target", async () => {
    const plugin = await installedWithEvals();
    const err = await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({
            org: tenancy.org,
            pluginId: plugin.metadata!.id,
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

  it("[rpc:PluginEvalCommandController.create] a suite past the limits is FAILED_PRECONDITION with the computed counts", async () => {
    const plugin = await installedWithEvals();
    // 2 cases x 6 targets x 2 arms x 50 tries = 1200 tries, past the 1000 an eval may run.
    const err = await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({
            org: tenancy.org,
            pluginId: plugin.metadata!.id,
            runs: 50,
            targets: Array.from({ length: 6 }, () => ({ harness: Harness.NATIVE, modelName: "" })),
          }),
        ),
      Code.FailedPrecondition,
      "create of a suite past the limits",
    );
    expect(err.rawMessage).toBe(pluginEvalTooLargeMessage(2, 1200));
  });

  it("[rpc:PluginEvalCommandController.create] an allow_tools entry naming another plugin's MCP tools is INVALID_ARGUMENT", async () => {
    const plugin = await installedWithEvals();
    const entry = "mcp__plugin_someone-else_github__*";
    const err = await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id, allowTools: [entry] }),
        ),
      Code.InvalidArgument,
      "create granting another plugin's tools",
    );
    expect(err.rawMessage).toBe(pluginEvalOtherPluginToolMessage(entry, "someone-else", plugin.metadata!.slug));
  });

  it("[rpc:PluginEvalCommandController.create] a plugin that does not exist is NOT_FOUND", async () => {
    await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({ org: tenancy.org, pluginId: "plg_01jzzzzzzzzzzzzzzzzzzzzzzz" }),
        ),
      Code.NotFound,
      "create on a missing plugin",
    );
  });

  it("[rpc:PluginEvalQueryController.listByPlugin] a refused create stores nothing", async () => {
    const plugin = await installedWithEvals();
    await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id, pluginDigest: "f".repeat(64) }),
        ),
      Code.FailedPrecondition,
      "create naming a digest other than the current version",
    );
    const list = await clients.pluginEvalQuery.listByPlugin({ pluginId: plugin.metadata!.id });
    expect(list.items).toEqual([]);
  });
});

describe.skipIf(capabilities.scheduleFiring)("PluginEval — without an engine behind the server", () => {
  it("[rpc:PluginEvalCommandController.create] create stores the eval failed, naming why it could not start", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin);
    expect(created.status?.phase).toBe(PluginEvalPhase.failed);
    expect(created.status?.error).toBe(pluginEvalNotStartedMessage(NO_ENGINE_CAUSE));
    const read = await clients.pluginEvalQuery.get({ value: created.metadata!.id });
    expect(read.status?.phase).toBe(PluginEvalPhase.failed);
  });

  it("[rpc:PluginEvalCommandController.cancel] cancel of an eval that has ended changes nothing", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin);
    const before = await clients.pluginEvalQuery.get({ value: created.metadata!.id });

    const cancelled = await clients.pluginEvalCommand.cancel({ value: created.metadata!.id });
    expect(cancelled.status?.phase).toBe(PluginEvalPhase.failed);
    const after = await clients.pluginEvalQuery.get({ value: created.metadata!.id });
    expect(after.status?.phase).toBe(PluginEvalPhase.failed);
    expect(after.status?.partialReason).toBe(before.status?.partialReason);
    expect(after.status?.error).toBe(before.status?.error);
    expect(after.status?.finishedAt).toEqual(before.status?.finishedAt);
  });

  it("[rpc:PluginEvalCommandController.delete] delete removes the eval", async () => {
    const plugin = await installedWithEvals();
    const created = await clients.pluginEvalCommand.create(
      makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id }),
    );
    const deleted = await clients.pluginEvalCommand.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata!.id);
    await expectGrpcCode(
      () => clients.pluginEvalQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
    const list = await clients.pluginEvalQuery.listByPlugin({ pluginId: plugin.metadata!.id });
    expect(list.items).toEqual([]);
  });

  it("deleting the plugin deletes its evals", async () => {
    const plugin = await installPlugin(
      clients,
      new FixtureTracker(),
      tenancy.org,
      withEvalCases(notesPlugin("pev-cascade"), [caseNamed("only")]),
    );
    const created = await clients.pluginEvalCommand.create(
      makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id }),
    );
    await clients.pluginCommand.delete({ value: plugin.metadata!.id });
    await expectGrpcCode(
      () => clients.pluginEvalQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get of an eval whose plugin was deleted",
    );
  });
});

// ─── Who may run and read an eval, on a server that enforces it ─────────────

// The arms below run on the target's enforcing lane: the primary on the
// cloud, open source's OIDC sibling on the local targets (where the
// built-in Authorizer evaluates the model). A target with no lane skips
// them visibly. The lane's founder created the organization, so it is an
// admin there, and only an admin installs a plugin: the founder is every
// plugin's owner below.
describe("PluginEval — who may run and read an eval", () => {
  async function laneTenancy(lane: EnforcingLane): Promise<TenancyContext> {
    const context = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(context));
    return context;
  }

  // A plugin with one skill and one case, installed by the founder.
  async function laneInstalled(
    lane: EnforcingLane,
    org: string,
    visibility?: ApiResourceVisibility,
  ): Promise<Plugin> {
    const name = uniqueName("pev-authz");
    const skill = skillOf(name);
    return installPlugin(
      lane.clients,
      fixtures,
      org,
      skillPluginWithEvals(name, { skill, cases: [caseNamed("only", skill)] }),
      visibility,
    );
  }

  // The founder's eval of `plugin`, cleaned up before the plugin.
  async function laneEval(lane: EnforcingLane, org: string, plugin: Plugin) {
    const created = await lane.clients.pluginEvalCommand.create(
      smallestEval({ org, pluginId: plugin.metadata!.id }),
    );
    const id = created.metadata!.id;
    fixtures.defer(async () => {
      const current = await lane.clients.pluginEvalQuery.get({ value: id }).catch(() => undefined);
      if (current !== undefined) await cancelAndDeletePluginEval(lane.clients, id);
    });
    return created;
  }

  // A fresh person holding exactly `role` in `org`, granted by the founder.
  async function personWith(lane: EnforcingLane, org: string, role: string): Promise<ConformanceClients> {
    const person = await lane.provisionIdentity();
    await lane.clients.iamPolicyCommand.create(organizationRole(await lane.accountIdOf(person), role, org));
    return person;
  }

  it("[rpc:PluginEvalCommandController.create] [rpc:PluginEvalCommandController.cancel] [rpc:PluginEvalCommandController.delete] the plugin's owner creates, cancels and deletes its evals; a member who only views the plugin does none of them", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const plugin = await laneInstalled(lane, org);
    const pluginId = plugin.metadata!.id;
    const member = await lane.provisionMember({ org });
    expect(
      (await member.pluginQuery.get({ value: pluginId })).metadata?.id,
      "the member views the organization's plugin",
    ).toBe(pluginId);

    const refused = await expectGrpcCode(
      () => member.pluginEvalCommand.create(makePluginEval({ org, pluginId })),
      Code.PermissionDenied,
      "a member who cannot edit the plugin starting an eval",
    );
    expect(refused.rawMessage).toBe(PLUGIN_EVAL_CREATE_DENIED_MESSAGE);
    expect(
      (await lane.clients.pluginEvalQuery.listByPlugin({ pluginId })).items,
      "the refused create stored nothing",
    ).toEqual([]);

    const created = await laneEval(lane, org, plugin);
    const id = created.metadata!.id;
    const before = await lane.clients.pluginEvalQuery.get({ value: id });
    await expectGrpcCode(
      () => member.pluginEvalCommand.cancel({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the plugin cancelling its eval",
    );
    await expectGrpcCode(
      () => member.pluginEvalCommand.delete({ value: id }),
      Code.PermissionDenied,
      "a member who cannot edit the plugin deleting its eval",
    );
    const after = await lane.clients.pluginEvalQuery.get({ value: id });
    expect(after.metadata?.id, "the refused delete left the eval").toBe(id);
    expect(after.status?.partialReason, "the refused cancel changed nothing").toBe(before.status?.partialReason);

    const cancelled = await lane.clients.pluginEvalCommand.cancel({ value: id });
    expect(cancelled.metadata?.id).toBe(id);
    if (isActivePhase((await lane.clients.pluginEvalQuery.get({ value: id })).status?.phase)) {
      await awaitPluginEvalEnd(lane.clients, id, 60_000);
    }
    const deleted = await lane.clients.pluginEvalCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);
    await expectGrpcCode(
      () => lane.clients.pluginEvalQuery.get({ value: id }),
      Code.NotFound,
      "get after the owner's delete",
    );
  });

  it("[rpc:PluginEvalQueryController.get] [rpc:PluginEvalQueryController.listByPlugin] a viewer of the plugin in its own organization reads and lists its evals", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const plugin = await laneInstalled(lane, org);
    const created = await laneEval(lane, org, plugin);
    const viewer = await lane.provisionMember({ org });

    const read = await viewer.pluginEvalQuery.get({ value: created.metadata!.id });
    expect(read.metadata?.id).toBe(created.metadata!.id);
    expect(read.spec?.pluginId).toBe(plugin.metadata!.id);
    const list = await viewer.pluginEvalQuery.listByPlugin({ pluginId: plugin.metadata!.id });
    expect(list.items.map((e) => e.metadata?.id)).toEqual([created.metadata!.id]);
  });

  it("[rpc:PluginEvalQueryController.get] [rpc:PluginEvalQueryController.listByPlugin] [rpc:PluginEvalCommandController.create] a person who cannot view the plugin reads, lists and starts nothing: another organization's person, and a member when the plugin is private", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const org = (await laneTenancy(lane)).org;
    const shared = await laneInstalled(lane, org);
    const sharedEval = await laneEval(lane, org, shared);
    const hidden = await laneInstalled(lane, org, ApiResourceVisibility.visibility_private);
    const hiddenEval = await laneEval(lane, org, hidden);
    const outsider = await lane.provisionIdentity();
    const member = await lane.provisionMember({ org });

    const cases: ReadonlyArray<{ who: string; as: ConformanceClients; plugin: Plugin; evalId: string }> = [
      { who: "another organization's person", as: outsider, plugin: shared, evalId: sharedEval.metadata!.id },
      { who: "a member, of a private plugin", as: member, plugin: hidden, evalId: hiddenEval.metadata!.id },
    ];
    for (const { who, as, plugin, evalId } of cases) {
      await expectGrpcCode(
        () => as.pluginEvalQuery.get({ value: evalId }),
        Code.PermissionDenied,
        `${who} reading the eval`,
      );
      await expectGrpcCode(
        () => as.pluginEvalQuery.listByPlugin({ pluginId: plugin.metadata!.id }),
        Code.PermissionDenied,
        `${who} listing the plugin's evals`,
      );
      const refused = await expectGrpcCode(
        () => as.pluginEvalCommand.create(makePluginEval({ org, pluginId: plugin.metadata!.id })),
        Code.PermissionDenied,
        `${who} starting an eval`,
      );
      expect(refused.rawMessage).toBe(PLUGIN_EVAL_CREATE_DENIED_MESSAGE);
    }
  });

  it("[rpc:PluginEvalQueryController.listByPlugin] [rpc:PluginEvalQueryController.get] a child organization's viewer of a plugin its parent shares lists none of its evals and reads none", async (ctx) => {
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
    const plugin = await laneInstalled(lane, parent, ApiResourceVisibility.visibility_child_orgs);
    const pluginId = plugin.metadata!.id;
    const created = await laneEval(lane, parent, plugin);
    const childViewer = await personWith(lane, childOrg, "viewer");

    expect(
      (await childViewer.pluginQuery.get({ value: pluginId })).metadata?.id,
      "the child's viewer views the plugin its parent shares",
    ).toBe(pluginId);
    const list = await childViewer.pluginEvalQuery.listByPlugin({ pluginId });
    expect(list.items, "a try spends the parent's credit: the child's viewer lists no eval").toEqual([]);
    await expectGrpcCode(
      () => childViewer.pluginEvalQuery.get({ value: created.metadata!.id }),
      Code.PermissionDenied,
      "a child organization's viewer reading the parent's eval",
    );
  });
});
