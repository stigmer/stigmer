// Pins the CLI's generic verbs on an eval run: `stigmer get eval-run <id>`
// reads one by its id through the eval run client, `stigmer delete
// eval-run <id>` deletes it there, and the kind answers to its `eval-run`
// spelling and its `evr` id prefix. An eval run is started by `stigmer
// eval run`, never applied from a manifest, so no other generic verb
// reaches it.

import { create } from "@bufbuild/protobuf";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";

import { KIND_META, defaultRegistry } from "../../registry/index.js";
import { Verb } from "../../registry/verbs.js";
import { verbsForKind } from "../../registry/verb-support.js";
import { DELETE_HANDLERS } from "../delete.js";
import { getterFor } from "../get-bindings.js";

const evalRun = create(EvalRunSchema, {
  metadata: { id: "evr_1", org: "acme" },
  spec: { subject: { case: "agentId", value: "agt_1" }, maxCostUsd: 5 },
});

describe("the eval run verbs", () => {
  it("gets an eval run by its id and deletes it by its id", async () => {
    const asked: string[] = [];
    const client = {
      evalrun: {
        get: async (id: string) => {
          asked.push(`get ${id}`);
          return evalRun;
        },
        delete: async (id: string) => {
          asked.push(`delete ${id}`);
          return evalRun;
        },
      },
    } as unknown as Stigmer;

    const got = await getterFor(ApiResourceKind.eval_run)!(client, { kind: "id", id: "evr_1" });
    expect(got.message).toBe(evalRun);
    await DELETE_HANDLERS.get(ApiResourceKind.eval_run)!(client, "evr_1", false);
    expect(asked).toEqual(["get evr_1", "delete evr_1"]);
  });

  it("refuses to get an eval run by a name, since eval runs are read by id", async () => {
    const client = {} as Stigmer;
    await expect(
      getterFor(ApiResourceKind.eval_run)!(client, { kind: "ref", org: "acme", slug: "support-desk" }),
    ).rejects.toThrow("Eval runs can only be fetched by ID");
  });

  it("promises get and delete, and no apply", () => {
    expect([...verbsForKind(ApiResourceKind.eval_run)].sort()).toEqual([Verb.Delete, Verb.Get].sort());
  });

  it("answers to eval-run, eval-runs and its id prefix", () => {
    const registry = defaultRegistry();
    expect(registry.getByAlias("eval-run")?.kind).toBe(ApiResourceKind.eval_run);
    expect(registry.getByAlias("eval-runs")?.kind).toBe(ApiResourceKind.eval_run);
    expect(KIND_META.get(ApiResourceKind.eval_run)?.idPrefix).toBe("evr");
  });
});
