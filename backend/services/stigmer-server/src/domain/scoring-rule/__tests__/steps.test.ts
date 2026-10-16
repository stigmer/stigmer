/**
 * Pins the scoring rule steps' fault arms, which the composed lanes cannot
 * reach: a store fault while reading the agent, the agent's scoring rules or
 * saving the settings is a sanitized INTERNAL; a scoring rule deleted between
 * the update's read and its write loses the swap (the rerun's read then
 * answers NOT_FOUND); a chain built without the
 * row a step reads fails loudly as INTERNAL; the cascade's own faults; an
 * undecodable scoring rule row is skipped; a budget write's fault is thrown,
 * not read as "grading off".
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { GetScoringRuleByAgentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { reserve, settle } from "../budget.js";
import { newCascadeDeleteScoringRulesStep } from "../cascade.js";
import { listAgentScoringRules } from "../queries.js";
import {
  newCheckScoringRuleUniqueStep,
  newGetScoringRuleByAgentStep,
  newLoadEvaluatedAgentStep,
  newPersistScoringRuleSettingsStep,
  newResolveScoringRuleDefaultsStep,
  newValidateScoringRuleUpdateStep,
} from "../steps.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";

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

function scoringRuleCtx(org = "org_1") {
  return new RequestContext(
    ScoringRuleSchema,
    create(ScoringRuleSchema, {
      metadata: { id: "evl_1", name: "evl_1", org },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 1, monthlyLimitUsd: 10 },
    }),
    testCallerIdentity(),
    ApiResourceKind.scoring_rule,
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

describe("the scoring rule steps' faults", () => {
  it("answers a store fault reading the agent, the agent's scoring rules or saving the settings as INTERNAL", async () => {
    expect(await codeOf(() => newLoadEvaluatedAgentStep(failing(temp.store, "getResource")).execute(scoringRuleCtx()))).toBe(Code.Internal);
    expect(await codeOf(() => newLoadEvaluatedAgentStep(temp.store).execute(scoringRuleCtx()))).toBe(Code.NotFound);
    expect(
      await codeOf(() => newCheckScoringRuleUniqueStep(failing(temp.store, "queryResources"), silentLogger).execute(scoringRuleCtx())),
    ).toBe(Code.Internal);
    const byAgent = new RequestContext(
      GetScoringRuleByAgentRequestSchema,
      create(GetScoringRuleByAgentRequestSchema, { agentId: "agt_1" }),
      testCallerIdentity(),
      ApiResourceKind.scoring_rule,
    );
    expect(
      await codeOf(() => newGetScoringRuleByAgentStep(failing(temp.store, "queryResources"), silentLogger).execute(byAgent)),
    ).toBe(Code.Internal);
    expect(await codeOf(() => newPersistScoringRuleSettingsStep(failing(temp.store, "updateResource"), UNBOUND_CREDENTIAL_BINDING).execute(scoringRuleCtx()))).toBe(
      Code.Internal,
    );
  });

  it("loses its swap when the scoring rule went between the update's read and its write (the rerun's read answers NOT_FOUND)", async () => {
    const ctx = scoringRuleCtx();
    ctx.set(EXISTING_RESOURCE_BYTES_KEY, new Uint8Array([1]));
    expect(await codeOf(() => newPersistScoringRuleSettingsStep(temp.store, UNBOUND_CREDENTIAL_BINDING).execute(ctx))).toBe(Code.Aborted);
  });

  it("refuses a create that names no organization", async () => {
    const ctx = scoringRuleCtx("");
    expect(await codeOf(() => newResolveScoringRuleDefaultsStep().execute(ctx))).toBe(Code.InvalidArgument);
  });

  it("fails loudly when a chain is built without the row a step reads", async () => {
    expect(await codeOf(() => newResolveScoringRuleDefaultsStep().execute(scoringRuleCtx()))).toBe(Code.Internal);
    expect(await codeOf(() => newValidateScoringRuleUpdateStep().execute(scoringRuleCtx()))).toBe(Code.Internal);
    expect(
      await codeOf(() => newCascadeDeleteScoringRulesStep(temp.store, undefined, silentLogger).execute(scoringRuleCtx())),
    ).toBe(Code.Internal);
  });

  it("answers the cascade's store faults as INTERNAL", async () => {
    const agentCtx = scoringRuleCtx();
    agentCtx.set(EXISTING_RESOURCE_KEY, create(AgentSchema, { metadata: { id: "agt_1", org: "org_1" } }));
    expect(
      await codeOf(() => newCascadeDeleteScoringRulesStep(failing(temp.store, "queryResources"), undefined, silentLogger).execute(agentCtx),
      ),
    ).toBe(Code.Internal);
    await temp.store.saveResource(
      ApiResourceKind.scoring_rule,
      "evl_1",
      ScoringRuleSchema,
      create(ScoringRuleSchema, { metadata: { id: "evl_1", name: "evl_1", org: "org_1" }, spec: { agentId: "agt_1" } }),
    );
    expect(
      await codeOf(() => newCascadeDeleteScoringRulesStep(failing(temp.store, "deleteResource"), undefined, silentLogger).execute(agentCtx),
      ),
    ).toBe(Code.Internal);
  });

  it("skips a scoring rule row that does not decode", async () => {
    const undecodable = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "queryResources") {
          return () => Promise.resolve([{ id: "evl_bad", data: new Uint8Array([255, 255, 255]) }]);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await listAgentScoringRules(undecodable as Store, silentLogger, "agt_1")).toEqual([]);
  });

  it("throws a budget write's store fault rather than reading it as grading off", async () => {
    const broken = failing(temp.store, "updateResource");
    await expect(reserve(broken, "evl_1", new Date(), 0.25, "limit")).rejects.toThrow("disk full");
    await expect(settle(broken, "evl_1", new Date(), 0.25, "2026-10", 0, { kind: "graded" })).rejects.toThrow("disk full");
  });
});
