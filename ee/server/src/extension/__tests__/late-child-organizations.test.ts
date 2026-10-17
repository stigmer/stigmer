/**
 * Pins lateChildOrganizations (../late-child-organizations.ts): the
 * lookups handed out at build time ask the ones filled later, for every
 * read, and a read before the fill throws the boot-order error naming the
 * unit.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import { lateChildOrganizations } from "../late-child-organizations.js";

describe("lateChildOrganizations", () => {
  it("throws the boot-order error, naming the unit, for a read before the fill", () => {
    const late = lateChildOrganizations("a-unit");
    expect(() => late.lookups.listIds("org_p")).toThrow(
      "a-unit read the child organizations before the composition handed them over — a boot-order bug",
    );
    expect(() => late.lookups.findByExternalId("org_p", "cust-1")).toThrow("a-unit read the child organizations");
    expect(() => late.lookups.listIdsBeingDeleted("org_p")).toThrow("a-unit read the child organizations");
  });

  it("asks the lookups filled after it was built, for every read", async () => {
    const late = lateChildOrganizations("a-unit");
    const held = late.lookups;
    late.fill({
      findByExternalId: (parentId, externalId) =>
        Promise.resolve(create(OrganizationSchema, { metadata: { id: `${parentId}/${externalId}` } })),
      listIds: (parentId) => Promise.resolve([`${parentId}-child`]),
      listIdsBeingDeleted: (parentId) => Promise.resolve([`${parentId}-leaving`]),
    });
    expect(await held.listIds("org_p")).toEqual(["org_p-child"]);
    expect(await held.listIdsBeingDeleted("org_p")).toEqual(["org_p-leaving"]);
    expect((await held.findByExternalId("org_p", "cust-1"))?.metadata?.id).toBe("org_p/cust-1");
  });
});
