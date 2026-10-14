/**
 * Pins the user-token verifier and the embedding origin guard, the two
 * halves of the minter's contract on every request a token bears:
 *   - the verifier claims only an untyped platform token, passes a foreign
 *     or typed one, refuses a bad one with the envelope's copy, refuses a
 *     token naming no minter, refuses a token whose minting service account
 *     is gone (or names an account that is no service account) with the
 *     liveness copy, lets a store fault propagate (never a revocation), and
 *     stamps the account from `sub` as a `user` with the minting account
 *     it verified, for the audit actor, bound to the organization its
 *     `org` claim names, the minter's own or one of its child
 *     organizations; a token whose `org` claim is missing, empty, or names
 *     neither (an unrelated organization, another parent's child, an
 *     organization that does not exist) is refused;
 *   - the guard reads nothing for a request without an Origin, passes an
 *     open allowlist and a listed origin case-insensitively, refuses an
 *     unlisted origin and the opaque "null" with the embedding copy, reads
 *     the minting organization's settings (not the token's), refuses when
 *     the minter or its organization is gone, and passes every credential
 *     that is not an untyped platform user token.
 */
import { generateKeyPairSync } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { signPlatformToken } from "../../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import {
  DELETED_MINTER_MESSAGE,
  TOKEN_NAMES_NO_MINTER_MESSAGE,
  TOKEN_ORGANIZATION_MISMATCH_MESSAGE,
  originRefusalMessage,
} from "../constants.js";
import { newEmbeddingOriginGuard } from "../origin-guard.js";
import { newUserTokenVerifier } from "../verifier.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const built = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [publicKey.export({ format: "pem", type: "spki" }).toString()],
});
if (built.signer === undefined) throw new Error("fixture ring must sign");
const ring: SigningPlatformTokenKeyRing = { ...built, signer: built.signer };

const MINTER = "ida_dashboard";

function minter(
  org = "acme",
  mode = IdentityAccountProvisioningMode.service_account,
): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id: MINTER, org },
    spec: { provisioningMode: mode },
  });
}

/**
 * acme (whose embedding settings list `allowed`), acme's child, an
 * unrelated organization and another parent's child; anything else is
 * absent.
 */
function organizations(allowed: string[] = []): Pick<Store, "getResource"> & {
  getResource: ReturnType<typeof vi.fn>;
} {
  const parents = new Map([
    ["acme", ""],
    ["org_acmecust", "acme"],
    ["globex", ""],
    ["org_rivalcust", "rival"],
  ]);
  return {
    getResource: vi.fn(async (_kind: unknown, id: string) => {
      const parentOrg = parents.get(id);
      if (parentOrg === undefined) {
        throw new ResourceNotFoundError(`organization ${id}`);
      }
      return create(OrganizationSchema, {
        metadata: { id },
        spec: {
          parentOrg,
          ...(id === "acme" ? { embedding: { allowedOrigins: allowed } } : {}),
        },
      });
    }),
  } as unknown as Pick<Store, "getResource"> & { getResource: ReturnType<typeof vi.fn> };
}

function accountsOf(found: IdentityAccount | undefined) {
  return { findById: vi.fn(async () => found) };
}

function userToken(claims: Record<string, string> = {}): string {
  return signPlatformToken(ring, {
    sub: "ida_pat",
    email: "pat@example.com",
    name: "Pat",
    minted_by: MINTER,
    org: "acme",
    ...claims,
  }).token;
}

function callerWith(rawToken: string): CallerIdentity {
  return {
    identityId: "ida_pat",
    callerClass: "user",
    issuer: "stigmer",
    rawToken,
  };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("the user-token verifier", () => {
  it("stamps the account the token was minted for as a user, with the asserted profile and the minting account", async () => {
    const token = userToken();
    const identity = await newUserTokenVerifier({
      keys: ring,
      accounts: accountsOf(minter()),
      store: organizations(),
    }).verify(token);
    expect(identity).toEqual({
      identityId: "ida_pat",
      callerClass: "user",
      issuer: "stigmer",
      rawToken: token,
      email: "pat@example.com",
      displayName: "Pat",
      mintedBy: MINTER,
      boundOrg: "acme",
    });
  });

  it("binds a token whose org claim names a child of its minter's organization to that child", async () => {
    const identity = await newUserTokenVerifier({
      keys: ring,
      accounts: accountsOf(minter()),
      store: organizations(),
    }).verify(userToken({ org: "org_acmecust" }));
    expect(identity?.boundOrg).toBe("org_acmecust");
  });

  it("refuses a token whose org claim is missing, empty, another organization's, another parent's child or no organization at all", async () => {
    const verifier = newUserTokenVerifier({
      keys: ring,
      accounts: accountsOf(minter()),
      store: organizations(),
    });
    const unbound = signPlatformToken(ring, { sub: "ida_pat", minted_by: MINTER }).token;
    for (const token of [
      unbound,
      userToken({ org: "" }),
      userToken({ org: "globex" }),
      userToken({ org: "org_rivalcust" }),
      userToken({ org: "org_nosuchorganization" }),
    ]) {
      const refused = await refusal(verifier.verify(token));
      expect([refused.code, refused.rawMessage]).toEqual([
        Code.Unauthenticated,
        TOKEN_ORGANIZATION_MISMATCH_MESSAGE,
      ]);
    }
  });

  it("passes a foreign token and a typed platform token to the next verifier", async () => {
    const verifier = newUserTokenVerifier({
      keys: ring,
      accounts: accountsOf(minter()),
      store: organizations(),
    });
    expect(await verifier.verify("stk_api_key")).toBeNull();
    expect(await verifier.verify(userToken({ token_type: "guest" }))).toBeNull();
  });

  it("refuses a bad token with the envelope's copy", async () => {
    const tampered = `${userToken().slice(0, -4)}AAAA`;
    const refused = await refusal(
      newUserTokenVerifier({
        keys: ring,
        accounts: accountsOf(minter()),
        store: organizations(),
      }).verify(tampered),
    );
    expect(refused.code).toBe(Code.Unauthenticated);
  });

  it("refuses a token whose minter is gone or no service account with the liveness copy, and a token naming no minter", async () => {
    for (const found of [
      undefined,
      minter("acme", IdentityAccountProvisioningMode.direct),
    ]) {
      const gone = await refusal(
        newUserTokenVerifier({
          keys: ring,
          accounts: accountsOf(found),
          store: organizations(),
        }).verify(userToken()),
      );
      expect([gone.code, gone.rawMessage]).toEqual([
        Code.Unauthenticated,
        DELETED_MINTER_MESSAGE,
      ]);
    }

    for (const token of [
      signPlatformToken(ring, { sub: "ida_pat", org: "acme" }).token,
      userToken({ minted_by: "" }),
    ]) {
      const unnamed = await refusal(
        newUserTokenVerifier({
          keys: ring,
          accounts: accountsOf(minter()),
          store: organizations(),
        }).verify(token),
      );
      expect([unnamed.code, unnamed.rawMessage]).toEqual([
        Code.Unauthenticated,
        TOKEN_NAMES_NO_MINTER_MESSAGE,
      ]);
    }
  });

  it("lets a store fault propagate instead of reading it as a revocation", async () => {
    const failing = {
      findById: vi.fn(async () => {
        throw new Error("database down");
      }),
    };
    await expect(
      newUserTokenVerifier({
        keys: ring,
        accounts: failing,
        store: organizations(),
      }).verify(userToken()),
    ).rejects.toThrow("database down");
  });
});

describe("the embedding origin guard", () => {
  const method = OrganizationQueryController.method.get;

  it("reads nothing for a request without an Origin header", async () => {
    const accounts = accountsOf(minter());
    const store = organizations(["https://app.example"]);
    const guard = newEmbeddingOriginGuard({ accounts, store, logger: silentLogger });
    await guard.guard(callerWith(userToken()), method, new Headers());
    await guard.guard(callerWith(userToken()), method, new Headers({ origin: "  " }));
    expect(accounts.findById).not.toHaveBeenCalled();
    expect(store.getResource).not.toHaveBeenCalled();
  });

  it("passes an open allowlist and a listed origin, compared case-insensitively", async () => {
    await newEmbeddingOriginGuard({
      accounts: accountsOf(minter()),
      store: organizations(),
      logger: silentLogger,
    }).guard(callerWith(userToken()), method, new Headers({ origin: "https://anywhere.example" }));
    await newEmbeddingOriginGuard({
      accounts: accountsOf(minter()),
      store: organizations(["https://app.example"]),
      logger: silentLogger,
    }).guard(callerWith(userToken()), method, new Headers({ origin: "https://APP.example" }));
  });

  it("refuses an unlisted origin and the opaque origin with the embedding copy", async () => {
    const guard = newEmbeddingOriginGuard({
      accounts: accountsOf(minter()),
      store: organizations(["https://app.example"]),
      logger: silentLogger,
    });
    for (const origin of ["https://evil.example", "null"]) {
      const denied = await refusal(
        guard.guard(callerWith(userToken()), method, new Headers({ origin })),
      );
      expect([denied.code, denied.rawMessage]).toEqual([
        Code.PermissionDenied,
        originRefusalMessage(origin),
      ]);
    }
  });

  it("reads the minting organization's settings for a token bound to its child", async () => {
    const store = organizations(["https://app.example"]);
    const denied = await refusal(
      newEmbeddingOriginGuard({
        accounts: accountsOf(minter()),
        store,
        logger: silentLogger,
      }).guard(
        callerWith(userToken({ org: "org_acmecust" })),
        method,
        new Headers({ origin: "https://evil.example" }),
      ),
    );
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(store.getResource).toHaveBeenCalledWith(expect.anything(), "acme", expect.anything());
  });

  it("refuses with the liveness copy when the minter or its organization is gone, and lets a store fault propagate", async () => {
    const browser = new Headers({ origin: "https://app.example" });
    for (const accounts of [accountsOf(undefined), accountsOf(minter("org_gone"))]) {
      const denied = await refusal(
        newEmbeddingOriginGuard({ accounts, store: organizations(), logger: silentLogger }).guard(
          callerWith(userToken()),
          method,
          browser,
        ),
      );
      expect([denied.code, denied.rawMessage]).toEqual([
        Code.Unauthenticated,
        DELETED_MINTER_MESSAGE,
      ]);
    }
    const failing = {
      getResource: vi.fn(async () => {
        throw new Error("database down");
      }),
    } as unknown as Pick<Store, "getResource">;
    await expect(
      newEmbeddingOriginGuard({
        accounts: accountsOf(minter()),
        store: failing,
        logger: silentLogger,
      }).guard(callerWith(userToken()), method, browser),
    ).rejects.toThrow("database down");
  });

  it("passes every credential that is not an untyped platform user token", async () => {
    const accounts = accountsOf(minter());
    const guard = newEmbeddingOriginGuard({
      accounts,
      store: organizations(["https://app.example"]),
      logger: silentLogger,
    });
    const foreign = new Headers({ origin: "https://evil.example" });
    await guard.guard(callerWith("stk_api_key"), method, foreign);
    await guard.guard(callerWith(""), method, foreign);
    await guard.guard(callerWith(userToken({ token_type: "guest" })), method, foreign);
    expect(accounts.findById).not.toHaveBeenCalled();
  });
});
