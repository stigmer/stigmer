// Pins which kinds the emitters treat as organization-less. The answer comes
// from kind_meta.authorization.scope_type in api_resource_kind.proto, so a
// kind that gains or loses an organization moves its SDK inputs and its
// reference page with it on the next codegen run; these cases fail if the
// descriptor read stops seeing the option.
import { describe, expect, it } from "vitest";

import { isOrglessKind } from "./resource-kind.js";

describe("organization-less kinds", () => {
  it("names License and Plan, whose contract says metadata.org is empty", () => {
    expect(isOrglessKind("license")).toBe(true);
    expect(isOrglessKind("plan")).toBe(true);
  });

  it("does not name an organization-scoped kind", () => {
    expect(isOrglessKind("agent")).toBe(false);
    expect(isOrglessKind("organization")).toBe(false);
  });

  it("answers false for a name that is not a kind", () => {
    expect(isOrglessKind("not_a_kind")).toBe(false);
  });
});
