/**
 * Pins the two organization-count steps (domain/organization/limit.ts) on the
 * paths a composed server cannot reach: a store that cannot count is an
 * infrastructure fault (INTERNAL), never a pass or a refusal, on create and
 * on delete; and a delete that reaches the refusal with no loaded
 * organization is a pipeline wiring bug, refused INTERNAL rather than as the
 * wire's ORGANIZATION_IS_SINGLE.
 * The composed behaviour (the refusals' codes, reasons and copy, nothing
 * written) is single-organization.test.ts's.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import {
  newOrganizationLimitStep,
  newRefuseDeletingSingleOrganizationStep,
} from "../limit.js";

async function codeOf(run: () => Promise<void> | void): Promise<Code> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error).code;
  }
  throw new Error("expected the step to refuse");
}

const DOWN = {
  listResources: () => Promise.reject(new Error("the store is down")),
} as unknown as Store;

describe("OrganizationLimit", () => {
  it("a store that cannot count is INTERNAL", async () => {
    const store = DOWN;
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema),
      testCallerIdentity(),
    );
    const step = newOrganizationLimitStep<typeof OrganizationSchema>(store, 1);
    expect(await codeOf(() => step.execute(ctx))).toBe(Code.Internal);
  });
});

describe("RefuseDeletingSingleOrganization", () => {
  it("reached with no loaded organization is INTERNAL, a wiring bug", async () => {
    const ctx = new RequestContext(
      OrganizationIdSchema,
      create(OrganizationIdSchema, { value: "stigmer" }),
      testCallerIdentity(),
    );
    const step =
      newRefuseDeletingSingleOrganizationStep<typeof OrganizationIdSchema>(
        DOWN,
      );
    expect(await codeOf(() => step.execute(ctx))).toBe(Code.Internal);
  });

  it("a store that cannot count is INTERNAL", async () => {
    const ctx = new RequestContext(
      OrganizationIdSchema,
      create(OrganizationIdSchema, { value: "stigmer" }),
      testCallerIdentity(),
    );
    ctx.set(
      EXISTING_RESOURCE_KEY,
      create(OrganizationSchema, { metadata: { id: "stigmer" } }),
    );
    const step =
      newRefuseDeletingSingleOrganizationStep<typeof OrganizationIdSchema>(
        DOWN,
      );
    expect(await codeOf(() => step.execute(ctx))).toBe(Code.Internal);
  });
});
