// Pins the CLI's generic verbs on a plugin eval: `stigmer get plugin-eval
// <id>` reads one by its id through the plugin-eval client, `stigmer delete
// plugin-eval <id>` deletes it there, and the kind answers to its
// `plugin-eval` spelling. An eval is started by `stigmer plugin eval`, never
// applied from a manifest, so no other generic verb reaches it.

import { create } from "@bufbuild/protobuf";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";

import { defaultRegistry } from "../../registry/index.js";
import { Verb } from "../../registry/verbs.js";
import { verbsForKind } from "../../registry/verb-support.js";
import { DELETE_HANDLERS } from "../delete.js";
import { getterFor } from "../get-bindings.js";

const pluginEval = create(PluginEvalSchema, {
  metadata: { id: "pev_1", org: "acme" },
  spec: { pluginId: "plg_1", maxCostUsd: 5 },
});

describe("the plugin eval verbs", () => {
  it("gets an eval by its id and deletes it by its id", async () => {
    const asked: string[] = [];
    const client = {
      plugineval: {
        get: async (id: string) => {
          asked.push(`get ${id}`);
          return pluginEval;
        },
        delete: async (id: string) => {
          asked.push(`delete ${id}`);
          return pluginEval;
        },
      },
    } as unknown as Stigmer;

    const got = await getterFor(ApiResourceKind.plugin_eval)!(client, { kind: "id", id: "pev_1" });
    expect(got.message).toBe(pluginEval);
    await DELETE_HANDLERS.get(ApiResourceKind.plugin_eval)!(client, "pev_1", false);
    expect(asked).toEqual(["get pev_1", "delete pev_1"]);
  });

  it("refuses to get an eval by a name, since evals are read by id", async () => {
    const client = {} as Stigmer;
    await expect(
      getterFor(ApiResourceKind.plugin_eval)!(client, { kind: "ref", org: "acme", slug: "thermos" }),
    ).rejects.toThrow("Plugin evals can only be fetched by ID");
  });

  it("promises get and delete, and no apply", () => {
    expect([...verbsForKind(ApiResourceKind.plugin_eval)].sort()).toEqual([Verb.Delete, Verb.Get].sort());
  });

  it("answers to plugin-eval and plugin-evals", () => {
    const registry = defaultRegistry();
    expect(registry.getByAlias("plugin-eval")?.kind).toBe(ApiResourceKind.plugin_eval);
    expect(registry.getByAlias("plugin-evals")?.kind).toBe(ApiResourceKind.plugin_eval);
  });
});
