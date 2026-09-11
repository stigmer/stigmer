/**
 * Pins the identity-account domain's constants (project 20260911.11,
 * T01_1_review.md A1 and A2):
 *
 *   - the account-id derivation — `ida_` + the top 130 bits of
 *     sha256(idp_id) as 26 lowercase Crockford-base32 characters, so a
 *     derived id is indistinguishable in shape from a minted `{prefix}_{ulid}`
 *     and the primary key is the one home of "one account per subject".
 *     The golden vectors are wire-adjacent constants: a change here
 *     re-addresses every direct account open source ever created;
 *   - `idpIdOf(caller)` — the ONE place a caller becomes an issuer subject:
 *     a token-bearing caller's JWT `sub`; `local|<identityId>` for a caller
 *     with no issuer and no token (the trusted-local posture);
 *   - the byte-pinned copy moved from the cloud's handlers as-is, plus the
 *     two new sentences (the federation refusal, the immutable subject).
 */
import { describe, expect, it } from "vitest";

import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
  FEDERATION_UNIMPLEMENTED_REASON,
  LOCAL_IDP_ID_PREFIX,
  NO_IDP_ID_MESSAGE,
  USERINFO_UNAVAILABLE_PREFIX,
  accountIdFor,
  accountNotFoundMessage,
  federationUnimplementedMessage,
  idpIdImmutableMessage,
  idpIdOf,
  localIdpIdFor,
} from "../constants.js";

const CROCKFORD_ID = /^ida_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

describe("accountIdFor — the derived account id", () => {
  it("pins the golden vectors (a change re-addresses every OSS account)", () => {
    expect(accountIdFor("auth0|user123")).toBe(
      "ida_wtr3jcf281yfk9xx61kj59fsme",
    );
    expect(accountIdFor("local|system")).toBe("ida_fn0zdvkkkhhrb4wry43zba8gnn");
    expect(accountIdFor("local|operator@example.com")).toBe(
      "ida_0byc5k14t1e7b7kdxft7hwz1f7",
    );
  });

  it("has the shape of every minted id: prefix, underscore, 26 Crockford chars", () => {
    for (const subject of [
      "auth0|user123",
      "google-oauth2|109876543210",
      "x",
    ]) {
      expect(accountIdFor(subject)).toMatch(CROCKFORD_ID);
    }
  });

  it("is a pure function of the subject", () => {
    expect(accountIdFor("auth0|user123")).toBe(accountIdFor("auth0|user123"));
  });

  it("separates subjects that differ by one character", () => {
    expect(accountIdFor("auth0|user123")).not.toBe(
      accountIdFor("auth0|user124"),
    );
    expect(accountIdFor("auth0|user123")).not.toBe(
      accountIdFor("auth0|User123"),
    );
  });

  it("hashes the UTF-8 bytes — unicode and long subjects derive stably", () => {
    expect(accountIdFor("ünïcödé|日本語")).toBe(
      "ida_sk0tfhnzv2mshyh5cvpb2c84fd",
    );
    expect(accountIdFor("a".repeat(4096))).toMatch(CROCKFORD_ID);
  });

  it("refuses an empty subject — no principal, no address", () => {
    expect(() => accountIdFor("")).toThrow("idp_id must not be empty");
  });
});

describe("idpIdOf — the one place a caller becomes a subject", () => {
  const base = { callerClass: "user", rawToken: "" } as const;

  it("a caller with no issuer and no token is the local operator: local|<identityId>", () => {
    const operator: CallerIdentity = {
      ...base,
      identityId: "operator@example.com",
      issuer: "",
    };
    expect(idpIdOf(operator)).toBe("local|operator@example.com");
    expect(localIdpIdFor("system")).toBe(`${LOCAL_IDP_ID_PREFIX}system`);
  });

  it("a token-bearing caller is its JWT subject, whatever identityId was resolved to", async () => {
    // A three-segment JWT whose payload carries sub — the verifier already
    // proved the signature; this function only reads the claim.
    const payload = Buffer.from(
      JSON.stringify({ sub: "auth0|user123" }),
    ).toString("base64url");
    const resolved: CallerIdentity = {
      ...base,
      identityId: accountIdFor("auth0|user123"),
      issuer: "https://issuer.test",
      rawToken: `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`,
    };
    expect(idpIdOf(resolved)).toBe("auth0|user123");
  });

  it("a token without a readable subject yields the empty string (the UNAUTHENTICATED arm's input)", () => {
    const opaque: CallerIdentity = {
      ...base,
      identityId: "ida_whatever",
      issuer: "https://issuer.test",
      rawToken: "stk_not_a_jwt",
    };
    expect(idpIdOf(opaque)).toBe("");
  });
});

describe("byte-pinned copy", () => {
  it("moves the cloud handlers' sentences as-is", () => {
    expect(ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE).toBe(
      "Identity account not found for the authenticated user",
    );
    expect(NO_IDP_ID_MESSAGE).toBe(
      "Cannot provision account: no IDP ID in authentication context",
    );
    expect(USERINFO_UNAVAILABLE_PREFIX).toBe(
      "Failed to fetch user profile from identity provider: ",
    );
    expect(accountNotFoundMessage("ida_x")).toBe(
      "Identity account not found: ida_x",
    );
  });

  it("the two new sentences name the edition and the subject", () => {
    // The organization directory's absent-method shape ("<method> is not
    // implemented", controller.ts refusesEnumeration) so clients that match
    // on it keep working, followed by the reason a person can act on.
    expect(FEDERATION_UNIMPLEMENTED_REASON).toBe(
      "federated identity accounts are served by the Enterprise and Cloud editions",
    );
    expect(
      federationUnimplementedMessage(
        "ai.stigmer.iam.identityaccount.v1.IdentityAccountCommandController.createFederatedAccount",
      ),
    ).toBe(
      "ai.stigmer.iam.identityaccount.v1.IdentityAccountCommandController.createFederatedAccount is not implemented: federated identity accounts are served by the Enterprise and Cloud editions",
    );
    expect(idpIdImmutableMessage("auth0|user123")).toBe(
      "spec.idp_id is immutable (account subject is 'auth0|user123') — create a new account for a different subject",
    );
  });
});
