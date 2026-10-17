/**
 * Pins the update validator's one invariant the composed suite cannot
 * break (steps.ts): ValidateRoutineUpdate reads the routine LoadExisting
 * stored, and a chain that never loaded it is a broken invariant that
 * throws INTERNAL before anything is judged. The validator's refusals are
 * pinned through the real chain in routine.composed.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ModelCatalogProvider } from "../../../modelcatalog/model-catalog-provider.js";
import { errorOf, testCallerIdentity, untouchable } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { newValidateRoutineUpdateStep } from "../steps.js";

describe("ValidateRoutineUpdate", () => {
  it("throws INTERNAL when the chain never loaded the existing routine", async () => {
    const ctx = new RequestContext(
      RoutineSchema,
      create(RoutineSchema, { metadata: { id: "rtn_1", org: "org_acme" }, spec: { timeZone: "UTC" } }),
      testCallerIdentity(),
      ApiResourceKind.routine,
    );
    const step = newValidateRoutineUpdateStep({
      store: untouchable<Store>("store"),
      modelRegistry: untouchable<ModelCatalogProvider>("registry"),
    });
    const error = await errorOf(async () => {
      await step.execute(ctx);
    });
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("existing routine not found in context");
  });
});
