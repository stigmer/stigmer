/**
 * Pins an eval run about an agent through the suite and case activities,
 * over a real store and real suites read by `readEvalSuite`:
 *
 *   - the load plans one flat matrix over every evaluated plugin's cases,
 *     in plugin order, and writes each plugin's block of the skeleton (a
 *     plugin whose cases do not run keeps its reason and gets none);
 *   - with no targets named, a case's target is the agent as it runs: its
 *     engine (native for none) and its model as the label, and the try's
 *     run names no model, so the agent's own tier and thinking apply;
 *   - a try's session runs the agent pinned to the stamped version and
 *     lists every plugin the agent attaches pinned to its stamped digest,
 *     and its run turns off the other plugins' servers as well as the
 *     case's own unmocked ones, leaving no plugin out;
 *   - comparing an attached plugin plans both arms; the without try's
 *     session is the with try's, and its run leaves the compared plugin
 *     out, while a case of another attached plugin runs in both arms;
 *   - a recorded try lands in its plugin's block by its flat index, and
 *     the totals are summed per plugin and over all; finish ends it;
 *   - the loader answers undefined once the agent version is gone, and the
 *     load ends an eval run whose stamped plugin version is gone failed,
 *     naming why, rather than leaving it pending.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunPhase, EvalRunPluginSchema, EvalRunTryState } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { EVAL_RUN_LABEL } from "../../../domain/eval-run/constants.js";
import { newPatternPool } from "../../../domain/eval-run/graders/patterns.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { createCaseActivities } from "../case-activities.js";
import { newEvalContextLoader } from "../context.js";
import {
  FINISH_EVAL_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
} from "../names.js";
import type { CaseInput, TryResult } from "../names.js";
import { EVAL_SUBJECT_GONE_ERROR, createSuiteActivities } from "../suite-activities.js";
import { DIGEST, MODEL, ORG, PLUGIN_ID, catalog, lane, scoreChain, seedPlugin, silentLogger, suiteSource } from "./support.js";

const AGENT_ID = "agt_1";
const AGENT_HASH = "a".repeat(64);
const EVAL_ID = "evr_agent";
const REFUNDS_ID = "plg_2";
const REFUNDS_DIGEST = "e".repeat(64);
const STYLE_ID = "plg_3";
const STYLE_DIGEST = "f".repeat(64);

let temp: TempStore;

const pool = newPatternPool(1);

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

async function seedAgent(): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.agent,
    AGENT_ID,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: AGENT_ID, org: ORG, slug: "support-desk", name: "support-desk" },
      spec: { instructions: "You answer support tickets politely.", runConfig: { modelName: MODEL } },
      status: { versionHash: AGENT_HASH },
    }),
  );
}

async function seedOtherPlugins(): Promise<void> {
  for (const [id, slug, digest, server] of [
    [REFUNDS_ID, "refunds", REFUNDS_DIGEST, "ledger"],
    [STYLE_ID, "style", STYLE_DIGEST, "fonts"],
  ] as const) {
    await temp.store.saveResource(
      ApiResourceKind.plugin,
      id,
      PluginSchema,
      create(PluginSchema, {
        metadata: { id, org: ORG, slug, name: slug },
        spec: { name: slug },
        status: { digest, mcpServers: [{ name: server }] },
      }),
    );
  }
}

async function seedAgentEval(
  spec: { readonly targets?: Array<{ harness: Harness; modelName: string }>; readonly compareRefunds?: boolean } = {},
): Promise<void> {
  const compared = spec.compareRefunds === true;
  await temp.store.saveResource(
    ApiResourceKind.eval_run,
    EVAL_ID,
    EvalRunSchema,
    create(EvalRunSchema, {
      metadata: { id: EVAL_ID, org: ORG, name: EVAL_ID },
      spec: create(EvalRunSpecSchema, {
        subject: { case: "agentId", value: AGENT_ID },
        agentVersion: AGENT_HASH,
        comparedPluginId: compared ? REFUNDS_ID : "",
        runs: 1,
        maxCostUsd: 5,
        targets: spec.targets ?? [],
      }),
      status: {
        phase: EvalRunPhase.pending,
        agentVersionHash: AGENT_HASH,
        plugins: [
          create(EvalRunPluginSchema, {
            pluginId: PLUGIN_ID,
            pluginSlug: "thermos",
            pluginDigest: DIGEST,
            attached: true,
            // Comparing refunds runs only its cases (create's rule when no case source is named).
            notRunReason: compared ? "not selected" : "",
          }),
          create(EvalRunPluginSchema, {
            pluginId: REFUNDS_ID,
            pluginSlug: "refunds",
            pluginDigest: REFUNDS_DIGEST,
            attached: true,
            compared,
          }),
          create(EvalRunPluginSchema, {
            pluginId: STYLE_ID,
            pluginSlug: "style",
            pluginDigest: STYLE_DIGEST,
            attached: true,
            notRunReason: "not selected",
          }),
        ],
      },
    }),
  );
}

async function seeded(spec?: Parameters<typeof seedAgentEval>[0]): Promise<void> {
  await seedAgent();
  await seedPlugin(temp.store);
  await seedOtherPlugins();
  await seedAgentEval(spec);
}

function build() {
  const contexts = newEvalContextLoader({ store: temp.store, suites: suiteSource(), catalog });
  const doubles = lane(temp.store);
  const chain = scoreChain(temp.store);
  const suite = createSuiteActivities({ store: temp.store, logger: silentLogger, contexts, attempt: () => 1 });
  const cases = createCaseActivities({
    store: temp.store,
    logger: silentLogger,
    contexts,
    tries: () => doubles.lane,
    sessions: () => doubles.sessions,
    recorder: () => chain.recorder,
    deleter: () => chain.deleter,
    readArtifact: undefined,
    evalRunCaller: undefined,
    patterns: pool,
    attempt: () => 1,
  });
  return { suite, cases, record: doubles.record, contexts };
}

async function readAgentEval() {
  return temp.store.getResource(ApiResourceKind.eval_run, EVAL_ID, EvalRunSchema);
}

describe("an eval run about an agent through the activities", () => {
  it("plans every evaluated plugin's cases in one flat matrix and writes each plugin's block", async () => {
    await seeded();
    const { suite } = build();
    const plan = await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    expect(plan).toMatchObject({ kind: "run", org: ORG, maxCostUsd: 5, concurrency: 1 });
    expect(plan.kind === "run" ? plan.cells.map((cell) => [cell.caseIndex, cell.arm]) : []).toEqual([
      [0, "with"],
      [2, "with"],
    ]);

    const status = (await readAgentEval()).status!;
    expect(status.phase).toBe(EvalRunPhase.running);
    expect(status.triesTotal).toBe(2);
    const [thermos, refunds, style] = status.plugins;
    expect(thermos?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case", "other-plugin"]);
    expect(refunds?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case", "other-plugin"]);
    expect(style?.cases).toEqual([]);
    expect(style?.notRunReason).toBe("not selected");
    const target = thermos?.cases[0]?.targets[0];
    expect(target?.target).toMatchObject({ harness: Harness.NATIVE, modelName: MODEL });
    expect(target?.withPlugin?.tries).toHaveLength(1);
    expect(target?.withoutPlugin).toBeUndefined();
  });

  it("runs the agent pinned to its version with every plugin pinned, its own model and the other servers off", async () => {
    await seeded();
    const { suite, cases, record } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    const input: CaseInput = {
      evalId: EVAL_ID,
      org: ORG,
      caseIndex: 2,
      targetIndex: 0,
      arm: "with",
      tryIndex: 0,
      timeoutSeconds: 120,
      budgetUsd: 1,
    };
    expect(await cases[START_TRY_ACTIVITY_NAME](input)).toMatchObject({ kind: "started" });

    const session = record.sessions[0]!.session;
    expect(session.metadata?.labels[EVAL_RUN_LABEL]).toBe(EVAL_ID);
    expect(session.spec?.agentRef).toMatchObject({ org: ORG, id: AGENT_ID, slug: "", version: AGENT_HASH });
    expect(session.spec?.plugins.map((ref) => [ref.id, ref.version])).toEqual([
      [PLUGIN_ID, DIGEST],
      [REFUNDS_ID, REFUNDS_DIGEST],
      [STYLE_ID, STYLE_DIGEST],
    ]);
    const run = record.runs[0]!.run;
    expect(run.spec?.runConfig?.modelName).toBe("");
    expect(run.spec?.disallowedTools).toEqual(
      expect.arrayContaining(["mcp__plugin_refunds_ledger", "mcp__plugin_thermos_github", "mcp__plugin_style_fonts"]),
    );
    expect(run.spec?.excludedPluginIds).toEqual([]);
  });

  it("compares an attached plugin: the without try keeps the session and leaves the plugin out of its run", async () => {
    await seeded({ compareRefunds: true });
    const { suite, cases, record } = build();
    const plan = await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    // The compared plugin's own cases run, with and without it; thermos's are not selected.
    expect(plan.kind === "run" ? plan.cells.map((cell) => [cell.caseIndex, cell.arm]) : []).toEqual([
      [0, "with"],
      [0, "without"],
    ]);
    const status = (await readAgentEval()).status!;
    expect(status.plugins.map((plugin) => plugin.cases.length)).toEqual([0, 2, 0]);
    const start = (arm: "with" | "without"): CaseInput => ({
      evalId: EVAL_ID,
      org: ORG,
      caseIndex: 0,
      targetIndex: 0,
      arm,
      tryIndex: 0,
      timeoutSeconds: 120,
      budgetUsd: 1,
    });
    expect(await cases[START_TRY_ACTIVITY_NAME](start("with"))).toMatchObject({ kind: "started" });
    expect(await cases[START_TRY_ACTIVITY_NAME](start("without"))).toMatchObject({ kind: "started" });
    const [withSession, withoutSession] = record.sessions.map((entry) => entry.session.spec);
    expect(withoutSession?.agentRef).toEqual(withSession?.agentRef);
    expect(withoutSession?.plugins).toEqual(withSession?.plugins);
    const [withRun, withoutRun] = record.runs.map((entry) => entry.run.spec);
    expect(withRun?.excludedPluginIds).toEqual([]);
    expect(withoutRun?.excludedPluginIds).toEqual([REFUNDS_ID]);
  });

  it("sends a named target's model on the run", async () => {
    await seeded({ targets: [{ harness: Harness.NATIVE, modelName: MODEL }] });
    const { suite, cases, record } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await cases[START_TRY_ACTIVITY_NAME]({
      evalId: EVAL_ID,
      org: ORG,
      caseIndex: 0,
      targetIndex: 0,
      arm: "with",
      tryIndex: 0,
      timeoutSeconds: 120,
      budgetUsd: 1,
    });
    expect(record.runs[0]!.run.spec?.runConfig?.modelName).toBe(MODEL);
  });

  it("records a try in its plugin's block and sums each plugin's totals and the eval's", async () => {
    await seeded();
    const { suite } = build();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    const result = (score: number, costUsd: number): TryResult => ({
      sessionId: "ses_x",
      runId: "run_x",
      state: "graded",
      score,
      notGradedReason: "",
      error: "",
      costUsd,
      durationSeconds: 3,
    });
    const cell = { targetIndex: 0, arm: "with" as const, tryIndex: 0, timeoutSeconds: 120 };
    await suite[RECORD_TRY_ACTIVITY_NAME](EVAL_ID, { ...cell, caseIndex: 0 }, result(1, 0.25));
    await suite[RECORD_TRY_ACTIVITY_NAME](EVAL_ID, { ...cell, caseIndex: 2 }, result(0.5, 0.5));
    await suite[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, { phase: "completed" });

    const status = (await readAgentEval()).status!;
    expect(status.phase).toBe(EvalRunPhase.completed);
    expect(status.plugins[0]?.cases[0]?.targets[0]?.withPlugin?.tries[0]?.state).toBe(EvalRunTryState.graded);
    expect(status.plugins[1]?.cases[0]?.targets[0]?.withPlugin?.tries[0]?.score).toBe(0.5);
    expect(status.plugins[0]?.aggregates).toMatchObject({ overallScore: 1, casesPassed: 1, casesTotal: 1 });
    expect(status.plugins[1]?.aggregates).toMatchObject({ overallScore: 0.5, casesPassed: 0, casesTotal: 1 });
    expect(status.aggregates).toMatchObject({ overallScore: 0.75, casesPassed: 1, casesTotal: 2 });
    expect(status.aggregates?.meanDelta).toBeUndefined();
    expect(status.costUsd).toBeCloseTo(0.75);
    expect(status.triesFinished).toBe(2);
  });

  it("ends the eval failed, naming why, when a plugin version it stamped is gone", async () => {
    await seeded();
    await temp.store.deleteResource(ApiResourceKind.plugin, REFUNDS_ID);
    const { suite } = build();
    expect(await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID)).toEqual({ kind: "stop" });
    const status = (await readAgentEval()).status!;
    expect(status.phase).toBe(EvalRunPhase.failed);
    expect(status.error).toBe(EVAL_SUBJECT_GONE_ERROR);
    expect(status.finishedAt).toBeDefined();
  });

  it("leaves an eval that ended while its versions were found gone as it ended", async () => {
    await seeded();
    const suite = createSuiteActivities({
      store: temp.store,
      logger: silentLogger,
      // A cancel lands between the load's first read and its write.
      contexts: async () => {
        await temp.store.updateResource(ApiResourceKind.eval_run, EVAL_ID, EvalRunSchema, (live) => {
          live.status!.phase = EvalRunPhase.partial;
        });
        return undefined;
      },
      attempt: () => 1,
    });
    expect(await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID)).toEqual({ kind: "stop" });
    const status = (await readAgentEval()).status!;
    expect(status.phase).toBe(EvalRunPhase.partial);
    expect(status.error).toBe("");
  });

  it("answers no context once the agent is gone", async () => {
    await seeded();
    await temp.store.deleteResource(ApiResourceKind.agent, AGENT_ID);
    const { contexts } = build();
    expect(await contexts(EVAL_ID)).toBeUndefined();
  });
});
