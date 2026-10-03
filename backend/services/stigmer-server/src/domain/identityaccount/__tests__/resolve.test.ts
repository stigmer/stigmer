/**
 * Pins the one statement of "what identityId does this subject get
 * stamped with" (resolve.ts; 20260911.11 Q-IA-2, A1, A6), the rule both
 * verifiers call after their credential checks pass:
 *
 *   - a subject with a DIRECT account resolves to that account's id (the
 *     cloud's direct-login posture, iam/direct/verifier.ts);
 *   - a subject without one is returned unchanged, so the caller is
 *     admitted idp-shaped and whoAmI / provisionMyAccount can run;
 *   - one `findDirectByIdpId` read per call, no cache — a row that
 *     appears between two calls is seen by the second (the liveness
 *     posture the API-key lane already has);
 *   - a store fault propagates as the SAME error object, never a
 *     credential rejection (the chassis maps a non-ConnectError to
 *     INTERNAL);
 *   - a hit whose row carries no id is an infrastructure fault naming the
 *     subject, never a `""` principal — the one deliberate divergence
 *     from the cloud's inline `?? ""`.
 *
 * `identityIdForSubject` is now the deprecated id view of
 * `principalForSubject`, so the block above also pins that the view moved
 * no behaviour. The principal itself (stigmer/stigmer#1226):
 *
 *   - a hit is the account id with the row's email and display name, the
 *     credential's claims filling only a field the row leaves empty, so a
 *     token with no profile claims still names the person;
 *   - a miss is the subject with its claims, an empty claim left out;
 *   - the same single read, the same faults.
 *
 * And the read in the other direction, `accountForCaller` (20260913.01
 * slice 4, Q-S4-1): the account a CallerIdentity stands for, the two
 * primary-key reads whoAmI has always made, stated once so the built-in
 * role lifecycle and whoAmI cannot disagree:
 *
 *   - an identityId that IS an account id resolves by that id (the
 *     verifier already re-stamped);
 *   - otherwise the caller's subject (idpIdOf) resolves through the direct
 *     lookup — the trusted-local operator's `local|<email>` and a
 *     composition verifier that stamps the raw subject both land here;
 *   - a caller whose credential names no subject (an opaque token) is
 *     `undefined` with NO second read — the store is never asked about "";
 *   - an idp-shaped caller with no account is `undefined`.
 *
 * And the question the API-key verifier asks of a stamp that resolved to
 * nobody, `isPreSignInOperatorStamp` (stigmer/stigmer#1169): does it name
 * the operator of the server's life before sign-in was turned on? Written
 * failing before the export exists.
 *
 *   - the `"system"` placeholder does, with no read (it is only ever the
 *     unconfigured laptop's operator);
 *   - an email with a `local|<email>` account in the store does;
 *   - an email with no such account does not (an issuer subject that
 *     happens to look like an email);
 *   - an account-id stamp and the empty stamp do not, with no read, so the
 *     common key costs the verifier nothing;
 *   - a store fault propagates as the same error.
 *
 * And provisionMyAccount's admission, `mayProvisionDirectAccount`: did the
 * platform's own sign-in vouch for this caller? Over a store whose direct
 * read answers no federated and no platform-client row, as the port says:
 *
 *   - the trusted-local operator (no issuer, no token) is admitted;
 *   - an idp-shaped `user` caller (no account, identity = subject) is;
 *   - a caller that is already its subject's direct account is;
 *   - a caller whose account is a federated one is not, whether or not a
 *     platform person holds the direct account of the subject its token
 *     names: that subject is the provider's to choose;
 *   - a platform client's user is not, nor a system lane's token (its
 *     identity is its lane account, whose id no direct row carries as a
 *     subject), nor any caller that is not of class `user`, nor a
 *     credential naming no subject.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { accountIdFor, localIdpIdFor } from "../constants.js";
import {
  accountForCaller,
  identityIdForSubject,
  isPreSignInOperatorStamp,
  mayProvisionDirectAccount,
  principalForSubject,
} from "../resolve.js";
import type { AccountsByCaller, AccountsBySubject } from "../resolve.js";
import { fakeIdentityAccountStore } from "./support.js";

function seeded(sub: string, id: string = accountIdFor(sub)) {
  const accounts = fakeIdentityAccountStore();
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
  return accounts;
}

describe("identityIdForSubject", () => {
  it("a subject with an account resolves to the account's id", async () => {
    const accounts = seeded("auth0|known");
    expect(await identityIdForSubject(accounts, "auth0|known")).toBe(
      accountIdFor("auth0|known"),
    );
  });

  it("a subject without an account is returned unchanged — the caller stays idp-shaped", async () => {
    const accounts = seeded("auth0|someone-else");
    expect(await identityIdForSubject(accounts, "auth0|unknown")).toBe(
      "auth0|unknown",
    );
  });

  it("is one read per call with no cache — a row that appears between two calls is seen by the second", async () => {
    const accounts = fakeIdentityAccountStore();
    const lookup = vi.spyOn(accounts, "findDirectByIdpId");

    expect(await identityIdForSubject(accounts, "auth0|late")).toBe(
      "auth0|late",
    );
    accounts.rows.set(
      accountIdFor("auth0|late"),
      create(IdentityAccountSchema, {
        metadata: { id: accountIdFor("auth0|late"), name: "late" },
        spec: {
          idpId: "auth0|late",
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
    expect(await identityIdForSubject(accounts, "auth0|late")).toBe(
      accountIdFor("auth0|late"),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenNthCalledWith(1, "auth0|late");
    expect(lookup).toHaveBeenNthCalledWith(2, "auth0|late");
  });

  it("a store fault propagates as the same error — never a credential rejection", async () => {
    const fault = new Error("store is on fire");
    const broken: AccountsBySubject = {
      findDirectByIdpId: () => Promise.reject(fault),
    };
    const error = await identityIdForSubject(broken, "auth0|anyone").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBe(fault);
    expect(error).not.toBeInstanceOf(ConnectError);
  });

  it("a hit whose row carries no id is an infrastructure fault naming the subject — never a '' principal", async () => {
    const accounts = seeded("auth0|corrupt", "");
    const error = await identityIdForSubject(accounts, "auth0|corrupt").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("auth0|corrupt");
  });
});

describe("principalForSubject", () => {
  function profiled(
    sub: string,
    spec: { email?: string; firstName?: string; lastName?: string },
  ) {
    const accounts = fakeIdentityAccountStore();
    const id = accountIdFor(sub);
    accounts.rows.set(
      id,
      create(IdentityAccountSchema, {
        metadata: { id, name: spec.email ?? "" },
        spec: {
          idpId: sub,
          provisioningMode: IdentityAccountProvisioningMode.direct,
          ...spec,
        },
      }),
    );
    return accounts;
  }

  it("a hit is the account, named by its row — a token with no profile claims still names the person", async () => {
    const accounts = profiled("auth0|ada", {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(await principalForSubject(accounts, "auth0|ada")).toEqual({
      identityId: accountIdFor("auth0|ada"),
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });

  it("the row wins over the token's claims, field by field", async () => {
    const accounts = profiled("auth0|ada", {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(
      await principalForSubject(accounts, "auth0|ada", {
        email: "old@example.com",
        displayName: "Countess",
      }),
    ).toEqual({
      identityId: accountIdFor("auth0|ada"),
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });

  it("a claim fills only a field the row leaves empty", async () => {
    const accounts = profiled("auth0|bare", {});
    expect(
      await principalForSubject(accounts, "auth0|bare", {
        email: "bare@example.com",
        displayName: "Bare Person",
      }),
    ).toEqual({
      identityId: accountIdFor("auth0|bare"),
      email: "bare@example.com",
      displayName: "Bare Person",
    });
  });

  it("a miss is the subject with its claims, an empty claim left out", async () => {
    const accounts = seeded("auth0|someone-else");
    expect(
      await principalForSubject(accounts, "auth0|unknown", {
        email: "unknown@example.com",
        displayName: "",
      }),
    ).toEqual({ identityId: "auth0|unknown", email: "unknown@example.com" });
  });

  it("is the one read identityIdForSubject makes, and a store fault propagates as the same error", async () => {
    const accounts = seeded("auth0|known");
    const lookup = vi.spyOn(accounts, "findDirectByIdpId");
    await principalForSubject(accounts, "auth0|known");
    expect(lookup).toHaveBeenCalledTimes(1);

    const fault = new Error("store is on fire");
    const broken: AccountsBySubject = {
      findDirectByIdpId: () => Promise.reject(fault),
    };
    await expect(principalForSubject(broken, "auth0|anyone")).rejects.toBe(
      fault,
    );
  });

  it("a hit whose row carries no id is the same fault naming the subject", async () => {
    const accounts = seeded("auth0|corrupt", "");
    await expect(
      principalForSubject(accounts, "auth0|corrupt"),
    ).rejects.toThrow(/auth0\|corrupt/);
  });
});

/** An unsigned JWT-shaped token whose payload carries `sub` — what idpIdOf reads. */
function tokenFor(sub: string): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none" })}.${segment({ sub })}.unsigned`;
}

function caller(overrides: Partial<CallerIdentity>): CallerIdentity {
  return {
    identityId: "",
    callerClass: "user",
    issuer: "",
    rawToken: "",
    ...overrides,
  };
}

describe("accountForCaller — the account a caller stands for", () => {
  it("an identityId that is an account id resolves by that id, with no subject read", async () => {
    const accounts = seeded("auth0|known");
    const bySubject = vi.spyOn(accounts, "findDirectByIdpId");

    const account = await accountForCaller(
      accounts,
      caller({
        identityId: accountIdFor("auth0|known"),
        issuer: "https://issuer.test",
        rawToken: tokenFor("auth0|known"),
      }),
    );

    expect(account?.metadata?.id).toBe(accountIdFor("auth0|known"));
    expect(bySubject).not.toHaveBeenCalled();
  });

  it("a raw-subject identityId resolves through the token's sub — the composition-verifier shape", async () => {
    const accounts = seeded("auth0|raw");

    const account = await accountForCaller(
      accounts,
      caller({
        identityId: "auth0|raw",
        issuer: "",
        rawToken: tokenFor("auth0|raw"),
      }),
    );

    expect(account?.metadata?.id).toBe(accountIdFor("auth0|raw"));
  });

  it("the trusted-local operator resolves through local|<identityId>", async () => {
    const accounts = seeded(localIdpIdFor("operator@example.com"));

    const account = await accountForCaller(
      accounts,
      caller({ identityId: "operator@example.com" }),
    );

    expect(account?.metadata?.id).toBe(
      accountIdFor(localIdpIdFor("operator@example.com")),
    );
  });

  it("a credential naming no subject is undefined and the store is never asked about ''", async () => {
    const accounts = seeded("auth0|someone");
    const bySubject = vi.spyOn(accounts, "findDirectByIdpId");

    const account = await accountForCaller(
      accounts,
      caller({
        identityId: "opaque",
        issuer: "https://issuer.test",
        rawToken: "not-a-jwt",
      }),
    );

    expect(account).toBeUndefined();
    expect(bySubject).not.toHaveBeenCalled();
  });

  it("an idp-shaped caller with no account is undefined", async () => {
    const accounts = seeded("auth0|someone-else");

    const account = await accountForCaller(
      accounts,
      caller({
        identityId: "auth0|stranger",
        issuer: "https://issuer.test",
        rawToken: tokenFor("auth0|stranger"),
      }),
    );

    expect(account).toBeUndefined();
  });
});

describe("isPreSignInOperatorStamp — a stamp from before sign-in was turned on (stigmer/stigmer#1169)", () => {
  it('the "system" placeholder is the unconfigured laptop\'s operator, with no read', async () => {
    const accounts = fakeIdentityAccountStore();
    const bySubject = vi.spyOn(accounts, "findDirectByIdpId");

    expect(await isPreSignInOperatorStamp(accounts, "system")).toBe(true);
    expect(bySubject).not.toHaveBeenCalled();
  });

  it("an email with a local|<email> account is the configured operator's", async () => {
    const accounts = seeded(localIdpIdFor("operator@example.com"));
    const bySubject = vi.spyOn(accounts, "findDirectByIdpId");

    expect(
      await isPreSignInOperatorStamp(accounts, "operator@example.com"),
    ).toBe(true);
    expect(bySubject).toHaveBeenCalledTimes(1);
    expect(bySubject).toHaveBeenCalledWith(
      localIdpIdFor("operator@example.com"),
    );
  });

  it("an email with no local|<email> account is not — an issuer subject may look like one", async () => {
    const accounts = seeded(localIdpIdFor("operator@example.com"));

    expect(
      await isPreSignInOperatorStamp(accounts, "someone@example.com"),
    ).toBe(false);
  });

  it("an account-id stamp and the empty stamp are not, and the store is never asked", async () => {
    const accounts = seeded(localIdpIdFor("operator@example.com"));
    const bySubject = vi.spyOn(accounts, "findDirectByIdpId");

    expect(
      await isPreSignInOperatorStamp(
        accounts,
        accountIdFor(localIdpIdFor("operator@example.com")),
      ),
    ).toBe(false);
    expect(await isPreSignInOperatorStamp(accounts, "")).toBe(false);
    expect(bySubject).not.toHaveBeenCalled();
  });

  it("a store fault propagates as the same error", async () => {
    const fault = new Error("store is on fire");
    const broken: AccountsBySubject = {
      findDirectByIdpId: () => Promise.reject(fault),
    };
    await expect(
      isPreSignInOperatorStamp(broken, "operator@example.com"),
    ).rejects.toBe(fault);
  });
});

describe("mayProvisionDirectAccount — provisionMyAccount's admission", () => {
  const PERSON = "auth0|platform-person";

  function row(
    id: string,
    idpId: string,
    mode: IdentityAccountProvisioningMode,
  ) {
    return create(IdentityAccountSchema, {
      metadata: { id },
      spec: { idpId, provisioningMode: mode },
    });
  }

  /** The port's semantics: the direct read answers no federated and no platform-client row. */
  function accountsOf(...rows: ReturnType<typeof row>[]): AccountsByCaller {
    return {
      findById: (id) =>
        Promise.resolve(rows.find((r) => r.metadata?.id === id)),
      findDirectByIdpId: (idpId) =>
        Promise.resolve(
          rows.find(
            (r) =>
              r.spec?.idpId === idpId &&
              r.spec.provisioningMode !==
                IdentityAccountProvisioningMode.federated &&
              r.spec.provisioningMode !==
                IdentityAccountProvisioningMode.platform_client,
          ),
        ),
    };
  }

  const direct = row(
    accountIdFor(PERSON),
    PERSON,
    IdentityAccountProvisioningMode.direct,
  );
  const federated = row(
    "ida_federated",
    PERSON,
    IdentityAccountProvisioningMode.federated,
  );
  const endUser = row(
    accountIdFor("stgm_pc|acme|user-7"),
    "stgm_pc|acme|user-7",
    IdentityAccountProvisioningMode.platform_client,
  );
  const lane = row(
    "ida_guestlane",
    "stgm_guest|acme",
    IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified,
  );
  const token = (sub: string) => ({
    issuer: "https://issuer.test",
    rawToken: tokenFor(sub),
  });

  it.each([
    [
      "the trusted-local operator",
      accountsOf(),
      caller({ identityId: "operator@example.com" }),
      localIdpIdFor("operator@example.com"),
    ],
    [
      "an idp-shaped person before their first provisioning",
      accountsOf(),
      caller({ identityId: PERSON, ...token(PERSON) }),
      PERSON,
    ],
    [
      "a person who is already their subject's direct account",
      accountsOf(direct),
      caller({ identityId: direct.metadata!.id, ...token(PERSON) }),
      PERSON,
    ],
  ])("admits %s", async (_name, accounts, who, subject) => {
    expect(await mayProvisionDirectAccount(accounts, who, subject)).toBe(true);
  });

  it.each([
    [
      "a federated account whose provider minted a platform person's subject",
      accountsOf(direct, federated),
      caller({ identityId: federated.metadata!.id, ...token(PERSON) }),
      PERSON,
    ],
    [
      "a federated account whose subject no platform person holds",
      accountsOf(federated),
      caller({ identityId: federated.metadata!.id, ...token(PERSON) }),
      PERSON,
    ],
    [
      "a platform client's user",
      accountsOf(endUser),
      caller({
        identityId: endUser.metadata!.id,
        ...token("stgm_pc|acme|user-7"),
      }),
      "stgm_pc|acme|user-7",
    ],
    [
      "a system lane's token, whose subject is its lane account's id",
      accountsOf(lane),
      caller({
        identityId: lane.metadata!.id,
        callerClass: "user",
        ...token(lane.metadata!.id),
      }),
      lane.metadata!.id,
    ],
    [
      "a caller of another class, idp-shaped",
      accountsOf(),
      caller({
        identityId: "stgm_channel|acme",
        callerClass: "channel",
        ...token("stgm_channel|acme"),
      }),
      "stgm_channel|acme",
    ],
    [
      "an identity that is neither its subject nor an account",
      accountsOf(),
      caller({ identityId: "someone-else", ...token(PERSON) }),
      PERSON,
    ],
    [
      "a credential naming no subject",
      accountsOf(),
      caller({ identityId: "", ...token("") }),
      "",
    ],
  ])("refuses %s", async (_name, accounts, who, subject) => {
    expect(await mayProvisionDirectAccount(accounts, who, subject)).toBe(false);
  });

  it("a store fault propagates as the same error", async () => {
    const fault = new Error("store is on fire");
    const broken: AccountsByCaller = {
      findById: () => Promise.reject(fault),
      findDirectByIdpId: () => Promise.reject(fault),
    };
    await expect(
      mayProvisionDirectAccount(
        broken,
        caller({ identityId: PERSON, ...token(PERSON) }),
        PERSON,
      ),
    ).rejects.toBe(fault);
  });
});
