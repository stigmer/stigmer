/**
 * Pins how the plugin eval's shared reads, its tries' removal, the
 * plugin-delete cascade and the organization purge answer when something
 * under them fails, over a real store opened with the server's list
 * indexes:
 *   - an eval or session row that does not decode is skipped and logged,
 *     so one bad record never takes a plugin's evals or an eval's tries
 *     down, and a session without the eval's label is never taken for a
 *     try;
 *   - removing an eval's tries answers a store fault listing them
 *     INTERNAL, skips a conversation already gone, and stops on any other
 *     failure with that failure;
 *   - the cascade does nothing in a composition that serves no evals,
 *     fails loudly when the chain never loaded the plugin, and answers a
 *     store fault listing or deleting an eval INTERNAL, naming the eval;
 *   - the purge asks only a pending or running eval's workflow to stop,
 *     and a stop that fails is logged while the row goes anyway;
 *   - the eval's vault attachers are read from and written onto its
 *     status, the one place the attachments step keeps them.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { OrganizationPurgeTarget } from "../../../extensions/organization-purge.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newCascadeDeletePluginEvalsStep } from "../cascade.js";
import { PLUGIN_EVAL_LABEL } from "../constants.js";
import { newPluginEvalPurge } from "../purge.js";
import { listPluginEvals, listTrySessionIds } from "../queries.js";
import { deletePluginEvalTries } from "../tries.js";
import type { TrySessionDeleter } from "../tries.js";
import { PLUGIN_EVAL_VAULT_ATTACHMENTS } from "../vault-attachments.js";
import type { PluginEvalWorkflows } from "../workflows.js";

const ORG = "org_01kevalfaultsevalfaultsev";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

interface LoggedLine {
  readonly level: string;
  readonly message: string;
  readonly [field: string]: unknown;
}

function recordingLogger(): { logger: Logger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  return {
    lines,
    logger: createLogger({
      level: "warn",
      pretty: false,
      write: (line) => lines.push(JSON.parse(line) as LoggedLine),
    }),
  };
}

async function saveEval(
  id: string,
  phase: PluginEvalPhase,
  pluginId = "plg_1",
): Promise<PluginEval> {
  const row = create(PluginEvalSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { pluginId },
    status: { phase },
  });
  await temp.store.saveResource(
    ApiResourceKind.plugin_eval,
    id,
    PluginEvalSchema,
    row,
  );
  return row;
}

async function saveTry(id: string, evalId: string): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, {
      metadata: {
        id,
        name: id,
        org: ORG,
        labels: { [PLUGIN_EVAL_LABEL]: evalId },
      },
    }),
  );
}

/** The store, with an undecodable row put first in every query's answer. */
function withBadRow(id: string): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === "queryResources") {
        return async (...args: Parameters<Store["queryResources"]>) => {
          const rows: ListIndexRow[] = await target.queryResources(...args);
          const bad: ListIndexRow = {
            id,
            data: new Uint8Array([0xff, 0xff, 0xff]),
            cursor: { createdAt: "", id },
          };
          return [bad, ...rows];
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function storeFailing(method: keyof Store): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk unavailable"));
      }
      return Reflect.get(target, property, receiver) as unknown;
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

describe("the shared reads", () => {
  it("skip and log a plugin eval row that does not decode, and keep the plugin's others", async () => {
    await saveEval("pev_a", PluginEvalPhase.completed);
    await saveEval("pev_other", PluginEvalPhase.completed, "plg_2");
    const { logger, lines } = recordingLogger();

    const evals = await listPluginEvals(withBadRow("pev_bad"), logger, "plg_1");

    expect(evals.map((row) => row.metadata?.id)).toEqual(["pev_a"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "skipped a plugin eval row that does not decode",
        evalId: "pev_bad",
        pluginId: "plg_1",
      }),
    ]);
  });

  it("skip and log a session row that does not decode, and keep only the eval's tries", async () => {
    await saveTry("ses_try", "pev_1");
    await saveTry("ses_elsewhere", "pev_2");
    const { logger, lines } = recordingLogger();

    const ids = await listTrySessionIds(withBadRow("ses_bad"), logger, "pev_1");

    expect(ids).toEqual(["ses_try"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "skipped a session row that does not decode",
        sessionId: "ses_bad",
        evalId: "pev_1",
      }),
    ]);
  });
});

describe("removing an eval's tries", () => {
  it("answers a store fault listing the tries INTERNAL", async () => {
    const fault = await failure(() =>
      deletePluginEvalTries(
        storeFailing("queryResources"),
        { delete: () => Promise.resolve() },
        silentLogger,
        "pev_1",
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the plugin eval's tries");
  });

  it("skips a conversation already gone and stops on any other failure with it", async () => {
    await saveTry("ses_a", "pev_1");
    await saveTry("ses_b", "pev_1");
    const asked: string[] = [];
    const goneFirst: TrySessionDeleter = {
      delete: (id) => {
        asked.push(id);
        return asked.length === 1
          ? Promise.reject(new ConnectError("session not found", Code.NotFound))
          : Promise.resolve();
      },
    };
    await deletePluginEvalTries(temp.store, goneFirst, silentLogger, "pev_1");
    expect(asked.sort()).toEqual(["ses_a", "ses_b"]);

    const refusal = new ConnectError(
      "the session has an active run",
      Code.FailedPrecondition,
    );
    const refusing: TrySessionDeleter = {
      delete: () => Promise.reject(refusal),
    };
    await expect(
      deletePluginEvalTries(temp.store, refusing, silentLogger, "pev_1"),
    ).rejects.toBe(refusal);
  });
});

describe("the plugin-delete cascade", () => {
  type PluginDelete = typeof PluginCommandController.method.delete.input;

  function deleteCtx(pluginId?: string): RequestContext<PluginDelete> {
    const input = PluginCommandController.method.delete.input;
    const ctx = new RequestContext(
      input,
      create(input),
      testCallerIdentity(),
      ApiResourceKind.plugin,
    );
    if (pluginId !== undefined) {
      ctx.set(
        EXISTING_RESOURCE_KEY,
        create(PluginSchema, { metadata: { id: pluginId, org: ORG } }),
      );
    }
    return ctx;
  }

  function cascade(store: Store) {
    return newCascadeDeletePluginEvalsStep<PluginDelete>({
      store,
      logger: silentLogger,
      authorizationLifecycle: undefined,
      sessions: () => ({ delete: () => Promise.resolve() }),
    });
  }

  it("does nothing in a composition that serves no evals", async () => {
    await saveEval("pev_a", PluginEvalPhase.completed);
    await newCascadeDeletePluginEvalsStep<PluginDelete>(undefined).execute(
      deleteCtx("plg_1"),
    );
    await newCascadeDeletePluginEvalsStep<PluginDelete>(undefined).execute(
      deleteCtx(),
    );
    expect(
      await listPluginEvals(temp.store, silentLogger, "plg_1"),
    ).toHaveLength(1);
  });

  it("fails loudly when the chain never loaded the plugin", async () => {
    const fault = await failure(() => cascade(temp.store).execute(deleteCtx()));
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe(
      "plugin not found in context (LoadExistingForDelete must run first)",
    );
  });

  it("answers a store fault listing the plugin's evals INTERNAL", async () => {
    const fault = await failure(() =>
      cascade(storeFailing("queryResources")).execute(deleteCtx("plg_1")),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe(
      "failed to list the plugin's evals for cascade delete",
    );
  });

  it("answers a store fault deleting an eval INTERNAL, naming the eval and the plugin", async () => {
    await saveEval("pev_a", PluginEvalPhase.completed);
    const fault = await failure(() =>
      cascade(storeFailing("deleteResource")).execute(deleteCtx("plg_1")),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe(
      "failed to cascade-delete plugin eval pev_a of plugin plg_1",
    );
  });
});

describe("the organization purge", () => {
  const target: OrganizationPurgeTarget = { id: ORG, parentOrg: "" };

  it("stops only an active eval's workflow, logs a stop that fails, and removes every row", async () => {
    await saveEval("pev_pending", PluginEvalPhase.pending);
    await saveEval("pev_running", PluginEvalPhase.running);
    await saveEval("pev_done", PluginEvalPhase.completed);
    const cancelled: string[] = [];
    const port: PluginEvalWorkflows = {
      start: () => Promise.resolve(),
      cancel: (id) => {
        cancelled.push(id);
        return id === "pev_running"
          ? Promise.reject(new Error("engine unreachable"))
          : Promise.resolve("requested");
      },
    };
    const { logger, lines } = recordingLogger();
    const purge = newPluginEvalPurge({
      store: temp.store,
      logger,
      grantPath: { cleanupResource: () => Promise.resolve() },
      authorizationLifecycle: undefined,
      pluginEvalWorkflows: port,
    });

    await purge.purge(target, serverActingFor("organization-purge"));

    expect(cancelled.sort()).toEqual(["pev_pending", "pev_running"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "a purged plugin eval's workflow could not be cancelled",
        evalId: "pev_running",
        error: "engine unreachable",
      }),
    ]);
    expect(await purge.holdsAny(target)).toBe(false);
  });
});

describe("the eval's vault attachers", () => {
  it("are read from and written onto the eval's status", () => {
    const row = create(PluginEvalSchema, {});
    expect(PLUGIN_EVAL_VAULT_ATTACHMENTS.attachers.get(row)).toBeUndefined();

    PLUGIN_EVAL_VAULT_ATTACHMENTS.attachers.set(row, { vlt_1: "ida_creator" });

    expect(row.status?.vaultAttachers).toEqual({ vlt_1: "ida_creator" });
    expect(PLUGIN_EVAL_VAULT_ATTACHMENTS.attachers.get(row)).toEqual({
      vlt_1: "ida_creator",
    });
  });
});
