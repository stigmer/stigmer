/**
 * Pins evalRunOfRun and isEvalRun (run-label.ts): the label's value names
 * an eval run by its `evr` prefix; a run with no label, an empty value, or
 * a value naming another kind or none belongs to no eval run, while
 * isEvalRun still reads any non-empty value as a try's, so the compose
 * steps never load personal context for a labelled run whatever its value.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { EVAL_RUN_LABEL } from "../constants.js";
import { evalRunOfRun, isEvalRun } from "../run-label.js";

function labelled(value: string | undefined) {
  return create(RunSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      labels: value === undefined ? {} : { [EVAL_RUN_LABEL]: value },
    }),
  });
}

describe("evalRunOfRun", () => {
  it("names an eval run by the id's prefix", () => {
    expect(evalRunOfRun(labelled("evr_01abc"))).toBe("evr_01abc");
  });

  it("names none for a run without the label, an empty value, or another kind's id", () => {
    expect(evalRunOfRun(undefined)).toBeUndefined();
    expect(evalRunOfRun(labelled(undefined))).toBeUndefined();
    expect(evalRunOfRun(labelled(""))).toBeUndefined();
    expect(evalRunOfRun(labelled("agt_01abc"))).toBeUndefined();
    expect(evalRunOfRun(labelled("pev_01abc")), "a retired kind's id").toBeUndefined();
    expect(evalRunOfRun(labelled("not-an-id"))).toBeUndefined();
  });

  it("leaves isEvalRun reading any value as a try's", () => {
    expect(isEvalRun(labelled("evr_01abc"))).toBe(true);
    expect(isEvalRun(labelled("agt_01abc"))).toBe(true);
    expect(isEvalRun(labelled(""))).toBe(false);
  });
});
