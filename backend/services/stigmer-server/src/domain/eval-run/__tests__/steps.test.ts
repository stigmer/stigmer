/**
 * Pins the eval run steps' arms the composed lanes cannot reach (no
 * engine runs behind them): a workflow that starts leaves the pending row
 * as it is; a failed start marks a pending eval failed and never
 * overwrites what the workflow already wrote, a start that timed out
 * after the workflow's real load wrote running included (the eval stays
 * running and its tries are recorded); a cancel the workflow takes answers the row unchanged, one with no
 * workflow marks the eval partial "cancelled" unless it finished meanwhile,
 * a finished eval's cancel asks nothing, and a fault is a sanitized
 * INTERNAL; an eval pending or running past its workflow's execution
 * timeout is answered and stored failed, "the eval's workflow ended
 * without finishing", by get, the plugin's list and cancel, and a running
 * eval whose cancel finds no workflow is failed the same way; listByPlugin keeps only the evals the caller may view,
 * answers each without its tries (its summaries kept), and fails closed
 * when the authorizer cannot answer; the create's question
 * is can_edit on the plugin and a server-composed create asks none; a
 * suite source's own refusal passes through while any other fault is
 * INTERNAL; a store fault reading the plugin is INTERNAL. The create's
 * defaults refuse a request with no organization or no spec, a plugin
 * with no version to run, and an allow_tools entry naming an MCP server
 * segment that is not one of the plugin's (another plugin's), while the
 * plugin's own entries are kept as written; a suite past the limits is refused with its counts and no cell
 * planned; a failed start's write answers NOT_FOUND for a row gone and
 * INTERNAL for a store fault; a chain built wrong (the plugin, the
 * cancel's target or the delete's row never stashed) fails loudly as
 * INTERNAL instead of answering with nothing.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudePlugin, inMemoryPluginFiles } from "@stigmer/plugin-package/testing";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  ListEvalRunsByPluginRequestSchema,
  EvalRunIdSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import type { EvalRunList } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import {
  EvalRunArmSchema,
  EvalRunCaseSchema,
  EvalRunCaseTargetSchema,
  EvalRunPluginSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunStatusSchema,
  EvalRunTryState,
  EvalRunTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { EvalRunTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { TARGET_RESOURCE_KEY } from "../../../pipeline/steps/load-target.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newEvalContextLoader } from "../../../temporal/evals/context.js";
import { LOAD_SUITE_ACTIVITY_NAME, RECORD_TRY_ACTIVITY_NAME } from "../../../temporal/evals/names.js";
import { createSuiteActivities } from "../../../temporal/evals/suite-activities.js";
import {
  EVAL_ID,
  catalog,
  readEval,
  seedEval,
  seedPlugin,
  suiteSource,
} from "../../../temporal/evals/__tests__/support.js";
import {
  EVAL_RUN_NOT_STARTED_ERROR,
  EVAL_RUN_WORKFLOW_ENDED_ERROR,
  evalRunNoCasesMessage,
  evalRunOtherPluginToolMessage,
  EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE,
  evalRunTooLargeMessage,
} from "../constants.js";
import {
  EVAL_RUN_LOAD_KEY,
  EVAL_RUN_SUBJECT_KEY,
  EVAL_RUN_RESULT_KEY,
  newCancelEvalRunStep,
  newListEvalRunsBySubjectStep,
  newSettleEndedEvalRunStep,
  evalRunOutlivedItsWorkflow,
  settleEndedEvalRun,
  newLoadEvalRunSubjectStep,
  newPlanEvalRunStep,
  newRefuseActiveEvalRunDeleteStep,
  newResolveEvalRunDefaultsStep,
  newStartEvalRunWorkflowStep,
  resolveEvalRunCreateTargets,
} from "../steps.js";
import type { EvaluatedLoad, LoadedSubject } from "../steps.js";
import { EVAL_RUN_EXECUTION_TIMEOUT_MS } from "../workflows.js";
import type { EvalRunWorkflows } from "../workflows.js";
import * as matrix from "../matrix.js";

// planMatrix as it is, watched: create counts a suite, never plans its cells.
vi.mock("../matrix.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../matrix.js")>();
  return { ...actual, planMatrix: vi.fn(actual.planMatrix) };
});

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function evalRow(id: string, phase: EvalRunPhase, pluginId = "plg_1"): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id, name: id, org: "org_1" },
    spec: { subject: { case: "pluginId", value: pluginId }, maxCostUsd: 5 },
    status: { phase },
  });
}

async function saved(row: EvalRun): Promise<EvalRun> {
  await temp.store.saveResource(ApiResourceKind.eval_run, row.metadata!.id, EvalRunSchema, row);
  return row;
}

async function stored(id: string): Promise<EvalRun> {
  return temp.store.getResource(ApiResourceKind.eval_run, id, EvalRunSchema);
}

function workflows(answers: Partial<EvalRunWorkflows> = {}): EvalRunWorkflows & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: async (id) => {
      calls.push(`start ${id}`);
      await answers.start?.(id);
    },
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
      return answers.cancel === undefined ? "requested" : answers.cancel(id);
    },
  };
}

function createCtx(row: EvalRun, caller = testCallerIdentity()) {
  return new RequestContext(EvalRunSchema, row, caller, ApiResourceKind.eval_run);
}

/** An authorizer that allows every question: the create's own steps ask none in these arms. */
const PERMIT: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** A plan's context: the eval run about the plugin `plg_1`, its one plugin stamped at `digest`, compared. */
function planCtx(row: EvalRun, digest = "a".repeat(64)) {
  const ctx = createCtx(row);
  ctx.set(EVAL_RUN_LOAD_KEY, {
    agentSpec: undefined,
    plugins: [
      {
        plugin: create(PluginSchema, { metadata: { id: "plg_1", org: "org_1", name: "thermos", slug: "thermos" } }),
        digest,
        attached: false,
        compared: true,
      },
    ],
    selected: new Set(["plg_1"]),
    evals: [],
  } satisfies EvaluatedLoad);
  return ctx;
}

function idCtx(target: EvalRun) {
  const ctx = new RequestContext(
    EvalRunIdSchema,
    create(EvalRunIdSchema, { value: target.metadata!.id }),
    testCallerIdentity(),
    ApiResourceKind.eval_run,
  );
  ctx.set(TARGET_RESOURCE_KEY, target);
  return ctx;
}

async function failure(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a failure");
}

describe("StartEvalRunWorkflow", () => {
  it("leaves the pending row as it is when the workflow starts", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const port = workflows();
    const ctx = createCtx(row);
    await newStartEvalRunWorkflowStep(temp.store, port, silentLogger).execute(ctx);
    expect(port.calls).toEqual(["start evr_1"]);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.pending);
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.pending);
  });

  it("never overwrites what the workflow already wrote when the start fails", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.completed));
    const ctx = createCtx(row);
    await newStartEvalRunWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("deadline")) }),
      silentLogger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.completed);
    expect(ctx.newState.status?.error).toBe("");
  });

  it("marks a pending eval failed with a fixed sentence when the start fails, and logs the engine's error", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const ctx = createCtx(row);
    const logged: Array<{ message: string; fields: unknown }> = [];
    await newStartEvalRunWorkflowStep(
      temp.store,
      workflows({
        start: () => Promise.reject(new Error("dial tcp 10.0.0.7:7233: connection refused")),
      }),
      {
        ...silentLogger,
        warn: (message, fields) => logged.push({ message, fields }),
      },
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.failed);
    expect(EVAL_RUN_NOT_STARTED_ERROR).toBe("the eval run's workflow could not be started");
    expect(ctx.newState.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.failed);
    expect(logged).toEqual([
      {
        message: "an eval run's workflow could not start; marking it failed",
        fields: { evalRunId: "evr_1", cause: "dial tcp 10.0.0.7:7233: connection refused" },
      },
    ]);
  });

  it("leaves an eval running when the start times out after the workflow's load wrote running", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const suite = createSuiteActivities({
      store: temp.store,
      logger: silentLogger,
      contexts: newEvalContextLoader({ store: temp.store, suites: suiteSource(), catalog }),
      attempt: () => 1,
    });
    const startedThenTimedOut = workflows({
      start: async (id) => {
        await suite[LOAD_SUITE_ACTIVITY_NAME](id);
        throw new Error("deadline exceeded");
      },
    });
    const ctx = createCtx(await readEval(temp.store));
    await newStartEvalRunWorkflowStep(temp.store, startedThenTimedOut, silentLogger).execute(ctx);

    expect(ctx.newState.status?.phase).toBe(EvalRunPhase.running);
    expect(ctx.newState.status?.error).toBe("");
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { caseIndex: 0, targetIndex: 0, arm: "with", tryIndex: 0, timeoutSeconds: 120 },
      {
        sessionId: "ses_x",
        runId: "run_x",
        state: "graded",
        score: 1,
        notGradedReason: "",
        error: "",
        costUsd: 0.42,
        durationSeconds: 3,
      },
    );
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(EvalRunPhase.running);
    expect(status?.error).toBe("");
    expect(status?.finishedAt).toBeUndefined();
    expect(status?.plugins[0]?.cases[0]?.targets[0]?.withPlugin?.tries[0]?.state).toBe(EvalRunTryState.graded);
  });
});

describe("CancelEvalRun", () => {
  it("answers the row unchanged when the workflow takes the cancel", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.running));
    const ctx = idCtx(row);
    await newCancelEvalRunStep(temp.store, workflows()).execute(ctx);
    expect((ctx.get(EVAL_RUN_RESULT_KEY) as EvalRun).status?.phase).toBe(EvalRunPhase.running);
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.running);
  });

  it("marks an eval with no workflow partial, cancelled", async () => {
    const row = await saved(evalRow("evr_1", EvalRunPhase.pending));
    const ctx = idCtx(row);
    await newCancelEvalRunStep(temp.store, workflows({ cancel: () => Promise.resolve("not-found") })).execute(ctx);
    const answered = ctx.get(EVAL_RUN_RESULT_KEY) as EvalRun;
    expect(answered.status?.phase).toBe(EvalRunPhase.partial);
    expect(answered.status?.partialReason).toBe(EvalRunPartialReason.cancelled);
    expect(answered.status?.finishedAt).toBeDefined();
    expect((await stored("evr_1")).status?.phase).toBe(EvalRunPhase.partial);
  });

  it("keeps what the workflow wrote when it finished before the cancel landed", async () => {
    const loaded = evalRow("evr_1", EvalRunPhase.running);
    await saved(evalRow("evr_1", EvalRunPhase.completed));
    const ctx = idCtx(loaded);
    await newCancelEvalRunStep(temp.store, workflows({ cancel: () => Promise.resolve("not-found") })).execute(ctx);
    expect((ctx.get(EVAL_RUN_RESULT_KEY) as EvalRun).status?.phase).toBe(EvalRunPhase.completed);
  });

  it("asks no workflow for a finished eval, and is INTERNAL on a fault", async () => {
    const finished = await saved(evalRow("evr_done", EvalRunPhase.failed));
    const port = workflows();
    const ctx = idCtx(finished);
    await newCancelEvalRunStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(ctx.get(EVAL_RUN_RESULT_KEY)).toBe(finished);

    const running = await saved(evalRow("evr_1", EvalRunPhase.running));
    const fault = await failure(() =>
      newCancelEvalRunStep(temp.store, workflows({ cancel: () => Promise.reject(new Error("transport")) })).execute(idCtx(running)),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to cancel the eval run");
  });
});

describe("an eval whose workflow ended without finishing", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ALLOW_ALL: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

  /** A row created `ageMs` ago, in `phase`. */
  function aged(id: string, phase: EvalRunPhase, ageMs: number): EvalRun {
    return create(EvalRunSchema, {
      metadata: { id, name: id, org: "org_1" },
      spec: { subject: { case: "pluginId", value: "plg_1" }, maxCostUsd: 5 },
      status: { phase, audit: { specAudit: { createdAt: timestampFromMs(Date.now() - ageMs) } } },
    });
  }

  it("is a pending or running eval created longer ago than its workflow may run", () => {
    expect(EVAL_RUN_EXECUTION_TIMEOUT_MS).toBe(30 * DAY_MS);
    const now = Date.now();
    expect(evalRunOutlivedItsWorkflow(aged("a", EvalRunPhase.running, 31 * DAY_MS), now)).toBe(true);
    expect(evalRunOutlivedItsWorkflow(aged("b", EvalRunPhase.pending, 31 * DAY_MS), now)).toBe(true);
    expect(evalRunOutlivedItsWorkflow(aged("c", EvalRunPhase.running, 29 * DAY_MS), now)).toBe(false);
    // Within the margin past the timeout the workflow may still be writing its end.
    expect(evalRunOutlivedItsWorkflow(aged("d", EvalRunPhase.running, 30 * DAY_MS + 60_000), now)).toBe(false);
    expect(evalRunOutlivedItsWorkflow(aged("e", EvalRunPhase.partial, 31 * DAY_MS), now)).toBe(false);
    expect(evalRunOutlivedItsWorkflow(evalRow("f", EvalRunPhase.running), now)).toBe(false);
    const started = evalRow("g", EvalRunPhase.running);
    started.status!.startedAt = timestampFromMs(now - 31 * DAY_MS);
    expect(evalRunOutlivedItsWorkflow(started, now)).toBe(true);
  });

  it("answers a get failed with the reason and stores it, and leaves a live one as it is", async () => {
    const stale = await saved(aged("evr_stale", EvalRunPhase.running, 31 * DAY_MS));
    const ctx = idCtx(stale);
    await newSettleEndedEvalRunStep(temp.store).execute(ctx);
    const answered = ctx.get(TARGET_RESOURCE_KEY) as EvalRun;
    expect(answered.status?.phase).toBe(EvalRunPhase.failed);
    expect(answered.status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);
    expect(EVAL_RUN_WORKFLOW_ENDED_ERROR).toBe("the eval run's workflow ended without finishing");
    expect(answered.status?.finishedAt).toBeDefined();
    expect((await stored("evr_stale")).status?.phase).toBe(EvalRunPhase.failed);

    const live = await saved(aged("evr_live", EvalRunPhase.running, DAY_MS));
    const liveCtx = idCtx(live);
    await newSettleEndedEvalRunStep(temp.store).execute(liveCtx);
    expect(liveCtx.get(TARGET_RESOURCE_KEY)).toBe(live);
  });

  it("answers it failed in a plugin's list, keeping a row its settle cannot find", async () => {
    await saved(aged("evr_stale", EvalRunPhase.running, 31 * DAY_MS));
    const ctx = new RequestContext(
      ListEvalRunsByPluginRequestSchema,
      create(ListEvalRunsByPluginRequestSchema, { pluginId: "plg_1" }),
      testCallerIdentity({ origin: "in-process" }),
      ApiResourceKind.plugin,
    );
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, ALLOW_ALL, silentLogger).execute(ctx);
    expect((ctx.get(EVAL_RUN_RESULT_KEY) as EvalRunList).entries[0]?.status?.phase).toBe(EvalRunPhase.failed);

    // A row deleted between the list and its settle is answered as listed.
    const gone = aged("evr_gone", EvalRunPhase.running, 31 * DAY_MS);
    expect((await settleEndedEvalRun(temp.store, gone)).status?.phase).toBe(EvalRunPhase.running);
  });

  it("settles it on cancel without asking the workflow, and fails a running eval whose workflow is gone", async () => {
    const stale = await saved(aged("evr_stale", EvalRunPhase.running, 31 * DAY_MS));
    const port = workflows();
    const ctx = idCtx(stale);
    await newCancelEvalRunStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect((ctx.get(EVAL_RUN_RESULT_KEY) as EvalRun).status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);

    // Only the workflow writes running, so a running eval with no workflow ended without finishing.
    const orphan = await saved(evalRow("evr_orphan", EvalRunPhase.running));
    const orphanCtx = idCtx(orphan);
    await newCancelEvalRunStep(temp.store, workflows({ cancel: () => Promise.resolve("not-found") })).execute(orphanCtx);
    const answered = orphanCtx.get(EVAL_RUN_RESULT_KEY) as EvalRun;
    expect(answered.status?.phase).toBe(EvalRunPhase.failed);
    expect(answered.status?.error).toBe(EVAL_RUN_WORKFLOW_ENDED_ERROR);
  });
});

describe("ListEvalRunsByPlugin", () => {
  function listCtx(caller = testCallerIdentity()) {
    return new RequestContext(
      ListEvalRunsByPluginRequestSchema,
      create(ListEvalRunsByPluginRequestSchema, { pluginId: "plg_1" }),
      caller,
      ApiResourceKind.plugin,
    );
  }

  it("keeps only the evals the caller may view, and fails closed when that cannot be answered", async () => {
    await saved(evalRow("evr_a", EvalRunPhase.completed));
    await saved(evalRow("evr_b", EvalRunPhase.completed));
    await saved(evalRow("evr_other", EvalRunPhase.completed, "plg_2"));
    const asked: string[] = [];
    const onlyA: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${IamPermission[check.permission]} ${ApiResourceKind[check.resourceKind]} ${check.resourceId}`);
        return Promise.resolve(check.resourceId === "evr_a" ? { kind: "allow" } : { kind: "deny", reason: "" });
      },
    };
    const ctx = listCtx();
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, onlyA, silentLogger).execute(ctx);
    const list = ctx.get(EVAL_RUN_RESULT_KEY) as EvalRunList;
    expect(list.entries.map((e) => e.metadata?.id)).toEqual(["evr_a"]);
    expect(list.entries).toHaveLength(1);
    expect(asked.sort()).toEqual(["can_view eval_run evr_a", "can_view eval_run evr_b"]);

    const serverCtx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, onlyA, silentLogger).execute(serverCtx);
    expect((serverCtx.get(EVAL_RUN_RESULT_KEY) as EvalRunList).entries).toHaveLength(2);

    const down: Authorizer = {
      authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }),
    };
    const fault = await failure(() =>
      newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, down, silentLogger).execute(listCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("ListEvalRunsByPlugin's label filter", () => {
  it("walks only the plugin's evals carrying every label named, a page at a time", async () => {
    const labels = { suite: "nightly-plugin", tier: "gold" };
    const labelled = (id: string, rowLabels: Record<string, string>) => {
      const row = evalRow(id, EvalRunPhase.completed, "plg_lbl");
      row.metadata!.labels = rowLabels;
      return saved(row);
    };
    await labelled("evr_lbl_0", {});
    await labelled("evr_lbl_1", labels);
    await labelled("evr_lbl_2", { suite: "nightly-plugin" });
    await labelled("evr_lbl_3", { ...labels, extra: "x" });
    const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

    const walked: string[] = [];
    let pageToken = "";
    do {
      const ctx = new RequestContext(
        ListEvalRunsByPluginRequestSchema,
        create(ListEvalRunsByPluginRequestSchema, { pluginId: "plg_lbl", labels, pageSize: 1, pageToken }),
        testCallerIdentity(),
        ApiResourceKind.plugin,
      );
      await newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, allow, silentLogger).execute(ctx);
      const page = ctx.get(EVAL_RUN_RESULT_KEY) as EvalRunList;
      expect(page.entries.length).toBeLessThanOrEqual(1);
      walked.push(...page.entries.map((row) => row.metadata!.id));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    expect(new Set(walked)).toEqual(new Set(["evr_lbl_1", "evr_lbl_3"]));
    expect(walked).toHaveLength(2);
  });
});

describe("ListEvalRunsByPlugin's answer", () => {
  it("empties every arm's tries and keeps the summaries", async () => {
    const row = evalRow("evr_tries", EvalRunPhase.completed);
    row.status = create(EvalRunStatusSchema, {
      phase: EvalRunPhase.completed,
      plugins: [create(EvalRunPluginSchema, { pluginId: "plg_1", cases: [
        create(EvalRunCaseSchema, {
          caseName: "a",
          notes: ["a note"],
          targets: [
            create(EvalRunCaseTargetSchema, {
              withPlugin: create(EvalRunArmSchema, {
                score: 1,
                gradedTries: 2,
                tries: [
                  create(EvalRunTrySchema, { index: 1, state: EvalRunTryState.graded, score: 1 }),
                  create(EvalRunTrySchema, { index: 2, state: EvalRunTryState.graded, score: 1 }),
                ],
              }),
              withoutPlugin: create(EvalRunArmSchema, {
                score: 0,
                tries: [create(EvalRunTrySchema, { index: 1, state: EvalRunTryState.graded })],
              }),
              delta: 1,
            }),
            create(EvalRunCaseTargetSchema, { notRunReason: "not run: model 'x' is not in Stigmer's catalog" }),
          ],
        }),
      ] })],
      aggregates: { casesTotal: 1, casesPassed: 1, overallScore: 1 },
    });
    await saved(row);
    const ctx = new RequestContext(
      ListEvalRunsByPluginRequestSchema,
      create(ListEvalRunsByPluginRequestSchema, { pluginId: "plg_1" }),
      testCallerIdentity({ origin: "in-process" }),
      ApiResourceKind.plugin,
    );
    await newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", temp.store, { authorize: () => Promise.resolve({ kind: "allow" }) }, silentLogger).execute(ctx);
    const listed = (ctx.get(EVAL_RUN_RESULT_KEY) as EvalRunList).entries[0];
    const target = listed?.status?.plugins[0]?.cases[0]?.targets[0];
    expect(target?.withPlugin?.tries).toEqual([]);
    expect(target?.withoutPlugin?.tries).toEqual([]);
    expect(target?.withPlugin?.score).toBe(1);
    expect(target?.withPlugin?.gradedTries).toBe(2);
    expect(target?.delta).toBe(1);
    expect(listed?.status?.plugins[0]?.cases[0]?.notes).toEqual(["a note"]);
    expect(listed?.status?.aggregates?.casesTotal).toBe(1);
    expect((await stored("evr_tries")).status?.plugins[0]?.cases[0]?.targets[0]?.withPlugin?.tries).toHaveLength(2);
  });
});

describe("the create's question and its faults", () => {
  it("asks can_edit on the plugin, and nothing for a server-composed create", () => {
    const row = evalRow("", EvalRunPhase.unspecified, "plg_9");
    expect(resolveEvalRunCreateTargets(createCtx(row))).toEqual([
      expect.objectContaining({
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.plugin,
        resourceId: "plg_9",
      }),
    ]);
    expect(
      resolveEvalRunCreateTargets(createCtx(row, testCallerIdentity({ origin: "in-process" }))),
    ).toEqual([]);
  });

  it("passes a suite source's own refusal through, and makes any other fault INTERNAL", async () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
    );
    const row = evalRow("evr_1", EvalRunPhase.unspecified);
    row.spec!.pluginDigest = "a".repeat(64);
    const notFound = await failure(() =>
      newPlanEvalRunStep(
        { readArchive: () => Promise.reject(new ConnectError("plugin version not found", Code.NotFound)) },
        catalog,
      ).execute(planCtx(row)),
    );
    expect(notFound.code).toBe(Code.NotFound);
    const broken = await failure(() =>
      newPlanEvalRunStep({ readArchive: () => Promise.reject(new Error("disk")) }, catalog).execute(planCtx(row)),
    );
    expect(broken.code).toBe(Code.Internal);
    expect(broken.rawMessage).toBe("failed to read the plugins' evals");
  });

  it("refuses a suite past the limits with its counts, planning no cell", async () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
    );
    const files = claudePlugin({
      files: Object.fromEntries(
        Array.from({ length: 300 }, (_, index) => [
          [`evals/case-${index}/prompt.md`, "Say yes.\n"],
          [`evals/case-${index}/graders/says-yes.md`, "---\ntype: regex\npattern: yes\n---\n"],
        ]).flat(),
      ),
    });
    const row = evalRow("evr_1", EvalRunPhase.unspecified);
    row.spec!.pluginDigest = "a".repeat(64);
    row.spec!.runs = 50;
    row.spec!.targets = Array.from({ length: 6 }, () => create(EvalRunTargetSchema, { harness: Harness.NATIVE }));
    vi.mocked(matrix.planMatrix).mockClear();
    const tooLarge = await failure(() =>
      newPlanEvalRunStep({ readArchive: () => Promise.resolve(inMemoryPluginFiles(files)) }, catalog).execute(
        planCtx(row),
      ),
    );
    expect(tooLarge.code).toBe(Code.FailedPrecondition);
    expect(tooLarge.rawMessage).toBe(evalRunTooLargeMessage(300, 300 * 6 * 2 * 50));
    expect(matrix.planMatrix).not.toHaveBeenCalled();
  });

  it("is INTERNAL when the plugin cannot be read", async () => {
    const faulty = {
      getResource: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const fault = await failure(() =>
      newLoadEvalRunSubjectStep(faulty).execute(createCtx(evalRow("", EvalRunPhase.unspecified))),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("ResolveEvalRunDefaults' refusals", () => {
  function evaluated(row: EvalRun, digest = "a".repeat(64)) {
    const ctx = createCtx(row);
    ctx.set(EVAL_RUN_SUBJECT_KEY, {
      kind: "plugin",
      org: "org_1",
      row: create(PluginSchema, {
        metadata: { id: "plg_1", org: "org_1", name: "thermos", slug: "thermos" },
        status: { digest, mcpServers: [{ name: "github" }] },
      }),
    } satisfies LoadedSubject);
    return ctx;
  }

  it("refuses a request that names no organization, or carries no spec", async () => {
    const noOrg = evalRow("", EvalRunPhase.unspecified);
    noOrg.metadata!.org = "";
    const orgRefusal = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(evaluated(noOrg)),
    );
    expect(orgRefusal.code).toBe(Code.InvalidArgument);
    expect(orgRefusal.rawMessage).toBe("metadata.org is required for an eval run");

    const noSpec = evalRow("", EvalRunPhase.unspecified);
    noSpec.spec = undefined;
    const specRefusal = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(evaluated(noSpec)),
    );
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for an eval run");
  });

  it("refuses a plugin that has no version to run", async () => {
    const refused = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(
        evaluated(evalRow("", EvalRunPhase.unspecified), ""),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(evalRunNoCasesMessage("evals"));
  });

  it("refuses an allow_tools entry that names another plugin's MCP tools", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.allowTools = ["Read", "mcp__plugin_other_github__search_issues"];
    const refused = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(evaluated(row)),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(
      evalRunOtherPluginToolMessage("mcp__plugin_other_github__search_issues", "plugin_other_github"),
    );
    expect(refused.rawMessage).toBe(
      "allow_tools entry 'mcp__plugin_other_github__search_issues' names MCP server 'plugin_other_github', which is none of the plugins a try loads",
    );
  });

  it("refuses real servers asked for both beside the mocks and instead of them", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    row.spec!.allowRealServers = true;
    row.spec!.realMcpServers = true;
    const refused = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(evaluated(row)),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE);
  });

  it("keeps the plugin's own server entries and every other entry as written", async () => {
    const row = evalRow("", EvalRunPhase.unspecified);
    const tools = ["Read", "Bash(npm test *)", "mcp__plugin_thermos_github__search_issues", "mcp__github__*"];
    row.spec!.allowTools = [...tools];
    const ctx = evaluated(row);
    await newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(ctx);
    expect(ctx.newState.spec?.allowTools).toEqual(tools);
    expect(ctx.newState.metadata?.id).toMatch(/^evr_/);
  });
});

describe("a failed start's write", () => {
  const failing = workflows({ start: () => Promise.reject(new Error("no engine")) });

  it("answers NOT_FOUND naming the eval when its row is gone", async () => {
    const fault = await failure(() =>
      newStartEvalRunWorkflowStep(temp.store, failing, silentLogger).execute(
        createCtx(evalRow("evr_gone", EvalRunPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.NotFound);
    expect(fault.rawMessage).toContain("evr_gone");
  });

  it("is INTERNAL when the store cannot save the failure", async () => {
    const faulty = {
      updateResource: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const fault = await failure(() =>
      newStartEvalRunWorkflowStep(faulty, failing, silentLogger).execute(
        createCtx(evalRow("evr_1", EvalRunPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to save the eval run");
  });
});

describe("a chain built wrong", () => {
  it("fails loudly when the evaluated plugin, the cancel's target or the delete's row was never stashed", async () => {
    const noPlugin = await failure(() =>
      newResolveEvalRunDefaultsStep(temp.store, PERMIT).execute(
        createCtx(evalRow("", EvalRunPhase.unspecified)),
      ),
    );
    expect(noPlugin.code).toBe(Code.Internal);
    expect(noPlugin.rawMessage).toBe("eval run subject not found in context");

    const bare = () =>
      new RequestContext(
        EvalRunIdSchema,
        create(EvalRunIdSchema, { value: "evr_1" }),
        testCallerIdentity(),
        ApiResourceKind.eval_run,
      );
    const noTarget = await failure(() =>
      newCancelEvalRunStep(temp.store, workflows()).execute(bare()),
    );
    expect(noTarget.code).toBe(Code.Internal);
    expect(noTarget.rawMessage).toBe("eval run not found in context");

    const noExisting = await failure(() =>
      newRefuseActiveEvalRunDeleteStep().execute(bare()),
    );
    expect(noExisting.code).toBe(Code.Internal);
    expect(noExisting.rawMessage).toBe("existing eval run not found in context");
  });

  it("refuses a plan with no spec, and answers a store fault listing a plugin's evals INTERNAL", async () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
    );
    const row = evalRow("evr_1", EvalRunPhase.unspecified);
    row.spec = undefined;
    const noSpec = await failure(() =>
      newPlanEvalRunStep({ readArchive: () => Promise.reject(new Error("unread")) }, catalog).execute(
        planCtx(row),
      ),
    );
    expect(noSpec.code).toBe(Code.InvalidArgument);
    expect(noSpec.rawMessage).toBe("spec is required for an eval run");

    const faulty = {
      queryResources: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const listed = await failure(() =>
      newListEvalRunsBySubjectStep<typeof ListEvalRunsByPluginRequestSchema>("plugin", faulty, { authorize: () => Promise.resolve({ kind: "allow" }) }, silentLogger).execute(
        new RequestContext(
          ListEvalRunsByPluginRequestSchema,
          create(ListEvalRunsByPluginRequestSchema, { pluginId: "plg_1" }),
          testCallerIdentity(),
          ApiResourceKind.plugin,
        ),
      ),
    );
    expect(listed.code).toBe(Code.Internal);
    expect(listed.rawMessage).toBe("failed to list the plugin's eval runs");
  });
});
