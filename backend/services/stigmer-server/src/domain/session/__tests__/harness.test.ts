/**
 * The offered-engine rule (harness.ts), pure: every engine the proto names
 * is either offered (native, Cursor, and unspecified, the platform default)
 * or refused with its own name and the field that named it, and a number
 * no engine owns is refused naming the number, never read as native. The
 * step refuses with FailedPrecondition at the first unoffered engine a
 * request names, in field order, and passes a request naming none.
 *
 * The composed write chains and the message chain are pinned in their
 * domains' composed tests (agent, session, routine, eval run, run).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  OFFERED_HARNESSES,
  newRefuseUnofferedHarnessStep,
  offeredHarnessRefusal,
} from "../harness.js";

describe("offeredHarnessRefusal", () => {
  it("passes the engines this platform runs, and the platform default", () => {
    for (const harness of [Harness.UNSPECIFIED, Harness.NATIVE, Harness.CURSOR]) {
      expect(offeredHarnessRefusal(harness, "spec.harness")).toBe("");
    }
  });

  it("refuses Claude by name, at the field that named it", () => {
    expect(offeredHarnessRefusal(Harness.CLAUDE, "spec.harness")).toBe(
      "Claude is not available on this platform yet (spec.harness)",
    );
  });

  it("refuses a number no engine owns, naming it", () => {
    expect(offeredHarnessRefusal(7 as Harness, "spec.agent.harness")).toBe(
      "spec.agent.harness names engine 7, which is not one this platform runs",
    );
  });

  it("offers exactly native and Cursor", () => {
    expect([...OFFERED_HARNESSES].sort()).toEqual([Harness.NATIVE, Harness.CURSOR].sort());
  });
});

describe("RefuseUnofferedHarness", () => {
  const step = newRefuseUnofferedHarnessStep<typeof EvalRunSchema>((run) =>
    (run.spec?.targets ?? []).map((target, index) => ({
      field: `spec.targets[${index}].harness`,
      harness: target.harness,
    })),
  );

  function contextFor(harnesses: Harness[]): RequestContext<typeof EvalRunSchema> {
    return new RequestContext(
      EvalRunSchema,
      create(EvalRunSchema, {
        spec: { targets: harnesses.map((harness) => ({ harness })) },
      }),
      testCallerIdentity(),
      ApiResourceKind.eval_run,
    );
  }

  it("passes a request naming only offered engines", () => {
    expect(() => step.execute(contextFor([Harness.NATIVE, Harness.CURSOR]))).not.toThrow();
  });

  it("refuses the first unoffered engine with FailedPrecondition", () => {
    let thrown: unknown;
    try {
      step.execute(contextFor([Harness.NATIVE, Harness.CLAUDE]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((thrown as ConnectError).rawMessage).toBe(
      "Claude is not available on this platform yet (spec.targets[1].harness)",
    );
  });
});
