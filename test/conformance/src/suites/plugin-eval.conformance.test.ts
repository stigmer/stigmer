// Conformance suite for the PluginEval domain: an eval of an installed
// plugin's own evals/ cases, created, read and refused with no engine.
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
//     evals/ or with no case in it, a digest that names no version of the
//     plugin, an organization that is not the plugin's, a target model the
//     catalog does not know, a suite past the limits (with the computed
//     counts), an allow_tools entry naming another plugin's MCP tools, and
//     a plugin that does not exist.
// Without an engine behind the server (the plain local targets), create
// cannot start the eval's workflow: the eval is stored and answered failed,
// naming why, cancelling it changes nothing, and delete removes it.
//
// Out of scope here, pinned in the execution class with an engine
// (suites-execution/plugin-eval.conformance.test.ts): an eval answered
// pending and run to its end, delete refused while it runs (naming cancel),
// cancel of a finished eval, and delete removing its tries' conversations.
// Who may create and read an eval is the server's composed suite
// (backend/services/stigmer-server/src/domain/plugin-eval/__tests__/plugin-eval.test.ts).
import { Code } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  NO_ENGINE_CAUSE,
  type EvalCaseFixture,
  cancelAndDeletePluginEval,
  installPlugin,
  lastMessageGrader,
  makePluginEval,
  pluginEvalNoCasesMessage,
  pluginEvalNotStartedMessage,
  pluginEvalOrgMismatchMessage,
  pluginEvalOtherPluginToolMessage,
  pluginEvalTooLargeMessage,
  pluginEvalUnknownDigestMessage,
  skillFiredGrader,
  skillPluginWithEvals,
  withEvalCases,
  type PluginEvalOptions,
} from "../support/plugin-evals";
import { claudePlugin, withFile } from "../support/plugins";
import { createTarget, type TargetProfile } from "../targets";
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

// Creates an eval and defers its cleanup (cancel when it may still run,
// then delete), which must run before its plugin's delete.
async function createEval(plugin: Plugin, opts: Partial<PluginEvalOptions> = {}) {
  const created = await clients.pluginEvalCommand.create(
    makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id, ...opts }),
  );
  fixtures.defer(() => cancelAndDeletePluginEval(clients, created.metadata!.id));
  return created;
}

describe("PluginEval — create, get and listByPlugin", () => {
  it("[rpc:PluginEvalCommandController.create] create stamps the current digest, mints the eval's id, counts its tries and marks the comparison provisional", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin, { runs: 2 });

    expect(created.metadata?.id).toMatch(/^pev_[0-9a-z]{26}$/);
    expect(created.metadata?.org).toBe(tenancy.org);
    expect(created.spec?.pluginId).toBe(plugin.metadata!.id);
    expect(created.spec?.pluginDigest, "an empty digest is stamped with the current version").toBe(
      plugin.status!.digest,
    );
    // Two cases, the case's own (default) target, with and without the plugin, two tries each.
    expect(created.status?.triesTotal).toBe(8);
    expect(created.status?.triesFinished ?? 0).toBe(0);
    expect(created.status?.provisionalDelta).toBe(true);
  });

  it("[rpc:PluginEvalQueryController.get] get answers what create stored", async () => {
    const plugin = await installedWithEvals();
    const created = await createEval(plugin, { ablation: PluginEvalAblation.none, caseGlob: "fir*" });

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

  it("[rpc:PluginEvalCommandController.create] a digest that names no version of the plugin is INVALID_ARGUMENT", async () => {
    const plugin = await installedWithEvals();
    const digest = "0".repeat(64);
    const err = await expectGrpcCode(
      () =>
        clients.pluginEvalCommand.create(
          makePluginEval({ org: tenancy.org, pluginId: plugin.metadata!.id, pluginDigest: digest }),
        ),
      Code.InvalidArgument,
      "create naming an unknown digest",
    );
    expect(err.rawMessage).toBe(pluginEvalUnknownDigestMessage(digest));
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
      Code.InvalidArgument,
      "create naming an unknown digest",
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
