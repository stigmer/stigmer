/**
 * Pins the suite activities' edges over a real store and a real suite
 * (the main paths, skeleton, record and finish, are in activities.test.ts):
 *
 *   - with no attempt seam, the load reads Temporal's own attempt number,
 *     so an unreadable suite is retried on an early attempt and fails the
 *     eval on the last;
 *   - an eval whose plugin is gone plans nothing and leaves its status
 *     unwritten; an eval stored with no status at all is planned, its
 *     skeleton written into a new status;
 *   - an eval that ends while the load reads its suite (create marking a
 *     slow start failed) keeps that end: the load plans nothing and writes
 *     nothing, an unreadable suite included;
 *   - a try recorded for an eval gone writes nothing and does not throw; a
 *     try not started because the plugin was updated notes it on its case,
 *     once;
 *   - the finish ends an eval failed with the workflow's error;
 *   - an eval another writer ended between the finish's read and its write
 *     keeps that end;
 *   - a row deleted between a read and the write is left gone, while a
 *     store fault that is not "not found" is thrown, on the read and on the
 *     write, so Temporal retries the activity.
 */
import { create } from "@bufbuild/protobuf";
import { MockActivityEnvironment } from "@temporalio/testing";
import { DefaultLogger } from "@temporalio/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalSuiteSource } from "../../../domain/plugin-eval/suite.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newEvalContextLoader } from "../context.js";
import {
  FINISH_EVAL_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  PLUGIN_UPDATED_NOTE,
  PLUGIN_UPDATED_REASON,
  RECORD_TRY_ACTIVITY_NAME,
} from "../names.js";
import type { SuiteCell, TryResult } from "../names.js";
import {
  SUITE_UNREADABLE_ERROR,
  createSuiteActivities,
} from "../suite-activities.js";
import {
  DIGEST,
  EVAL_ID,
  ORG,
  PLUGIN_ID,
  catalog,
  readEval,
  seedEval,
  seedPlugin,
  silentLogger,
  suiteFiles,
  suiteSource,
} from "./support.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function activities(
  options: {
    store?: Store;
    source?: EvalSuiteSource;
    attempt?: () => number;
  } = {},
) {
  const store = options.store ?? temp.store;
  return createSuiteActivities({
    store,
    logger: silentLogger,
    contexts: newEvalContextLoader({
      store,
      suites: options.source ?? suiteSource(),
      catalog,
    }),
    ...(options.attempt === undefined ? {} : { attempt: options.attempt }),
  });
}

const CELL: SuiteCell = {
  caseIndex: 0,
  targetIndex: 0,
  arm: "with",
  tryIndex: 0,
  timeoutSeconds: 120,
};

const GRADED: TryResult = {
  sessionId: "ses_x",
  runId: "run_x",
  state: "graded",
  score: 1,
  notGradedReason: "",
  error: "",
  costUsd: 0.1,
  durationSeconds: 3,
  outOfCredit: false,
};

/** `store` with one method replaced. */
function replacing(
  store: Store,
  method: "getResource" | "updateResource",
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

/** Temporal's activity context at `attempt`, its expected failure logs muted. */
function atAttempt(attempt: number): MockActivityEnvironment {
  return new MockActivityEnvironment(
    { attempt },
    { logger: new DefaultLogger("ERROR") },
  );
}

describe("load-suite at Temporal's attempt", () => {
  it("retries an unreadable suite on an early attempt and fails the eval on the last", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const source = suiteSource();
    source.broken = true;
    const load = activities({ source })[LOAD_SUITE_ACTIVITY_NAME];

    await expect(atAttempt(1).run(load, EVAL_ID)).rejects.toThrow(
      "the archive is unreadable",
    );
    expect((await readEval(temp.store)).status?.phase).toBe(
      PluginEvalPhase.pending,
    );

    expect(await atAttempt(3).run(load, EVAL_ID)).toEqual({ kind: "stop" });
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.failed);
    expect(status?.error).toBe(SUITE_UNREADABLE_ERROR);
    expect(status?.finishedAt).toBeDefined();
  });
});

describe("load-suite", () => {
  it("plans nothing for an eval whose plugin is gone, and writes no status", async () => {
    await seedEval(temp.store);
    expect(await activities()[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID)).toEqual({
      kind: "stop",
    });
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.pending);
    expect(status?.cases).toEqual([]);
  });

  it("plans an eval stored with no status, writing its skeleton", async () => {
    await seedPlugin(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.plugin_eval,
      EVAL_ID,
      PluginEvalSchema,
      create(PluginEvalSchema, {
        metadata: { id: EVAL_ID, org: ORG, name: EVAL_ID },
        spec: create(PluginEvalSpecSchema, {
          pluginId: PLUGIN_ID,
          pluginDigest: DIGEST,
          maxCostUsd: 5,
          runs: 1,
        }),
      }),
    );
    expect((await readEval(temp.store)).status).toBeUndefined();

    const plan = await activities()[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    expect(plan).toMatchObject({ kind: "run", org: ORG, concurrency: 1 });
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.running);
    expect(status?.triesTotal).toBe(2);
    expect(status?.cases.map((planned) => planned.caseName)).toEqual([
      "first-case",
      "scaffolded",
    ]);
  });

  it("throws a store fault on the eval's read rather than planning nothing", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const faulty = replacing(temp.store, "getResource", () =>
      Promise.reject(new Error("the database is unreachable")),
    );
    await expect(
      activities({ store: faulty, attempt: () => 1 })[LOAD_SUITE_ACTIVITY_NAME](
        EVAL_ID,
      ),
    ).rejects.toThrow("the database is unreachable");
  });
});

describe("load-suite against an eval that ends while it reads", () => {
  /** A suite source whose read ends the eval first, as a create marking a slow start failed would. */
  function endingSource(options: { broken: boolean }) {
    return {
      async readArchive() {
        await temp.store.updateResource(
          ApiResourceKind.plugin_eval,
          EVAL_ID,
          PluginEvalSchema,
          (live) => {
            live.status!.phase = PluginEvalPhase.failed;
            live.status!.error = "the eval could not start: deadline exceeded";
          },
        );
        if (options.broken) {
          throw new Error("the archive is unreadable");
        }
        return suiteFiles();
      },
    };
  }

  it("plans nothing and writes nothing over the end", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const source = endingSource({ broken: false });
    expect(
      await activities({ source })[
        LOAD_SUITE_ACTIVITY_NAME
      ](EVAL_ID),
    ).toEqual({ kind: "stop" });
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.failed);
    expect(status?.error).toBe("the eval could not start: deadline exceeded");
    expect(status?.cases).toEqual([]);
  });

  it("leaves the end when the suite cannot be read on the last attempt", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const source = endingSource({ broken: true });
    expect(
      await activities({
        source,
        attempt: () => 3,
      })[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID),
    ).toEqual({ kind: "stop" });
    expect((await readEval(temp.store)).status?.error).toBe(
      "the eval could not start: deadline exceeded",
    );
  });
});

describe("record-try", () => {
  it("notes on the case, once, that the plugin was updated during the eval", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const suite = activities();
    await suite[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    const updated = {
      ...GRADED,
      state: "not-graded" as const,
      score: 0,
      notGradedReason: PLUGIN_UPDATED_REASON,
      costUsd: 0,
    };
    await suite[RECORD_TRY_ACTIVITY_NAME](EVAL_ID, CELL, updated);
    await suite[RECORD_TRY_ACTIVITY_NAME](
      EVAL_ID,
      { ...CELL, arm: "without" },
      updated,
    );
    const evalCase = (await readEval(temp.store)).status?.cases[0];
    expect(
      evalCase?.notes.filter((note) => note === PLUGIN_UPDATED_NOTE),
    ).toHaveLength(1);
    expect(evalCase?.targets[0]?.withPlugin?.tries[0]?.notGradedReason).toBe(
      PLUGIN_UPDATED_REASON,
    );
  });


  it("writes nothing for an eval gone, and does not throw", async () => {
    await activities()[RECORD_TRY_ACTIVITY_NAME](EVAL_ID, CELL, GRADED);
    await expect(readEval(temp.store)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("leaves an eval deleted between the read and the write gone", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const deleting = replacing(temp.store, "updateResource", async () => {
      await temp.store.deleteResource(ApiResourceKind.plugin_eval, EVAL_ID);
      throw new ResourceNotFoundError(`plugin_eval ${EVAL_ID}`);
    });
    await expect(
      activities({ store: deleting })[RECORD_TRY_ACTIVITY_NAME](
        EVAL_ID,
        CELL,
        GRADED,
      ),
    ).resolves.toBeUndefined();
    await expect(readEval(temp.store)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("throws a store fault on the write so the activity is retried", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const faulty = replacing(temp.store, "updateResource", () =>
      Promise.reject(new Error("the write timed out")),
    );
    await expect(
      activities({ store: faulty })[RECORD_TRY_ACTIVITY_NAME](
        EVAL_ID,
        CELL,
        GRADED,
      ),
    ).rejects.toThrow("the write timed out");
  });
});

describe("finish-eval", () => {
  it("ends the eval failed with the workflow's error", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    await activities()[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    await activities()[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, {
      phase: "failed",
      error: "a try's result could not be recorded: the store is down",
    });
    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.failed);
    expect(status?.error).toBe(
      "a try's result could not be recorded: the store is down",
    );
    expect(status?.finishedAt).toBeDefined();
  });

  it("keeps the end another writer gave the eval between the read and the write", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    await activities()[LOAD_SUITE_ACTIVITY_NAME](EVAL_ID);
    const runningRead = await readEval(temp.store);
    await temp.store.updateResource(
      ApiResourceKind.plugin_eval,
      EVAL_ID,
      PluginEvalSchema,
      (live) => {
        live.status!.phase = PluginEvalPhase.failed;
        live.status!.error = "ended elsewhere";
      },
    );
    const staleRead = replacing(temp.store, "getResource", (...args) =>
      args[0] === ApiResourceKind.plugin_eval
        ? Promise.resolve(runningRead)
        : (Reflect.apply(
            temp.store.getResource,
            temp.store,
            args,
          ) as Promise<unknown>),
    );

    await activities({ store: staleRead })[FINISH_EVAL_ACTIVITY_NAME](EVAL_ID, {
      phase: "completed",
    });

    const status = (await readEval(temp.store)).status;
    expect(status?.phase).toBe(PluginEvalPhase.failed);
    expect(status?.error).toBe("ended elsewhere");
    expect(status?.partialReason).toBe(PluginEvalPartialReason.unspecified);
    expect(status?.finishedAt).toBeUndefined();
    expect(
      status?.cases[0]?.targets[0]?.withPlugin?.tries[0]?.state,
      "the tries are left as the other writer left them",
    ).toBe(PluginEvalTryState.pending);
  });
});
