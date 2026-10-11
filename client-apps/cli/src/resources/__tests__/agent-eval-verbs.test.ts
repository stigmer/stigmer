// Pins the CLI's generic verbs on an agent eval: `stigmer get agent-eval
// <id>` reads one by its id through the agent eval client, `stigmer delete
// agent-eval <id>` deletes it there, and the kind answers to its
// `agent-eval` spelling and its `aev` id prefix. An eval is started by
// `stigmer agent eval`, never applied from a manifest, so no other generic
// verb reaches it.

import { create } from "@bufbuild/protobuf";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";

import { KIND_META, defaultRegistry } from "../../registry/index.js";
import { Verb } from "../../registry/verbs.js";
import { verbsForKind } from "../../registry/verb-support.js";
import { DELETE_HANDLERS } from "../delete.js";
import { getterFor } from "../get-bindings.js";

const agentEval = create(AgentEvalSchema, {
  metadata: { id: "aev_1", org: "acme" },
  spec: { agentId: "agt_1", maxCostUsd: 5 },
});

describe("the agent eval verbs", () => {
  it("gets an eval by its id and deletes it by its id", async () => {
    const asked: string[] = [];
    const client = {
      agenteval: {
        get: async (id: string) => {
          asked.push(`get ${id}`);
          return agentEval;
        },
        delete: async (id: string) => {
          asked.push(`delete ${id}`);
          return agentEval;
        },
      },
    } as unknown as Stigmer;

    const got = await getterFor(ApiResourceKind.agent_eval)!(client, { kind: "id", id: "aev_1" });
    expect(got.message).toBe(agentEval);
    await DELETE_HANDLERS.get(ApiResourceKind.agent_eval)!(client, "aev_1", false);
    expect(asked).toEqual(["get aev_1", "delete aev_1"]);
  });

  it("refuses to get an eval by a name, since evals are read by id", async () => {
    const client = {} as Stigmer;
    await expect(
      getterFor(ApiResourceKind.agent_eval)!(client, { kind: "ref", org: "acme", slug: "support-desk" }),
    ).rejects.toThrow("Agent evals can only be fetched by ID");
  });

  it("promises get and delete, and no apply", () => {
    expect([...verbsForKind(ApiResourceKind.agent_eval)].sort()).toEqual([Verb.Delete, Verb.Get].sort());
  });

  it("answers to agent-eval, agent-evals and its id prefix", () => {
    const registry = defaultRegistry();
    expect(registry.getByAlias("agent-eval")?.kind).toBe(ApiResourceKind.agent_eval);
    expect(registry.getByAlias("agent-evals")?.kind).toBe(ApiResourceKind.agent_eval);
    expect(KIND_META.get(ApiResourceKind.agent_eval)?.idPrefix).toBe("aev");
  });
});
