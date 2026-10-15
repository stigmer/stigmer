// Pins the CLI's scoring rule verbs: `stigmer get scoring-rule <id>` reads one by
// its id through the scoring rule client, and `stigmer delete scoring-rule <id>`
// deletes it there, switching AI grading off for its agent. A scoring rule is
// never applied from a manifest, so no other verb reaches it.

import { create } from "@bufbuild/protobuf";
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";

import { Verb } from "../../registry/verbs.js";
import { verbsForKind } from "../../registry/verb-support.js";
import { DELETE_HANDLERS } from "../delete.js";
import { getterFor } from "../get-bindings.js";

const scoringRule = create(ScoringRuleSchema, {
  metadata: { id: "evl_1", org: "acme" },
  spec: { agentId: "agt_1", enabled: true, sampleRate: 0.1, monthlyLimitUsd: 10 },
});

describe("the scoring rule verbs", () => {
  it("gets a scoring rule by its id and deletes it by its id", async () => {
    const asked: string[] = [];
    const client = {
      scoringrule: {
        get: async (id: string) => {
          asked.push(`get ${id}`);
          return scoringRule;
        },
        delete: async (id: string) => {
          asked.push(`delete ${id}`);
          return scoringRule;
        },
      },
    } as unknown as Stigmer;

    const got = await getterFor(ApiResourceKind.scoring_rule)!(client, { kind: "id", id: "evl_1" });
    expect(got.message).toBe(scoringRule);
    await DELETE_HANDLERS.get(ApiResourceKind.scoring_rule)!(client, "evl_1", false);
    expect(asked).toEqual(["get evl_1", "delete evl_1"]);
  });

  it("promises get and delete, and no apply", () => {
    expect([...verbsForKind(ApiResourceKind.scoring_rule)].sort()).toEqual([Verb.Delete, Verb.Get].sort());
  });
});
