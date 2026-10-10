/**
 * Pins the two guards that keep an eval from outliving its plugin when a
 * create and the plugin's delete interleave, over a real store:
 *
 *   - the plugin's delete, after its row is gone, sweeps every eval of the
 *     plugin it finds, whatever its phase, with its tries' conversations
 *     and its access, first asking a pending or running eval's workflow
 *     to cancel and waiting, bounded, for it to end, so a try's active run
 *     no longer refuses its session's delete; an eval still running after
 *     the wait is left, named in a warning; a cancel that fails, or finds
 *     no workflow, deletes the eval at once;
 *     a composition with no evals does nothing; a fault listing the evals
 *     is INTERNAL;
 *   - create, after it stores the eval and its access, reads the plugin
 *     again: a plugin gone takes the eval with it (row and access) and the
 *     create answers NOT_FOUND; a plugin still there leaves everything as
 *     it is; a fault reading the plugin or removing the row is INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginIdSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { LogFields, Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newSweepPluginEvalsAfterDeleteStep } from "../cascade.js";
import { PLUGIN_EVAL_LABEL } from "../constants.js";
import { newEnsureEvaluatedPluginStillExistsStep } from "../steps.js";
import type { TrySessionDeleter } from "../tries.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

const PLUGIN: Plugin = create(PluginSchema, {
  metadata: { id: "plg_1", name: "thermos", slug: "thermos", org: "org_1" },
});

function evalRow(id: string, phase: PluginEvalPhase): PluginEval {
  return create(PluginEvalSchema, {
    metadata: { id, name: id, org: "org_1" },
    spec: { pluginId: "plg_1", maxCostUsd: 5 },
    status: { phase },
  });
}

async function saved(row: PluginEval): Promise<PluginEval> {
  await temp.store.saveResource(ApiResourceKind.plugin_eval, row.metadata!.id, PluginEvalSchema, row);
  return row;
}

async function exists(kind: ApiResourceKind, id: string): Promise<boolean> {
  const schema = kind === ApiResourceKind.plugin_eval ? PluginEvalSchema : SessionSchema;
  return temp.store.getResource(kind, id, schema).then(
    () => true,
    () => false,
  );
}

/** A lifecycle that records each deleted resource's cleanup. */
function lifecycle(): ResourceAuthorizationLifecycle & { cleaned: string[] } {
  const cleaned: string[] = [];
  return {
    cleaned,
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: (event: ResourceDeletedEvent) => {
      cleaned.push(`${ApiResourceKind[event.kind]} ${event.resourceId}`);
      return Promise.resolve();
    },
    onVisibilityChanged: () => Promise.resolve(),
  };
}

/** `store` with one method replaced. */
function replacing(
  store: Store,
  method: "getResource" | "deleteResource" | "queryResources",
  replacement: (...args: unknown[]) => Promise<unknown>,
): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return replacement;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function failure(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a failure");
}

describe("SweepPluginEvalsAfterDelete", () => {
  function deleteCtx() {
    const ctx = new RequestContext(
      PluginIdSchema,
      create(PluginIdSchema, { value: "plg_1" }),
      testCallerIdentity(),
      ApiResourceKind.plugin,
    );
    ctx.set(EXISTING_RESOURCE_KEY, PLUGIN);
    return ctx;
  }

  it("deletes every eval created while the plugin was deleted, with its tries and access", async () => {
    await saved(evalRow("pev_late", PluginEvalPhase.pending));
    await temp.store.saveResource(
      ApiResourceKind.session,
      "ses_try",
      SessionSchema,
      create(SessionSchema, {
        metadata: { id: "ses_try", name: "try", org: "org_1", labels: { [PLUGIN_EVAL_LABEL]: "pev_late" } },
      }),
    );
    const deleted: string[] = [];
    const access = lifecycle();
    await newSweepPluginEvalsAfterDeleteStep({
      store: temp.store,
      logger: silentLogger,
      authorizationLifecycle: access,
      sessions: () => ({
        delete: async (sessionId) => {
          deleted.push(sessionId);
          await temp.store.deleteResource(ApiResourceKind.session, sessionId);
        },
      }),
    }).execute(deleteCtx());
    expect(deleted).toEqual(["ses_try"]);
    expect(await exists(ApiResourceKind.plugin_eval, "pev_late")).toBe(false);
    expect(access.cleaned).toEqual(["plugin_eval pev_late"]);
  });

  /** The sweep with a fake engine whose cancel is `cancel`, and a short wait for an eval to end. */
  function sweep(
    cancel: (evalId: string) => Promise<"requested" | "not-found">,
    logger: Logger = silentLogger,
    sessions: TrySessionDeleter = { delete: () => Promise.resolve() },
  ) {
    return newSweepPluginEvalsAfterDeleteStep({
      store: temp.store,
      logger,
      authorizationLifecycle: undefined,
      sessions: () => sessions,
      workflows: {
        start: () => Promise.resolve(),
        cancel,
      },
      endWait: { pollMs: 5, maxMs: 300 },
    }).execute(deleteCtx());
  }

  /** A workflow that, a moment after its cancel, ends its eval partial. */
  function endingAfterCancel(cancelled: string[]) {
    return async (evalId: string): Promise<"requested"> => {
      cancelled.push(evalId);
      expect(await exists(ApiResourceKind.plugin_eval, evalId), "cancelled before its row goes").toBe(true);
      setTimeout(() => {
        void temp.store.updateResource(ApiResourceKind.plugin_eval, evalId, PluginEvalSchema, (live) => {
          live.status!.phase = PluginEvalPhase.partial;
          return live;
        });
      }, 30);
      return "requested";
    };
  }

  it("asks a pending or running eval's workflow to cancel, waits for it to end, then deletes it; a failed or unneeded cancel deletes at once", async () => {
    await saved(evalRow("pev_running", PluginEvalPhase.running));
    await saved(evalRow("pev_done", PluginEvalPhase.completed));
    const cancelled: string[] = [];
    // The try's session refuses its delete while the eval still runs.
    let ended = false;
    const sessions: TrySessionDeleter = {
      delete: async () => {
        const live = await temp.store.getResource(ApiResourceKind.plugin_eval, "pev_running", PluginEvalSchema);
        ended = live.status?.phase === PluginEvalPhase.partial;
        if (!ended) {
          throw new Error("the session has an active run");
        }
      },
    };
    await temp.store.saveResource(
      ApiResourceKind.session,
      "ses_try",
      SessionSchema,
      create(SessionSchema, {
        metadata: { id: "ses_try", name: "try", org: "org_1", labels: { [PLUGIN_EVAL_LABEL]: "pev_running" } },
      }),
    );
    await sweep(endingAfterCancel(cancelled), silentLogger, sessions);
    expect(cancelled).toEqual(["pev_running"]);
    expect(ended).toBe(true);
    expect(await exists(ApiResourceKind.plugin_eval, "pev_running")).toBe(false);
    expect(await exists(ApiResourceKind.plugin_eval, "pev_done")).toBe(false);

    await saved(evalRow("pev_stuck", PluginEvalPhase.pending));
    await sweep(() => Promise.reject(new Error("no engine connection")));
    expect(await exists(ApiResourceKind.plugin_eval, "pev_stuck")).toBe(false);

    await saved(evalRow("pev_unstarted", PluginEvalPhase.pending));
    await sweep(() => Promise.resolve("not-found"));
    expect(await exists(ApiResourceKind.plugin_eval, "pev_unstarted")).toBe(false);
  });

  it("leaves an eval whose workflow has not ended in time, naming it in a warning, and still sweeps the rest", async () => {
    await saved(evalRow("pev_slow", PluginEvalPhase.running));
    await saved(evalRow("pev_gone", PluginEvalPhase.running));
    const warnings: Array<{ message: string; fields: LogFields | undefined }> = [];
    const logger: Logger = {
      ...silentLogger,
      warn: (message, fields) => {
        warnings.push({ message, fields });
      },
    };
    const started = Date.now();
    await sweep(async (evalId) => {
      if (evalId === "pev_gone") {
        // A workflow that ends its eval by deleting it meanwhile.
        await temp.store.deleteResource(ApiResourceKind.plugin_eval, evalId);
      }
      return "requested";
    }, logger);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await exists(ApiResourceKind.plugin_eval, "pev_slow")).toBe(true);
    expect(warnings).toContainEqual({
      message: "a swept plugin eval's workflow has not ended; leaving the eval",
      fields: { evalId: "pev_slow", pluginId: "plg_1" },
    });
  });

  it("does nothing in a composition with no evals, and is INTERNAL when the evals cannot be listed", async () => {
    await saved(evalRow("pev_kept", PluginEvalPhase.pending));
    await newSweepPluginEvalsAfterDeleteStep(undefined).execute(deleteCtx());
    expect(await exists(ApiResourceKind.plugin_eval, "pev_kept")).toBe(true);

    const faulty = replacing(temp.store, "queryResources", () => Promise.reject(new Error("the store is down")));
    const fault = await failure(() =>
      newSweepPluginEvalsAfterDeleteStep({
        store: faulty,
        logger: silentLogger,
        authorizationLifecycle: undefined,
        sessions: () => ({ delete: () => Promise.resolve() }),
      }).execute(deleteCtx()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the plugin's evals after its delete");
  });
});

describe("EnsureEvaluatedPluginStillExists", () => {
  function createCtx(row: PluginEval) {
    return new RequestContext(PluginEvalSchema, row, testCallerIdentity(), ApiResourceKind.plugin_eval);
  }

  it("leaves the eval when its plugin is still there", async () => {
    await temp.store.saveResource(ApiResourceKind.plugin, "plg_1", PluginSchema, PLUGIN);
    const row = await saved(evalRow("pev_1", PluginEvalPhase.pending));
    const access = lifecycle();
    await newEnsureEvaluatedPluginStillExistsStep(temp.store, access, silentLogger).execute(createCtx(row));
    expect(await exists(ApiResourceKind.plugin_eval, "pev_1")).toBe(true);
    expect(access.cleaned).toEqual([]);
  });

  it("removes the eval and its access and answers NOT_FOUND when the plugin was deleted meanwhile", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.pending));
    const access = lifecycle();
    const refused = await failure(() =>
      newEnsureEvaluatedPluginStillExistsStep(temp.store, access, silentLogger).execute(createCtx(row)),
    );
    expect(refused.code).toBe(Code.NotFound);
    expect(refused.rawMessage).toContain("plg_1");
    expect(await exists(ApiResourceKind.plugin_eval, "pev_1")).toBe(false);
    expect(access.cleaned).toEqual(["plugin_eval pev_1"]);
  });

  it("is INTERNAL when the plugin cannot be read or the eval cannot be removed", async () => {
    const row = await saved(evalRow("pev_1", PluginEvalPhase.pending));
    const unreadable = replacing(temp.store, "getResource", () => Promise.reject(new Error("the store is down")));
    const readFault = await failure(() =>
      newEnsureEvaluatedPluginStillExistsStep(unreadable, undefined, silentLogger).execute(createCtx(row)),
    );
    expect(readFault.code).toBe(Code.Internal);
    expect(readFault.rawMessage).toBe("failed to read the plugin to evaluate again");

    const undeletable = replacing(temp.store, "deleteResource", () => Promise.reject(new Error("the store is down")));
    const deleteFault = await failure(() =>
      newEnsureEvaluatedPluginStillExistsStep(undeletable, undefined, silentLogger).execute(createCtx(row)),
    );
    expect(deleteFault.code).toBe(Code.Internal);
    expect(deleteFault.rawMessage).toBe("failed to remove the plugin eval of a deleted plugin");
  });
});
