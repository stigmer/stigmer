/**
 * Pins evalOfRun and evalKindOf (plugin-eval-run.ts): the label's value
 * names a plugin eval by its `pev` prefix and an agent eval by its `aev`
 * prefix; a run with no label, an empty value, or a value naming another
 * kind or none belongs to no eval, while isPluginEvalRun still reads any
 * non-empty value as a try's, so the compose steps never load personal
 * context for a labelled run whatever its value.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { PLUGIN_EVAL_LABEL } from "../constants.js";
import { evalKindOf, evalOfRun, isPluginEvalRun } from "../plugin-eval-run.js";

function labelled(value: string | undefined) {
  return create(RunSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      labels: value === undefined ? {} : { [PLUGIN_EVAL_LABEL]: value },
    }),
  });
}

describe("evalOfRun", () => {
  it("names a plugin eval and an agent eval by the id's prefix", () => {
    expect(evalOfRun(labelled("pev_01abc"))).toEqual({ kind: "plugin", id: "pev_01abc" });
    expect(evalOfRun(labelled("aev_01abc"))).toEqual({ kind: "agent", id: "aev_01abc" });
  });

  it("names no eval for a run without the label, an empty value, or another kind's id", () => {
    expect(evalOfRun(undefined)).toBeUndefined();
    expect(evalOfRun(labelled(undefined))).toBeUndefined();
    expect(evalOfRun(labelled(""))).toBeUndefined();
    expect(evalOfRun(labelled("agt_01abc"))).toBeUndefined();
    expect(evalOfRun(labelled("not-an-id"))).toBeUndefined();
  });

  it("leaves isPluginEvalRun reading any value as a try's", () => {
    expect(isPluginEvalRun(labelled("aev_01abc"))).toBe(true);
    expect(isPluginEvalRun(labelled("agt_01abc"))).toBe(true);
    expect(isPluginEvalRun(labelled(""))).toBe(false);
  });
});

describe("evalKindOf", () => {
  it("answers the kind of an eval id, or undefined", () => {
    expect(evalKindOf("pev_x")).toBe("plugin");
    expect(evalKindOf("aev_x")).toBe("agent");
    expect(evalKindOf("run_x")).toBeUndefined();
  });
});
