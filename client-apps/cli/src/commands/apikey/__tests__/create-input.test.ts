// Unit tests for `stigmer apikey create`'s request (commands/apikey/index.ts
// apiKeyCreateInput): `--bound-org` limits the key to one organization and
// is sent only when given, so a key created without it names none and works
// in every organization its owner holds a role in; the context organization
// is the key's metadata organization either way.

import { describe, expect, it } from "vitest";

import { apiKeyCreateInput } from "../index.js";

describe("apiKeyCreateInput", () => {
  it("limits the key to the organization --bound-org names", () => {
    expect(
      apiKeyCreateInput({ name: "ci", boundOrg: "acme" }, "org_ctx", undefined),
    ).toMatchObject({ name: "ci", org: "org_ctx", boundOrg: "acme" });
  });

  it("sends no limit when --bound-org is absent or empty", () => {
    expect(apiKeyCreateInput({ name: "ci" }, "org_ctx", undefined)).not.toHaveProperty(
      "boundOrg",
    );
    expect(
      apiKeyCreateInput({ name: "ci", boundOrg: "" }, "org_ctx", undefined),
    ).not.toHaveProperty("boundOrg");
  });
});
