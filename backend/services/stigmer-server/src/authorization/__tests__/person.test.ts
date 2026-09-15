/**
 * Pins the one construction of the person the built-in drivers evaluate
 * for: `personFor` builds the aliases — the account id and the account's
 * issuer subject for a provisioned caller, the bare identity for an
 * unprovisioned one — and refuses an identity that names no person
 * through the same predicate that keeps such stamps out of tuples;
 * `resolvePerson` reads the account through the port the way whoAmI does
 * (by id, then by the token's subject) so a caller a verifier re-stamped
 * and a caller a composition verifier left idp-shaped both land on the
 * same person, and a store fault propagates as the fault it is.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { fakeIdentityAccountStore } from "../../domain/identityaccount/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { personFor, resolvePerson } from "../person.js";

function caller(identityId: string): CallerIdentity {
  return {
    identityId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

/** A caller whose raw token carries `sub` — what a composition verifier that stamps the raw subject produces. */
function jwtCaller(sub: string, identityId: string = sub): CallerIdentity {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return {
    identityId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: `h.${payload}.unsigned`,
  };
}

function seeded(sub: string) {
  const accounts = fakeIdentityAccountStore();
  const id = accountIdFor(sub);
  accounts.rows.set(
    id,
    create(IdentityAccountSchema, {
      metadata: { id, name: sub },
      spec: {
        idpId: sub,
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  return { accounts, id };
}

describe("personFor", () => {
  it("a provisioned caller is their account id and the account's issuer subject", () => {
    const account = create(IdentityAccountSchema, {
      metadata: { id: "ida_carol" },
      spec: { idpId: "auth0|carol" },
    });
    const person = personFor(caller("ida_carol"), account);
    expect(person.accountId).toBe("ida_carol");
    expect([...person.aliases].sort()).toEqual(["auth0|carol", "ida_carol"]);
  });

  it("an unprovisioned caller is their identity id alone", () => {
    const person = personFor(caller("auth0|newcomer"), undefined);
    expect(person.accountId).toBe("auth0|newcomer");
    expect([...person.aliases]).toEqual(["auth0|newcomer"]);
  });

  it("refuses an identity that names no person — the empty id and the laptop's placeholder", () => {
    expect(() => personFor(caller(""), undefined)).toThrow("names no person");
    expect(() => personFor(caller("system"), undefined)).toThrow(
      "names no person",
    );
  });
});

describe("resolvePerson", () => {
  it("a caller stamped with the account id resolves by id — one read, the subject never consulted", async () => {
    const { accounts, id } = seeded("auth0|carol");
    const person = await resolvePerson(accounts, caller(id));
    expect(person.accountId).toBe(id);
    expect([...person.aliases].sort()).toEqual(["auth0|carol", id].sort());
  });

  it("a caller a verifier left idp-shaped resolves through the token's subject to the same person", async () => {
    const { accounts, id } = seeded("auth0|carol");
    const person = await resolvePerson(accounts, jwtCaller("auth0|carol"));
    expect(person.accountId).toBe(id);
    expect(person.aliases.has("auth0|carol")).toBe(true);
  });

  it("an unprovisioned subject is themselves alone and holds nothing", async () => {
    const person = await resolvePerson(
      fakeIdentityAccountStore(),
      jwtCaller("auth0|stranger"),
    );
    expect(person.accountId).toBe("auth0|stranger");
    expect([...person.aliases]).toEqual(["auth0|stranger"]);
  });

  it("a store fault propagates as the fault it is — the driver above folds it, never this function", async () => {
    const accounts = fakeIdentityAccountStore();
    const fault = new Error("connection reset");
    accounts.findById = () => Promise.reject(fault);
    await expect(resolvePerson(accounts, caller("ida_x"))).rejects.toBe(fault);
  });
});
