/**
 * Pins `derivedId`, the one encoder behind every id a kind derives from its
 * natural key instead of minting (metadata.proto's `id` comment: a direct
 * IdentityAccount from its subject, an IamPolicy from its triple; the
 * Organization's slug needs no encoding). Lifted from the identity-account
 * domain in 20260913.01 slice 2 so the second derived id did not carry a
 * second copy of the grammar.
 *
 * The vectors here are the two domains' golden vectors restated through
 * the shared function: `accountIdFor` and `policyIdFor` must equal
 * `derivedId(prefix, text)` over their canonical text, and those domain
 * tests pin the wire-adjacent constants. A change to the encoding
 * re-addresses every derived row open source ever wrote.
 */
import { describe, expect, it } from "vitest";

import { derivedId } from "../defaults.js";

const CROCKFORD_26 = /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

describe("derivedId — prefix, underscore, the top 130 bits of sha256 as 26 Crockford chars", () => {
  it("matches the identity-account golden vector", () => {
    // accountIdFor("auth0|user123") as pinned in identityaccount/__tests__/constants.test.ts.
    expect(derivedId("ida", "auth0|user123")).toBe(
      "ida_wtr3jcf281yfk9xx61kj59fsme",
    );
  });

  it("matches the IamPolicy golden vector over the canonical triple text", () => {
    expect(
      derivedId(
        "iamp",
        "identity_account:ida_wtr3jcf281yfk9xx61kj59fsme#@organization:acme#admin",
      ),
    ).toBe("iamp_vkbjb6nvqm77vtwnr2bj0x95f9");
  });

  it("has the minted id's shape whatever the prefix, so nothing downstream learns a second grammar", () => {
    const id = derivedId("xyz", "anything");
    expect(id.startsWith("xyz_")).toBe(true);
    expect(id.slice("xyz_".length)).toMatch(CROCKFORD_26);
  });

  it("is a pure function of prefix and text: equal inputs, equal ids; a changed byte, a changed id", () => {
    expect(derivedId("ida", "same")).toBe(derivedId("ida", "same"));
    expect(derivedId("ida", "same")).not.toBe(derivedId("ida", "same "));
    expect(derivedId("ida", "same")).not.toBe(derivedId("iamp", "same"));
  });
});
