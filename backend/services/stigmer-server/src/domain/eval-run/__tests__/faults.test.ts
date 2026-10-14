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
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
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
import { newCascadeDeleteEvalRunsStep } from "../cascade.js";
import { EVAL_RUN_LABEL } from "../constants.js";
import { newEvalRunPurge } from "../purge.js";
import { listEvalRuns, listTrySessionIds } from "../queries.js";
import { deleteEvalRunTries } from "../tries.js";
import type { TrySessionDeleter } from "../tries.js";
import { EVAL_RUN_VAULT_ATTACHMENTS } from "../vault-attachments.js";
import type { EvalRunWorkflows } from "../workflows.js";

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
  phase: EvalRunPhase,
  pluginId = "plg_1",
): Promise<EvalRun> {
  const row = create(EvalRunSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { subject: { case: "pluginId", value: pluginId } },
    status: { phase },
  });
  await temp.store.saveResource(
    ApiResourceKind.eval_run,
    id,
    EvalRunSchema,
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
        labels: { [EVAL_RUN_LABEL]: evalId },
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
    await saveEval("evr_a", EvalRunPhase.completed);
    await saveEval("evr_other", EvalRunPhase.completed, "plg_2");
    const { logger, lines } = recordingLogger();

    const evals = await listEvalRuns(withBadRow("evr_bad"), logger, { kind: "plugin", id: "plg_1" });

    expect(evals.map((row) => row.metadata?.id)).toEqual(["evr_a"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "skipped a plugin eval row that does not decode",
        evalId: "evr_bad",
        pluginId: "plg_1",
      }),
    ]);
  });

  it("skip and log a session row that does not decode, and keep only the eval's tries", async () => {
    await saveTry("ses_try", "evr_1");
    await saveTry("ses_elsewhere", "evr_2");
    const { logger, lines } = recordingLogger();

    const ids = await listTrySessionIds(withBadRow("ses_bad"), logger, "evr_1");

    expect(ids).toEqual(["ses_try"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "skipped a session row that does not decode",
        sessionId: "ses_bad",
        evalId: "evr_1",
      }),
    ]);
  });
});

describe("removing an eval's tries", () => {
  it("answers a store fault listing the tries INTERNAL", async () => {
    const fault = await failure(() =>
      deleteEvalRunTries(
        storeFailing("queryResources"),
        { delete: () => Promise.resolve() },
        silentLogger,
        "evr_1",
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to list the plugin eval's tries");
  });

  it("skips a conversation already gone and stops on any other failure with it", async () => {
    await saveTry("ses_a", "evr_1");
    await saveTry("ses_b", "evr_1");
    const asked: string[] = [];
    const goneFirst: TrySessionDeleter = {
      delete: (id) => {
        asked.push(id);
        return asked.length === 1
          ? Promise.reject(new ConnectError("session not found", Code.NotFound))
          : Promise.resolve();
      },
    };
    await deleteEvalRunTries(temp.store, goneFirst, silentLogger, "evr_1");
    expect(asked.sort()).toEqual(["ses_a", "ses_b"]);

    const refusal = new ConnectError(
      "the session has an active run",
      Code.FailedPrecondition,
    );
    const refusing: TrySessionDeleter = {
      delete: () => Promise.reject(refusal),
    };
    await expect(
      deleteEvalRunTries(temp.store, refusing, silentLogger, "evr_1"),
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
    return newCascadeDeleteEvalRunsStep<PluginDelete>("plugin", {
      store,
      logger: silentLogger,
      authorizationLifecycle: undefined,
      sessions: () => ({ delete: () => Promise.resolve() }),
    });
  }

  it("does nothing in a composition that serves no evals", async () => {
    await saveEval("evr_a", EvalRunPhase.completed);
    await newCascadeDeleteEvalRunsStep<PluginDelete>("plugin", undefined).execute(
      deleteCtx("plg_1"),
    );
    await newCascadeDeleteEvalRunsStep<PluginDelete>("plugin", undefined).execute(
      deleteCtx(),
    );
    expect(
      await listEvalRuns(temp.store, silentLogger, { kind: "plugin", id: "plg_1" }),
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
    await saveEval("evr_a", EvalRunPhase.completed);
    const fault = await failure(() =>
      cascade(storeFailing("deleteResource")).execute(deleteCtx("plg_1")),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe(
      "failed to cascade-delete plugin eval evr_a of plugin plg_1",
    );
  });
});

describe("the organization purge", () => {
  const target: OrganizationPurgeTarget = { id: ORG, parentOrg: "" };

  it("stops only an active eval's workflow, logs a stop that fails, and removes every row", async () => {
    await saveEval("evr_pending", EvalRunPhase.pending);
    await saveEval("evr_running", EvalRunPhase.running);
    await saveEval("evr_done", EvalRunPhase.completed);
    const cancelled: string[] = [];
    const port: EvalRunWorkflows = {
      start: () => Promise.resolve(),
      cancel: (id) => {
        cancelled.push(id);
        return id === "evr_running"
          ? Promise.reject(new Error("engine unreachable"))
          : Promise.resolve("requested");
      },
    };
    const { logger, lines } = recordingLogger();
    const purge = newEvalRunPurge({
      store: temp.store,
      logger,
      grantPath: { cleanupResource: () => Promise.resolve() },
      authorizationLifecycle: undefined,
      evalRunWorkflows: port,
    });

    await purge.purge(target, serverActingFor("organization-purge"));

    expect(cancelled.sort()).toEqual(["evr_pending", "evr_running"]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "a purged plugin eval's workflow could not be cancelled",
        evalId: "evr_running",
        error: "engine unreachable",
      }),
    ]);
    expect(await purge.holdsAny(target)).toBe(false);
  });
});

describe("the eval's vault attachers", () => {
  it("are read from and written onto the eval's status", () => {
    const row = create(EvalRunSchema, {});
    expect(EVAL_RUN_VAULT_ATTACHMENTS.attachers.get(row)).toBeUndefined();

    EVAL_RUN_VAULT_ATTACHMENTS.attachers.set(row, { vlt_1: "ida_creator" });

    expect(row.status?.vaultAttachers).toEqual({ vlt_1: "ida_creator" });
    expect(EVAL_RUN_VAULT_ATTACHMENTS.attachers.get(row)).toEqual({
      vlt_1: "ida_creator",
    });
  });
});
