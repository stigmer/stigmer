/**
 * Pins the plugin eval steps' arms the composed lanes cannot reach (no
 * engine runs behind them): a workflow that starts leaves the pending row
 * as it is; a failed start never overwrites what the workflow already
 * wrote; a cancel the workflow takes answers the row unchanged, one with no
 * workflow marks the eval partial "cancelled" unless it finished meanwhile,
 * a finished eval's cancel asks nothing, and a fault is a sanitized
 * INTERNAL; listByPlugin keeps only the evals the caller may view and
 * fails closed when the authorizer cannot answer; the create's question
 * is can_edit on the plugin and a server-composed create asks none; a
 * suite source's own refusal passes through while any other fault is
 * INTERNAL; a store fault reading the plugin is INTERNAL. The create's
 * defaults refuse a request with no organization or no spec, a plugin
 * with no version to run, and an allow_tools entry naming another
 * plugin; a failed start's write answers NOT_FOUND for a row gone and
 * INTERNAL for a store fault; a chain built wrong (the plugin, the
 * cancel's target or the delete's row never stashed) fails loudly as
 * INTERNAL instead of answering with nothing.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import {
  ListPluginEvalsByPluginRequestSchema,
  PluginEvalIdSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import type { PluginEvalList } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
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
import {
  pluginEvalNoCasesMessage,
  pluginEvalOtherPluginToolMessage,
} from "../constants.js";
import {
  EVALUATED_PLUGIN_KEY,
  PLUGIN_EVAL_RESULT_KEY,
  newCancelPluginEvalStep,
  newListPluginEvalsByPluginStep,
  newLoadEvaluatedPluginStep,
  newPlanPluginEvalStep,
  newRefuseActivePluginEvalDeleteStep,
  newResolvePluginEvalDefaultsStep,
  newStartPluginEvalWorkflowStep,
  resolvePluginEvalCreateTargets,
} from "../steps.js";
import type { PluginEvalWorkflows } from "../workflows.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function evalRow(id: string, phase: PluginEvalPhase, pluginId = "plg_1"): PluginEval {
  return create(PluginEvalSchema, {
    metadata: { id, name: id, org: "org_1" },
    spec: { pluginId, maxCostUsd: 5 },
    status: { phase },
  });
}

async function saved(row: PluginEval): Promise<PluginEval> {
  await temp.store.saveResource(ApiResourceKind.plugin_eval, row.metadata!.id, PluginEvalSchema, row);
  return row;
}

async function stored(id: string): Promise<PluginEval> {
  return temp.store.getResource(ApiResourceKind.plugin_eval, id, PluginEvalSchema);
}

function workflows(answers: Partial<PluginEvalWorkflows> = {}): PluginEvalWorkflows & { calls: string[] } {
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

function createCtx(row: PluginEval, caller = testCallerIdentity()) {
  return new RequestContext(PluginEvalSchema, row, caller, ApiResourceKind.plugin_eval);
}

function idCtx(target: PluginEval) {
  const ctx = new RequestContext(
    PluginEvalIdSchema,
    create(PluginEvalIdSchema, { value: target.metadata!.id }),
    testCallerIdentity(),
    ApiResourceKind.plugin_eval,
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

describe("StartPluginEvalWorkflow", () => {
  it("leaves the pending row as it is when the workflow starts", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.pending));
    const port = workflows();
    const ctx = createCtx(row);
    await newStartPluginEvalWorkflowStep(temp.store, port, silentLogger).execute(ctx);
    expect(port.calls).toEqual(["start pev_1"]);
    expect(ctx.newState.status?.phase).toBe(PluginEvalPhase.pending);
    expect((await stored("pev_1")).status?.phase).toBe(PluginEvalPhase.pending);
  });

  it("never overwrites what the workflow already wrote when the start fails", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.completed));
    const ctx = createCtx(row);
    await newStartPluginEvalWorkflowStep(
      temp.store,
      workflows({ start: () => Promise.reject(new Error("deadline")) }),
      silentLogger,
    ).execute(ctx);
    expect(ctx.newState.status?.phase).toBe(PluginEvalPhase.completed);
    expect(ctx.newState.status?.error).toBe("");
  });
});

describe("CancelPluginEval", () => {
  it("answers the row unchanged when the workflow takes the cancel", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.running));
    const ctx = idCtx(row);
    await newCancelPluginEvalStep(temp.store, workflows()).execute(ctx);
    expect((ctx.get(PLUGIN_EVAL_RESULT_KEY) as PluginEval).status?.phase).toBe(PluginEvalPhase.running);
    expect((await stored("pev_1")).status?.phase).toBe(PluginEvalPhase.running);
  });

  it("marks an eval with no workflow partial, cancelled", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.pending));
    const ctx = idCtx(row);
    await newCancelPluginEvalStep(temp.store, workflows({ cancel: () => Promise.resolve("not-found") })).execute(ctx);
    const answered = ctx.get(PLUGIN_EVAL_RESULT_KEY) as PluginEval;
    expect(answered.status?.phase).toBe(PluginEvalPhase.partial);
    expect(answered.status?.partialReason).toBe(PluginEvalPartialReason.cancelled);
    expect(answered.status?.finishedAt).toBeDefined();
    expect((await stored("pev_1")).status?.phase).toBe(PluginEvalPhase.partial);
  });

  it("keeps what the workflow wrote when it finished before the cancel landed", async () => {
    const loaded = evalRow("pev_1", PluginEvalPhase.running);
    await saved(evalRow("pev_1", PluginEvalPhase.completed));
    const ctx = idCtx(loaded);
    await newCancelPluginEvalStep(temp.store, workflows({ cancel: () => Promise.resolve("not-found") })).execute(ctx);
    expect((ctx.get(PLUGIN_EVAL_RESULT_KEY) as PluginEval).status?.phase).toBe(PluginEvalPhase.completed);
  });

  it("asks no workflow for a finished eval, and is INTERNAL on a fault", async () => {
    const finished = await saved(evalRow("pev_done", PluginEvalPhase.failed));
    const port = workflows();
    const ctx = idCtx(finished);
    await newCancelPluginEvalStep(temp.store, port).execute(ctx);
    expect(port.calls).toEqual([]);
    expect(ctx.get(PLUGIN_EVAL_RESULT_KEY)).toBe(finished);

    const running = await saved(evalRow("pev_1", PluginEvalPhase.running));
    const fault = await failure(() =>
      newCancelPluginEvalStep(temp.store, workflows({ cancel: () => Promise.reject(new Error("transport")) })).execute(idCtx(running)),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to cancel the plugin eval");
  });
});

describe("ListPluginEvalsByPlugin", () => {
  function listCtx(caller = testCallerIdentity()) {
    return new RequestContext(
      ListPluginEvalsByPluginRequestSchema,
      create(ListPluginEvalsByPluginRequestSchema, { pluginId: "plg_1" }),
      caller,
      ApiResourceKind.plugin,
    );
  }

  it("keeps only the evals the caller may view, and fails closed when that cannot be answered", async () => {
    await saved(evalRow("pev_a", PluginEvalPhase.completed));
    await saved(evalRow("pev_b", PluginEvalPhase.completed));
    await saved(evalRow("pev_other", PluginEvalPhase.completed, "plg_2"));
    const asked: string[] = [];
    const onlyA: Authorizer = {
      authorize: (_caller, check) => {
        asked.push(`${IamPermission[check.permission]} ${ApiResourceKind[check.resourceKind]} ${check.resourceId}`);
        return Promise.resolve(check.resourceId === "pev_a" ? { kind: "allow" } : { kind: "deny", reason: "" });
      },
    };
    const ctx = listCtx();
    await newListPluginEvalsByPluginStep(temp.store, onlyA, silentLogger).execute(ctx);
    const list = ctx.get(PLUGIN_EVAL_RESULT_KEY) as PluginEvalList;
    expect(list.items.map((e) => e.metadata?.id)).toEqual(["pev_a"]);
    expect(list.totalCount).toBe(1);
    expect(asked.sort()).toEqual(["can_view plugin_eval pev_a", "can_view plugin_eval pev_b"]);

    const serverCtx = listCtx(testCallerIdentity({ origin: "in-process" }));
    await newListPluginEvalsByPluginStep(temp.store, onlyA, silentLogger).execute(serverCtx);
    expect((serverCtx.get(PLUGIN_EVAL_RESULT_KEY) as PluginEvalList).items).toHaveLength(2);

    const down: Authorizer = {
      authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }),
    };
    const fault = await failure(() =>
      newListPluginEvalsByPluginStep(temp.store, down, silentLogger).execute(listCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("the create's question and its faults", () => {
  it("asks can_edit on the plugin, and nothing for a server-composed create", () => {
    const row = evalRow("", PluginEvalPhase.unspecified, "plg_9");
    expect(resolvePluginEvalCreateTargets(createCtx(row))).toEqual([
      expect.objectContaining({
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.plugin,
        resourceId: "plg_9",
      }),
    ]);
    expect(
      resolvePluginEvalCreateTargets(createCtx(row, testCallerIdentity({ origin: "in-process" }))),
    ).toEqual([]);
  });

  it("passes a suite source's own refusal through, and makes any other fault INTERNAL", async () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
    );
    const row = evalRow("pev_1", PluginEvalPhase.unspecified);
    row.spec!.pluginDigest = "a".repeat(64);
    const notFound = await failure(() =>
      newPlanPluginEvalStep(
        { readArchive: () => Promise.reject(new ConnectError("plugin version not found", Code.NotFound)) },
        catalog,
      ).execute(createCtx(row)),
    );
    expect(notFound.code).toBe(Code.NotFound);
    const broken = await failure(() =>
      newPlanPluginEvalStep({ readArchive: () => Promise.reject(new Error("disk")) }, catalog).execute(createCtx(row)),
    );
    expect(broken.code).toBe(Code.Internal);
    expect(broken.rawMessage).toBe("failed to read the plugin's evals");
  });

  it("is INTERNAL when the plugin cannot be read", async () => {
    const faulty = {
      getResource: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const fault = await failure(() =>
      newLoadEvaluatedPluginStep(faulty).execute(createCtx(evalRow("", PluginEvalPhase.unspecified))),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("ResolvePluginEvalDefaults' refusals", () => {
  function evaluated(row: PluginEval, digest = "a".repeat(64)) {
    const ctx = createCtx(row);
    ctx.set(
      EVALUATED_PLUGIN_KEY,
      create(PluginSchema, {
        metadata: { id: "plg_1", org: "org_1", name: "thermos", slug: "thermos" },
        status: { digest },
      }),
    );
    return ctx;
  }

  it("refuses a request that names no organization, or carries no spec", async () => {
    const noOrg = evalRow("", PluginEvalPhase.unspecified);
    noOrg.metadata!.org = "";
    const orgRefusal = await failure(() =>
      newResolvePluginEvalDefaultsStep(temp.store).execute(evaluated(noOrg)),
    );
    expect(orgRefusal.code).toBe(Code.InvalidArgument);
    expect(orgRefusal.rawMessage).toBe("metadata.org is required for a plugin eval");

    const noSpec = evalRow("", PluginEvalPhase.unspecified);
    noSpec.spec = undefined;
    const specRefusal = await failure(() =>
      newResolvePluginEvalDefaultsStep(temp.store).execute(evaluated(noSpec)),
    );
    expect(specRefusal.code).toBe(Code.InvalidArgument);
    expect(specRefusal.rawMessage).toBe("spec is required for a plugin eval");
  });

  it("refuses a plugin that has no version to run", async () => {
    const refused = await failure(() =>
      newResolvePluginEvalDefaultsStep(temp.store).execute(
        evaluated(evalRow("", PluginEvalPhase.unspecified), ""),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(pluginEvalNoCasesMessage("evals"));
  });

  it("refuses an allow_tools entry that names another plugin's MCP tools", async () => {
    const row = evalRow("", PluginEvalPhase.unspecified);
    row.spec!.allowTools = ["Read", "mcp__plugin_other_github__search_issues"];
    const refused = await failure(() =>
      newResolvePluginEvalDefaultsStep(temp.store).execute(evaluated(row)),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe(
      pluginEvalOtherPluginToolMessage("mcp__plugin_other_github__search_issues", "other", "thermos"),
    );
    expect(refused.rawMessage).toBe(
      "allow_tools entry 'mcp__plugin_other_github__search_issues' names plugin 'other', but this eval runs 'thermos'; a try attaches no other plugin",
    );
  });
});

describe("a failed start's write", () => {
  const failing = workflows({ start: () => Promise.reject(new Error("no engine")) });

  it("answers NOT_FOUND naming the eval when its row is gone", async () => {
    const fault = await failure(() =>
      newStartPluginEvalWorkflowStep(temp.store, failing, silentLogger).execute(
        createCtx(evalRow("pev_gone", PluginEvalPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.NotFound);
    expect(fault.rawMessage).toContain("pev_gone");
  });

  it("is INTERNAL when the store cannot save the failure", async () => {
    const faulty = {
      updateResource: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const fault = await failure(() =>
      newStartPluginEvalWorkflowStep(faulty, failing, silentLogger).execute(
        createCtx(evalRow("pev_1", PluginEvalPhase.pending)),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to save the plugin eval");
  });
});

describe("a chain built wrong", () => {
  it("fails loudly when the evaluated plugin, the cancel's target or the delete's row was never stashed", async () => {
    const noPlugin = await failure(() =>
      newResolvePluginEvalDefaultsStep(temp.store).execute(
        createCtx(evalRow("", PluginEvalPhase.unspecified)),
      ),
    );
    expect(noPlugin.code).toBe(Code.Internal);
    expect(noPlugin.rawMessage).toBe("evaluated plugin not found in context");

    const bare = () =>
      new RequestContext(
        PluginEvalIdSchema,
        create(PluginEvalIdSchema, { value: "pev_1" }),
        testCallerIdentity(),
        ApiResourceKind.plugin_eval,
      );
    const noTarget = await failure(() =>
      newCancelPluginEvalStep(temp.store, workflows()).execute(bare()),
    );
    expect(noTarget.code).toBe(Code.Internal);
    expect(noTarget.rawMessage).toBe("plugin eval not found in context");

    const noExisting = await failure(() =>
      newRefuseActivePluginEvalDeleteStep().execute(bare()),
    );
    expect(noExisting.code).toBe(Code.Internal);
    expect(noExisting.rawMessage).toBe("existing plugin eval not found in context");
  });

  it("refuses a plan with no spec, and answers a store fault listing a plugin's evals INTERNAL", async () => {
    const catalog = newModelCatalogProviderFromDocument(
      JSON.stringify({ models: [{ id: "native-model", harness: "native" }] }),
    );
    const row = evalRow("pev_1", PluginEvalPhase.unspecified);
    row.spec = undefined;
    const noSpec = await failure(() =>
      newPlanPluginEvalStep({ readArchive: () => Promise.reject(new Error("unread")) }, catalog).execute(
        createCtx(row),
      ),
    );
    expect(noSpec.code).toBe(Code.InvalidArgument);
    expect(noSpec.rawMessage).toBe("spec is required for a plugin eval");

    const faulty = {
      queryResources: () => Promise.reject(new Error("disk")),
    } as unknown as Store;
    const listed = await failure(() =>
      newListPluginEvalsByPluginStep(faulty, { authorize: () => Promise.resolve({ kind: "allow" }) }, silentLogger).execute(
        new RequestContext(
          ListPluginEvalsByPluginRequestSchema,
          create(ListPluginEvalsByPluginRequestSchema, { pluginId: "plg_1" }),
          testCallerIdentity(),
          ApiResourceKind.plugin,
        ),
      ),
    );
    expect(listed.code).toBe(Code.Internal);
    expect(listed.rawMessage).toBe("failed to list the plugin's evals");
  });
});
