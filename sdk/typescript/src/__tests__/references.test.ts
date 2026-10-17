/**
 * The reading of a returned reference (references.ts): a deleted target is
 * an id with no slug, and is named "deleted <kind>".
 */
import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { deletedReferenceLabel, isDeletedReference } from "../references";

describe("returned references", () => {
  it("a reference with an id and no slug names a deleted target; a named or unset one does not", () => {
    expect(isDeletedReference({ id: "skl_01", slug: "" })).toBe(true);
    expect(isDeletedReference({ id: "skl_01", slug: "refunds" })).toBe(false);
    expect(isDeletedReference({ id: "", slug: "refunds" })).toBe(false);
    expect(isDeletedReference({ id: "", slug: "" })).toBe(false);
    expect(isDeletedReference(undefined)).toBe(false);
    // The ResourceRef lens carries no id: an empty slug there is a deleted target.
    expect(isDeletedReference({ slug: "" })).toBe(true);
    expect(isDeletedReference(null)).toBe(false);
  });

  it("names a deleted target by its kind", () => {
    expect(deletedReferenceLabel(ApiResourceKind.skill)).toBe("deleted skill");
    expect(deletedReferenceLabel(ApiResourceKind.channel_app)).toBe("deleted channel app");
    expect(deletedReferenceLabel(ApiResourceKind.session)).toBe("deleted resource");
  });
});
