/**
 * Pins the frozen identity-account slug repair (account-slugs-repaired.ts)
 * both editions' migrations apply: a slug the rule admits stands; a slug too
 * long, one starting with a digit, and an empty one are re-derived to what
 * the live derivation (domain/identityaccount/slug.ts accountSlugFor) gives
 * the same account today; a row's other bytes survive the rewrite.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { accountSlugFor } from "../../domain/identityaccount/slug.js";
import { repairAccountSlug, repairedAccountSlugRow } from "../account-slugs-repaired.js";

function account(name: string, slug: string, idpId = "auth0|1"): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { id: "ida_01test", name, slug, org: "acme" },
    spec: { idpId, email: name, firstName: "Pat" },
  });
}

describe("repairAccountSlug", () => {
  it("leaves a slug the rule admits standing", () => {
    expect(repairAccountSlug(account("pat@example.com", "patexample-com"))).toBeUndefined();
    expect(repairedAccountSlugRow(toBinary(IdentityAccountSchema, account("pat@example.com", "patexample-com")))).toBeUndefined();
  });

  it("re-derives a slug too long, one starting with a digit, and an empty one, as the live derivation does", () => {
    const long = `${"x".repeat(70)}@example.com`;
    for (const [name, stored, idpId] of [
      [long, `${"x".repeat(70)}example-com`, "auth0|1"],
      ["2024intern@acme.com", "2024internacme-com", "auth0|1"],
      ["李明", "", "local|ops@example.com"],
    ] as const) {
      const repaired = repairAccountSlug(account(name, stored, idpId));
      expect(repaired, name).toBe(accountSlugFor(name, idpId));
      expect(repaired!.length).toBeLessThanOrEqual(63);
    }
  });

  it("rewrites only the slug of a row it repairs", () => {
    const before = account("2024intern@acme.com", "2024internacme-com");
    const after = fromBinary(
      IdentityAccountSchema,
      repairedAccountSlugRow(toBinary(IdentityAccountSchema, before))!,
    );
    expect(after.metadata?.slug).toBe("a-2024internacme-com");
    after.metadata!.slug = before.metadata!.slug;
    expect(toBinary(IdentityAccountSchema, after)).toEqual(toBinary(IdentityAccountSchema, before));
  });
});
