/**
 * RefuseUnofferedEngine (refuse-unoffered-engine.ts): a turn is judged on
 * the engine ResolveRunConfig placed its conversation on. Every engine the
 * proto names is offered and passes; a number no engine owns (a row stored
 * outside validation, say, or the unused number 2) is refused with
 * FailedPrecondition naming it; a chain
 * without the placement (the step composed without ResolveRunConfig) has
 * nothing to judge and passes.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newRefuseUnofferedEngineStep } from "../refuse-unoffered-engine.js";
import { RUN_CONFIG_PLACEMENT_KEY, type RunConfigPlacement } from "../resolve-run-config.js";

function contextPlacedOn(engine: Harness | undefined): RequestContext<typeof RunSchema> {
  const ctx = new RequestContext(RunSchema, create(RunSchema, {}), testCallerIdentity(), ApiResourceKind.run);
  if (engine !== undefined) {
    ctx.set(RUN_CONFIG_PLACEMENT_KEY, { engine } as Partial<RunConfigPlacement>);
  }
  return ctx;
}

describe("RefuseUnofferedEngine", () => {
  const step = newRefuseUnofferedEngineStep();

  it.each([2, 7])("refuses a turn placed on harness %i, a number no engine owns", (engine) => {
    let thrown: unknown;
    try {
      step.execute(contextPlacedOn(engine as Harness));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((thrown as ConnectError).rawMessage).toBe(
      `the conversation names harness ${engine}, which this platform does not run`,
    );
  });

  it("passes a turn on an offered engine, or the platform default", () => {
    for (const engine of [Harness.UNSPECIFIED, Harness.STIGMER, Harness.CLAUDE]) {
      expect(() => step.execute(contextPlacedOn(engine))).not.toThrow();
    }
  });

  it("passes a chain that recorded no placement", () => {
    expect(() => step.execute(contextPlacedOn(undefined))).not.toThrow();
  });
});
