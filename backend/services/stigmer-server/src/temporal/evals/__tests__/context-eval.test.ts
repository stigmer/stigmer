/**
 * Pins how an Eval's case meets the agent it runs on, over contexts built
 * by hand (no store, no engine):
 *
 *   - the servers it may mock are every server of the agent its arm runs,
 *     each keyed by its name in the turn and carrying its home: the
 *     agent's own, then each listed plugin's, the compared plugin's left
 *     out of the without arm with the plugin; no server is "other", so none
 *     is turned off beside them; a plugin's case keeps its plugin's servers
 *     and every other server off, as before;
 *   - the try's case context names the Eval's archive (its id and digest,
 *     no suite directory) and each mock with its home; a mock whose server
 *     the agent lacks rides nowhere;
 *   - the skeleton puts an Eval's case under its Eval, its mocked servers
 *     listed by their names in the turn and each mock that names no server
 *     of the agent "no such server on the agent"; a status without the
 *     Eval's block gets no case;
 *   - an Eval's case keeps its indicators in both arms: it is no plugin's
 *     own, so no arm leaves its plugin out;
 *   - the loader reads each Eval the eval run stamped, at its version, as
 *     an Eval source after the plugins, through the suite source with the
 *     Eval's kind, passing over one stamped not run; an Eval gone since
 *     leaves the eval run nothing to run.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EvalCase, EvalSuite } from "@stigmer/plugin-package";
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { tryAttachment } from "../../../domain/eval-run/arm.js";
import { NO_SUCH_SERVER_ON_AGENT, NOT_STARTED_NO_MOCK, tryRunRequest } from "../../../domain/eval-run/try-run.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { EvalContext } from "../context.js";
import { attachedPluginOf, caseServersOf, indicatorsLeaveScore, newEvalContextLoader, otherServersOf } from "../context.js";
import { writeSkeleton } from "../run-status.js";
import { AGENT_HASH, ORG, catalog, seedAgent, suiteSource } from "./support.js";

const DIGEST = "e".repeat(64);
const PLUGIN_DIGEST = "d".repeat(64);

const billing = {
  server: "billing",
  tools: [{ tool: "refund", file: "mocks/billing/refund.md", kind: "fixed" as const, error: false }],
};
const thermosTracker = {
  server: "plugin_thermos_tracker",
  tools: [{ tool: "create_issue", file: "mocks/plugin_thermos_tracker/create_issue.md", kind: "fixed" as const, error: false }],
};
const stray = {
  server: "crm",
  tools: [{ tool: "lookup", file: "mocks/crm/lookup.md", kind: "fixed" as const, error: false }],
};

const evalCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  name: "refund",
  dir: "refund",
  tags: [],
  prompt: "Refund my order.",
  runs: 1,
  maxTurns: 10,
  timeoutSeconds: 300,
  allowedTools: [],
  env: {},
  plugins: [],
  context: { addDirs: [] },
  files: [],
  graders: [],
  mocks: [billing, thermosTracker, stray],
  replays: false,
  ...overrides,
});

const thermos = create(PluginSchema, {
  metadata: { id: "plg_thermos", org: "org_acme", slug: "thermos", name: "thermos" },
  status: { digest: PLUGIN_DIGEST, mcpServers: [{ name: "tracker" }] },
});

const suite = (cases: EvalCase[]): EvalSuite => ({ dir: "", cases, findings: [], servers: ["billing", "crm", "plugin_thermos_tracker"] });

/** An eval run on agent agt_1 that loads thermos, comparing it when `compared`, running one Eval case. */
function contextOf(compared: boolean): EvalContext {
  const evalCaseRow = evalCase();
  const evalRow = create(EvalSchema, { metadata: { id: "evs_1", org: "org_acme", slug: "support", name: "support" }, status: { digest: DIGEST } });
  const context: EvalContext = {
    evalRun: create(EvalRunSchema, {
      metadata: { id: "evr_1", org: "org_acme" },
      spec: {
        subject: { case: "agentId", value: "agt_1" },
        comparedPluginId: compared ? "plg_thermos" : "",
        ablation: EvalRunAblation.with_without,
      },
      status: { evals: [{ evalId: "evs_1", evalSlug: "support", evalDigest: DIGEST }] },
    }),
    agent: { org: "org_acme", id: "agt_1", slug: "desk", versionHash: "a".repeat(64) },
    loaded: [attachedPluginOf(thermos, PLUGIN_DIGEST)],
    comparedPluginId: compared ? "plg_thermos" : undefined,
    ownServers: [{ slug: "billing", key: "billing", home: { kind: "agent", agentId: "agt_1", server: "billing" } }],
    sources: [{ kind: "eval", eval: evalRow, digest: DIGEST, files: { entries: [], read: () => new Uint8Array() }, suite: suite([evalCaseRow]), evalIndex: 0 }],
    caseSources: [0],
    matrix: {
      cases: [{ evalCase: evalCaseRow, targets: [{ target: { harness: Harness.NATIVE, modelName: "" }, runs: 1 }] }],
      cells: [{ caseIndex: 0, targetIndex: 0, arm: "with", tryIndex: 0 }],
    },
    twoArms: compared,
  };
  return context;
}

describe("an Eval's case on its agent", () => {
  it("may mock every server of the agent its arm runs, each keyed by its name in the turn, and turns no other server off", () => {
    const context = contextOf(true);
    expect(caseServersOf(context, 0, "with")).toEqual([
      { slug: "billing", key: "billing", home: { kind: "agent", agentId: "agt_1", server: "billing" } },
      {
        slug: "plugin_thermos_tracker",
        key: "plugin_thermos_tracker",
        home: { kind: "plugin", pluginId: "plg_thermos", pluginName: "thermos", server: "tracker" },
      },
    ]);
    expect(caseServersOf(context, 0, "without")?.map((server) => server.slug)).toEqual(["billing"]);
    expect(otherServersOf(context, 0)).toEqual([]);
    expect(caseServersOf(context, 5, "with")).toBeUndefined();
    expect(indicatorsLeaveScore(context, 0)).toBe(false);
  });

  it("names the Eval's archive in the try's case context, each mock with its home, and no mock for a server the agent lacks", () => {
    const context = contextOf(false);
    const attachment = tryAttachment({ agent: context.agent, plugins: context.loaded.map((plugin) => plugin.facts), comparedPluginId: undefined }, "with");
    const run = tryRunRequest({
      org: "org_acme",
      evalId: "evr_1",
      cell: { caseIndex: 0, targetIndex: 0, arm: "with", tryIndex: 0 },
      sessionId: "ses_1",
      evalCase: evalCase(),
      spec: { allowTools: [], realMcpServers: false, allowRealServers: false, judgeModel: "" },
      modelName: "",
      budgetUsd: 1,
      pluginServers: caseServersOf(context, 0, "with") ?? [],
      otherServers: otherServersOf(context, 0),
      attachment,
      source: { kind: "eval", evalId: "evs_1", digest: DIGEST },
    });
    const caseContext = run.spec?.evalCase;
    expect([caseContext?.evalId, caseContext?.evalDigest, caseContext?.pluginId, caseContext?.suiteDir]).toEqual(["evs_1", DIGEST, "", ""]);
    expect(caseContext?.mocks.map((mock) => [mock.server, mock.segment, mock.home.case, mock.home.value?.server])).toEqual([
      ["billing", "billing", "agent", "billing"],
      ["plugin_thermos_tracker", "plugin_thermos_tracker", "plugin", "tracker"],
    ]);
    expect(run.spec?.tools).toEqual(["mcp__billing__refund", "mcp__plugin_thermos_tracker__create_issue"]);
    expect(run.spec?.disallowedTools).not.toContain("mcp__billing");
  });

  it("lists the case under its Eval in the skeleton, with each mock that names no server of the agent", () => {
    const context = contextOf(false);
    const status = create(EvalRunStatusSchema, { evals: [{ evalId: "evs_1", evalSlug: "support", evalDigest: DIGEST }] });
    writeSkeleton(status, context);
    expect(status.plugins).toEqual([]);
    expect(status.evals[0]?.cases.map((c) => [c.caseName, c.path])).toEqual([["refund", "refund"]]);
    expect(status.evals[0]?.cases[0]?.mockedServers.map((server) => [server.name, server.tools, server.notStartedReason])).toEqual([
      ["billing", ["refund"], ""],
      ["plugin_thermos_tracker", ["create_issue"], ""],
      ["crm", [], NO_SUCH_SERVER_ON_AGENT],
    ]);
    expect(NOT_STARTED_NO_MOCK).toBe("not started: no mock");
  });

  it("writes no case for an Eval whose block the status lacks", () => {
    const status = create(EvalRunStatusSchema, {});
    writeSkeleton(status, contextOf(false));
    expect([status.plugins, status.evals]).toEqual([[], []]);
  });
});

describe("the loader's Eval sources", () => {
  let temp: TempStore;

  beforeEach(() => {
    temp = tempStore();
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  async function seedEvalRun(): Promise<void> {
    await seedAgent(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.eval,
      "evs_0",
      EvalSchema,
      create(EvalSchema, { metadata: { id: "evs_0", org: ORG, slug: "unbuilt", name: "unbuilt" } }),
    );
    await temp.store.saveResource(
      ApiResourceKind.eval,
      "evs_1",
      EvalSchema,
      create(EvalSchema, { metadata: { id: "evs_1", org: ORG, slug: "support", name: "support" }, status: { digest: DIGEST } }),
    );
    await temp.store.saveResource(
      ApiResourceKind.eval_run,
      "evr_eval",
      EvalRunSchema,
      create(EvalRunSchema, {
        metadata: { id: "evr_eval", org: ORG, name: "evr_eval" },
        spec: { subject: { case: "agentId", value: "agt_1" }, agentVersion: AGENT_HASH, runs: 1, maxCostUsd: 5 },
        status: {
          evals: [
            { evalId: "evs_0", evalSlug: "unbuilt", evalDigest: "", notRunReason: "no version to run" },
            { evalId: "evs_1", evalSlug: "support", evalDigest: DIGEST },
          ],
        },
      }),
    );
  }

  it("reads a stamped Eval as an Eval source, asking the suite source for the Eval's archive and passing over one stamped not run", async () => {
    await seedEvalRun();
    const reads: Array<{ kind: string; id: string; digest: string }> = [];
    const source = suiteSource();
    const context = await newEvalContextLoader({
      store: temp.store,
      suites: { readArchive: (ref) => (reads.push({ ...ref }), source.readArchive(ref)) },
      catalog,
    })("evr_eval");
    expect(reads).toEqual([{ kind: "eval", id: "evs_1", digest: DIGEST }]);
    expect(context?.sources.map((entry) => [entry.kind, entry.kind === "eval" ? entry.evalIndex : -1])).toEqual([["eval", 1]]);
    expect(context?.matrix.cases.length).toBeGreaterThan(0);
  });

  it("answers no context when a stamped Eval is gone", async () => {
    await seedEvalRun();
    await temp.store.deleteResource(ApiResourceKind.eval, "evs_1");
    expect(await newEvalContextLoader({ store: temp.store, suites: suiteSource(), catalog })("evr_eval")).toBeUndefined();
  });
});
