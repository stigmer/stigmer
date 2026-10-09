// Pins the CLI's evaluator verbs: `stigmer get evaluator <id>` reads one by
// its id through the evaluator client, and `stigmer delete evaluator <id>`
// deletes it there, switching AI grading off for its agent. An evaluator is
// never applied from a manifest, so no other verb reaches it.

import { create } from "@bufbuild/protobuf";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";

import { Verb } from "../../registry/verbs.js";
import { verbsForKind } from "../../registry/verb-support.js";
import { DELETE_HANDLERS } from "../delete.js";
import { getterFor } from "../get-bindings.js";

const evaluator = create(EvaluatorSchema, {
  metadata: { id: "evl_1", org: "acme" },
  spec: { agentId: "agt_1", enabled: true, sampleRate: 0.1, monthlyLimitUsd: 10 },
});

describe("the evaluator verbs", () => {
  it("gets an evaluator by its id and deletes it by its id", async () => {
    const asked: string[] = [];
    const client = {
      evaluator: {
        get: async (id: string) => {
          asked.push(`get ${id}`);
          return evaluator;
        },
        delete: async (id: string) => {
          asked.push(`delete ${id}`);
          return evaluator;
        },
      },
    } as unknown as Stigmer;

    const got = await getterFor(ApiResourceKind.evaluator)!(client, { kind: "id", id: "evl_1" });
    expect(got.message).toBe(evaluator);
    await DELETE_HANDLERS.get(ApiResourceKind.evaluator)!(client, "evl_1", false);
    expect(asked).toEqual(["get evl_1", "delete evl_1"]);
  });

  it("promises get and delete, and no apply", () => {
    expect([...verbsForKind(ApiResourceKind.evaluator)].sort()).toEqual([Verb.Delete, Verb.Get].sort());
  });
});
