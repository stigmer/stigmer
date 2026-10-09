/**
 * Pins the evaluator steps' fault arms, which the composed lanes cannot
 * reach: a store fault while reading the agent, the agent's evaluators or
 * saving the settings is a sanitized INTERNAL; an evaluator deleted between
 * the update's read and its write is NOT_FOUND; a chain built without the
 * row a step reads fails loudly as INTERNAL; the cascade's own faults; an
 * undecodable evaluator row is skipped; a budget write's fault is thrown,
 * not read as "grading off".
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { GetEvaluatorByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { reserve, settle } from "../budget.js";
import { newCascadeDeleteEvaluatorsStep } from "../cascade.js";
import { listAgentEvaluators } from "../queries.js";
import {
  newCheckEvaluatorUniqueStep,
  newGetEvaluatorByAgentStep,
  newLoadEvaluatedAgentStep,
  newPersistEvaluatorSettingsStep,
  newResolveEvaluatorDefaultsStep,
  newValidateEvaluatorUpdateStep,
} from "../steps.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

/** `store` with `method` failing as a store fault does. */
function failing(store: Store, method: keyof Store): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("disk full"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function evaluatorCtx(org = "org_1") {
  return new RequestContext(
    EvaluatorSchema,
    create(EvaluatorSchema, {
      metadata: { id: "evl_1", name: "evl_1", org },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 1, monthlyLimitUsd: 10 },
    }),
    testCallerIdentity(),
    ApiResourceKind.evaluator,
  );
}

async function codeOf(work: () => unknown): Promise<Code | undefined> {
  try {
    await work();
  } catch (error) {
    return ConnectError.from(error).code;
  }
  return undefined;
}

describe("the evaluator steps' faults", () => {
  it("answers a store fault reading the agent, the agent's evaluators or saving the settings as INTERNAL", async () => {
    expect(await codeOf(() => newLoadEvaluatedAgentStep(failing(temp.store, "getResource")).execute(evaluatorCtx()))).toBe(Code.Internal);
    expect(await codeOf(() => newLoadEvaluatedAgentStep(temp.store).execute(evaluatorCtx()))).toBe(Code.NotFound);
    expect(
      await codeOf(() => newCheckEvaluatorUniqueStep(failing(temp.store, "queryResources"), silentLogger).execute(evaluatorCtx())),
    ).toBe(Code.Internal);
    const byAgent = new RequestContext(
      GetEvaluatorByAgentRequestSchema,
      create(GetEvaluatorByAgentRequestSchema, { agentId: "agt_1" }),
      testCallerIdentity(),
      ApiResourceKind.evaluator,
    );
    expect(
      await codeOf(() => newGetEvaluatorByAgentStep(failing(temp.store, "queryResources"), silentLogger).execute(byAgent)),
    ).toBe(Code.Internal);
    expect(await codeOf(() => newPersistEvaluatorSettingsStep(failing(temp.store, "updateResource")).execute(evaluatorCtx()))).toBe(
      Code.Internal,
    );
  });

  it("answers NOT_FOUND when the evaluator went between the update's read and its write", async () => {
    expect(await codeOf(() => newPersistEvaluatorSettingsStep(temp.store).execute(evaluatorCtx()))).toBe(Code.NotFound);
  });

  it("refuses a create that names no organization", async () => {
    const ctx = evaluatorCtx("");
    expect(await codeOf(() => newResolveEvaluatorDefaultsStep().execute(ctx))).toBe(Code.InvalidArgument);
  });

  it("fails loudly when a chain is built without the row a step reads", async () => {
    expect(await codeOf(() => newResolveEvaluatorDefaultsStep().execute(evaluatorCtx()))).toBe(Code.Internal);
    expect(await codeOf(() => newValidateEvaluatorUpdateStep().execute(evaluatorCtx()))).toBe(Code.Internal);
    expect(
      await codeOf(() => newCascadeDeleteEvaluatorsStep(temp.store, undefined, silentLogger).execute(evaluatorCtx())),
    ).toBe(Code.Internal);
  });

  it("answers the cascade's store faults as INTERNAL", async () => {
    const agentCtx = evaluatorCtx();
    agentCtx.set(EXISTING_RESOURCE_KEY, create(AgentSchema, { metadata: { id: "agt_1", org: "org_1" } }));
    expect(
      await codeOf(() => newCascadeDeleteEvaluatorsStep(failing(temp.store, "queryResources"), undefined, silentLogger).execute(agentCtx),
      ),
    ).toBe(Code.Internal);
    await temp.store.saveResource(
      ApiResourceKind.evaluator,
      "evl_1",
      EvaluatorSchema,
      create(EvaluatorSchema, { metadata: { id: "evl_1", name: "evl_1", org: "org_1" }, spec: { agentId: "agt_1" } }),
    );
    expect(
      await codeOf(() => newCascadeDeleteEvaluatorsStep(failing(temp.store, "deleteResource"), undefined, silentLogger).execute(agentCtx),
      ),
    ).toBe(Code.Internal);
  });

  it("skips an evaluator row that does not decode", async () => {
    const undecodable = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "queryResources") {
          return () => Promise.resolve([{ id: "evl_bad", data: new Uint8Array([255, 255, 255]) }]);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await listAgentEvaluators(undecodable as Store, silentLogger, "agt_1")).toEqual([]);
  });

  it("throws a budget write's store fault rather than reading it as grading off", async () => {
    const broken = failing(temp.store, "updateResource");
    await expect(reserve(broken, "evl_1", new Date(), 0.25, "limit")).rejects.toThrow("disk full");
    await expect(settle(broken, "evl_1", new Date(), 0.25, 0, { kind: "graded" })).rejects.toThrow("disk full");
  });
});
