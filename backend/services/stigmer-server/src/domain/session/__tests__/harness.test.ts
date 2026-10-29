/**
 * The harness table and the offered-harness rule (harness.ts), pure: each
 * harness's label as people read it ("Stigmer", "Claude Agent"); every
 * harness the proto names is offered (Stigmer, Claude, and unspecified, the
 * platform default), and a
 * number no harness owns, 2 (the gap in the enum's numbering) included,
 * is refused naming the
 * number and the field that named it, never read as Stigmer. The
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
  HARNESSES,
  harnessFacts,
  newRefuseUnofferedHarnessStep,
  offeredHarnessRefusal,
} from "../harness.js";

describe("offeredHarnessRefusal", () => {
  it("passes the engines this platform runs, and the platform default", () => {
    for (const harness of [Harness.UNSPECIFIED, Harness.STIGMER, Harness.CLAUDE]) {
      expect(offeredHarnessRefusal(harness, "spec.harness")).toBe("");
    }
  });

  it("refuses a number no harness owns, 2 included, naming it", () => {
    for (const retired of [2, 7]) {
      expect(offeredHarnessRefusal(retired as Harness, "spec.agent.harness")).toBe(
        `spec.agent.harness names harness ${retired}, which this platform does not run`,
      );
    }
  });

  it("names and offers Stigmer and Claude Agent, unspecified read as Stigmer", () => {
    expect(HARNESSES).toEqual({
      [Harness.STIGMER]: { label: "Stigmer", offered: true },
      [Harness.CLAUDE]: { label: "Claude Agent", offered: true },
    });
    expect(harnessFacts(Harness.UNSPECIFIED)?.label).toBe("Stigmer");
    expect(harnessFacts(2 as Harness)).toBeUndefined();
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
    expect(() => step.execute(contextFor([Harness.STIGMER, Harness.CLAUDE]))).not.toThrow();
  });

  it("refuses the first unoffered engine with FailedPrecondition", () => {
    let thrown: unknown;
    try {
      step.execute(contextFor([Harness.STIGMER, 2 as Harness]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((thrown as ConnectError).rawMessage).toBe(
      "spec.targets[1].harness names harness 2, which this platform does not run",
    );
  });
});
