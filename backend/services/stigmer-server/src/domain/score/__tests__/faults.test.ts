/**
 * Pins how the score domain answers when something under it fails, over a
 * real store opened with the server's list indexes:
 *   - a store fault is INTERNAL on every read the chains make (the run to
 *     score, a run's scores, a session's scores), and a missing run is
 *     NOT_FOUND naming it;
 *   - a chain built wrong (a step removed or reordered, so what a step
 *     reads was never stashed) fails loudly as INTERNAL instead of
 *     answering with nothing;
 *   - a score row that does not decode is skipped, so one bad record never
 *     takes a run's scores down;
 *   - a create with no spec at all is refused for its missing source;
 *   - the run-delete cascade deletes each score through the deleter, skips
 *     one already gone, and stops on any other failure as INTERNAL, and its
 *     chain step refuses to run without the run's id.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import {
  ListScoresByRunRequestSchema,
  ListScoresBySessionRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ApiResourceIdSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../pipeline/steps/delete.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newCascadeDeleteScoresStep, newRunScoreCascade } from "../cascade.js";
import { chainResult } from "../controller.js";
import type { ScoreDeleter } from "../ports.js";
import { listRunScores } from "../queries.js";
import {
  newCheckScoreUniqueStep,
  newGuardScoreSourceStep,
  newListScoresByRunStep,
  newListScoresBySessionStep,
  newLoadScoredRunStep,
  newResolveScoreDefaultsStep,
  newValidateScoreUpdateStep,
} from "../steps.js";

const PERSON = testCallerIdentity({ identityId: "ida_person", origin: "wire" });

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

/** The store with one method failing as an unreachable disk would. */
function storeFailing(method: keyof Store): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk unavailable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function feedback(fields: { spec?: false; org?: string } = {}): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org: fields.org ?? "org_1" },
    ...(fields.spec === false
      ? {}
      : {
          spec: {
            runId: "run_1",
            metric: "feedback",
            source: ScoreSource.human,
            value: { case: "passed", value: true },
          },
        }),
  });
}

function scoreCtx(score: Score) {
  return new RequestContext(ScoreSchema, score, PERSON, ApiResourceKind.score);
}

async function failureOf(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a failure");
}

async function seedScore(id: string, runId: string): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.score,
    id,
    ScoreSchema,
    create(ScoreSchema, {
      metadata: { id, name: id, slug: id, org: "org_1" },
      spec: {
        runId,
        sessionId: "ses_1",
        metric: "run-health",
        source: ScoreSource.check,
      },
    }),
  );
}

describe("the create chain's reads", () => {
  it("answers a missing run NOT_FOUND naming it, and a store fault INTERNAL", async () => {
    const missing = await failureOf(() =>
      newLoadScoredRunStep(temp.store).execute(scoreCtx(feedback())),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toContain("run_1");

    const fault = await failureOf(() =>
      newLoadScoredRunStep(storeFailing("getResource")).execute(
        scoreCtx(feedback()),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("answers a store fault reading the run's scores INTERNAL", async () => {
    const fault = await failureOf(() =>
      newCheckScoreUniqueStep(storeFailing("queryResources")).execute(
        scoreCtx(feedback()),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("refuses a create with no spec for its missing source", async () => {
    const refused = await failureOf(() =>
      newGuardScoreSourceStep().execute(scoreCtx(feedback({ spec: false }))),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toBe("spec.source is required");
  });

  it("refuses a score that names no organization", async () => {
    const refused = await failureOf(() =>
      newResolveScoreDefaultsStep().execute(scoreCtx(feedback({ org: "" }))),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
  });
});

describe("a chain built wrong", () => {
  it("fails loudly when a step's input was never stashed or never built", async () => {
    // ResolveScoreDefaults without LoadScoredRun before it.
    expect(
      (
        await failureOf(() =>
          newResolveScoreDefaultsStep().execute(scoreCtx(feedback())),
        )
      ).code,
    ).toBe(Code.Internal);
    // A spec the earlier steps would have refused or built.
    expect(
      (
        await failureOf(() =>
          newResolveScoreDefaultsStep().execute(
            scoreCtx(feedback({ spec: false })),
          ),
        )
      ).code,
    ).toBe(Code.Internal);
    expect(
      (
        await failureOf(() =>
          newCheckScoreUniqueStep(temp.store).execute(
            scoreCtx(feedback({ spec: false })),
          ),
        )
      ).code,
    ).toBe(Code.Internal);
    // ValidateScoreUpdate without LoadExisting before it.
    expect(
      (
        await failureOf(() =>
          newValidateScoreUpdateStep().execute(scoreCtx(feedback())),
        )
      ).code,
    ).toBe(Code.Internal);
    // A handler whose chain left nothing to answer with.
    expect(
      (await failureOf(() => chainResult(undefined, "score list"))).code,
    ).toBe(Code.Internal);
    expect(chainResult<string>("answer", "score list")).toBe("answer");
  });
});

describe("the list lanes", () => {
  it("answer a store fault INTERNAL", async () => {
    const byRun = new RequestContext(
      ListScoresByRunRequestSchema,
      create(ListScoresByRunRequestSchema, { runId: "run_1" }),
      PERSON,
      ApiResourceKind.score,
    );
    const bySession = new RequestContext(
      ListScoresBySessionRequestSchema,
      create(ListScoresBySessionRequestSchema, { sessionId: "ses_1" }),
      PERSON,
      ApiResourceKind.score,
    );
    const failing = storeFailing("queryResources");
    expect(
      (await failureOf(() => newListScoresByRunStep(failing).execute(byRun)))
        .code,
    ).toBe(Code.Internal);
    expect(
      (
        await failureOf(() =>
          newListScoresBySessionStep(failing).execute(bySession),
        )
      ).code,
    ).toBe(Code.Internal);
  });

  it("skip a row that does not decode, and keep the rest", async () => {
    await seedScore("scr_good", "run_1");
    const withBadRow = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "queryResources") {
          return async (...args: Parameters<Store["queryResources"]>) => {
            const rows: ListIndexRow[] = await target.queryResources(...args);
            const bad: ListIndexRow = {
              id: "scr_bad",
              data: new Uint8Array([0xff, 0xff, 0xff]),
              cursor: { createdAt: "", id: "scr_bad" },
            };
            return [bad, ...rows];
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const scores = await listRunScores(withBadRow, "run_1");
    expect(scores.map((score) => score.metadata?.id)).toEqual(["scr_good"]);
  });
});

describe("the run-delete cascade", () => {
  function deleter(
    answers: Record<string, Error | undefined>,
  ): ScoreDeleter & { readonly asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      delete: (scoreId) => {
        asked.push(scoreId);
        const failure = answers[scoreId];
        return failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure);
      },
    };
  }

  it("deletes each score, skipping one already gone", async () => {
    await seedScore("scr_a", "run_1");
    await seedScore("scr_b", "run_1");
    await seedScore("scr_other", "run_2");
    const del = deleter({
      scr_a: new ConnectError("Score not found: scr_a", Code.NotFound),
    });
    await newRunScoreCascade({
      store: temp.store,
      logger: silentLogger,
      deleter: () => del,
    }).deleteScoresOfRun("run_1");
    expect([...del.asked].sort()).toEqual(["scr_a", "scr_b"]);
  });

  it("stops on any other failure as INTERNAL, so the run's delete fails whole", async () => {
    await seedScore("scr_a", "run_1");
    const cascade = newRunScoreCascade({
      store: temp.store,
      logger: silentLogger,
      deleter: () => deleter({ scr_a: new Error("transport closed") }),
    });
    expect(
      (await failureOf(() => cascade.deleteScoresOfRun("run_1"))).code,
    ).toBe(Code.Internal);
  });

  it("answers a store fault listing the run's scores INTERNAL", async () => {
    const cascade = newRunScoreCascade({
      store: storeFailing("queryResources"),
      logger: silentLogger,
      deleter: () => deleter({}),
    });
    expect(
      (await failureOf(() => cascade.deleteScoresOfRun("run_1"))).code,
    ).toBe(Code.Internal);
  });

  it("runs in the run's delete chain only after the run's id is extracted", async () => {
    const asked: string[] = [];
    const step = newCascadeDeleteScoresStep<typeof ApiResourceIdSchema>({
      deleteScoresOfRun: (runId) => {
        asked.push(runId);
        return Promise.resolve();
      },
    });
    const ctx = new RequestContext(
      ApiResourceIdSchema,
      create(ApiResourceIdSchema, { value: "run_1" }),
      PERSON,
      ApiResourceKind.run,
    );
    expect((await failureOf(() => step.execute(ctx))).code).toBe(Code.Internal);
    ctx.set(RESOURCE_ID_KEY, "run_1");
    await step.execute(ctx);
    expect(asked).toEqual(["run_1"]);
  });
});
