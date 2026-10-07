/**
 * Pins the frozen identity-account slug repair (account-slugs-repaired.ts)
 * both editions' migrations apply: a slug the rule admits stands; a slug too
 * long, one starting with a digit, and an empty one are re-derived to what
 * the live derivation (pipeline/steps/slug.ts fittedSlug) gives
 * the same account today; a name longer than 200 characters is cut to 200;
 * a row's other bytes survive the rewrite; an account with nothing to
 * derive from is refused, and a row with no metadata gains one.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { fittedSlug } from "../../pipeline/steps/slug.js";
import { repairAccountName, repairAccountSlug, repairedAccountSlugRow } from "../account-slugs-repaired.js";

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
      expect(repaired, name).toBe(fittedSlug(name, idpId));
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

  it("refuses an account with no name, subject or id to derive a slug from", () => {
    const empty = create(IdentityAccountSchema, { metadata: { id: "", name: "", slug: "" }, spec: { idpId: "" } });
    expect(() => repairAccountSlug(empty)).toThrow("the account has no name, subject or id to derive a slug from");
  });

  it("gives a row with no metadata a slug derived from its subject", () => {
    const bare = create(IdentityAccountSchema, { apiVersion: "iam.stigmer.ai/v1", spec: { idpId: "auth0|bare" } });
    const after = fromBinary(IdentityAccountSchema, repairedAccountSlugRow(toBinary(IdentityAccountSchema, bare))!);
    expect(after.metadata?.slug).toBe("auth0bare");
    expect(after.spec?.idpId).toBe("auth0|bare");
  });
});

describe("repairAccountName", () => {
  it("leaves a name of 200 characters or fewer standing, and cuts a longer one to 200 characters", () => {
    expect(repairAccountName(account("pat@example.com", "patexample-com"))).toBeUndefined();
    expect(repairAccountName(account("n".repeat(200), "n-person"))).toBeUndefined();
    const long = `${"😀".repeat(201)}`;
    expect(repairAccountName(account(long, "emoji-person"))).toBe("😀".repeat(200));
  });

  it("rewrites the name of a row whose slug stands, and nothing else", () => {
    const longName = `${"n".repeat(230)}@example.com`;
    const before = account(longName, "long-name-person");
    const after = fromBinary(IdentityAccountSchema, repairedAccountSlugRow(toBinary(IdentityAccountSchema, before))!);
    expect(after.metadata?.name).toBe(longName.slice(0, 200));
    after.metadata!.name = before.metadata!.name;
    expect(toBinary(IdentityAccountSchema, after)).toEqual(toBinary(IdentityAccountSchema, before));
  });
});
