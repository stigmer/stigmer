/**
 * Pins the user-token mint over fakes of its ports, so every arm is
 * asserted without a server:
 *   - no ring (a server that trusts every request) and a verify-only ring
 *     refuse FAILED_PRECONDITION before the caller is read;
 *   - a caller that is not a service account, or one whose key names no
 *     organization, is refused PERMISSION_DENIED before authorization;
 *     authorization is asked `can_mint_user_tokens` on the request's
 *     organization, and its denial is the annotation's copy;
 *   - the settings read are the minting account's organization's, whatever
 *     organization the token is for; a minting organization that is gone
 *     refuses, and a fault reading it is INTERNAL;
 *   - an existing app-user account is reused with no grant and no write;
 *     an account under the subject in any other mode is refused;
 *   - settings that do not create accounts refuse an unknown person;
 *   - provisioning GRANTS FIRST on the derived account id, as an ordinary
 *     grant made acting for the minting service account, then creates the
 *     account as that account with the name split; a failed grant writes
 *     nothing; a failed create leaves the grant, and the next mint
 *     completes the account; a concurrent winner is read back;
 *   - no role grants nothing, owner and a role no organization grants are
 *     refused before anything is written, and the token carries the claim
 *     set for the account, `minted_by` naming the minting account.
 */
import { generateKeyPairSync } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { MintUserTokenRequestSchema } from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import { IamPermission, IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { verifyPlatformToken } from "../../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { PlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type { IamPolicyGrantPath } from "../../iampolicy/grant-path.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import type { CreateAccountInput } from "../../identityaccount/provisioning.js";
import {
  MINTING_DISABLED_MESSAGE,
  MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
  MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
  OWNER_SIGN_IN_ROLE_MESSAGE,
  PROVISIONING_FAILED_MESSAGE,
  foreignAccountMessage,
  noAccountMessage,
  signInRoleNotGrantableMessage,
} from "../constants.js";
import { appUserSubject, mintUserToken } from "../mint.js";
import type { UserTokenMintDeps } from "../mint.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PUBLIC_PEM = publicKey.export({ format: "pem", type: "spki" }).toString();
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [PUBLIC_PEM],
});
const NOW = new Date("2026-10-14T10:00:00Z");
const MINTER = "ida_dashboard";

/** The minting service account's key, as the API-key verifier stamps it. */
const KEY_CALLER: CallerIdentity = testCallerIdentity({
  identityId: MINTER,
  callerClass: "service_account",
  boundOrg: "acme",
});

interface Embedding {
  readonly createAccountsOnSignIn?: boolean;
  readonly signInRole?: IamRole;
}

interface Harness {
  readonly deps: UserTokenMintDeps;
  readonly events: string[];
  readonly checks: AuthzCheck[];
  readonly created: Array<{ input: CreateAccountInput; caller: CallerIdentity }>;
  readonly granted: Array<{ spec: IamPolicySpec; caller: CallerIdentity; cause: string }>;
  readonly accounts: Map<string, IdentityAccount>;
}

function harness(
  options: {
    embedding?: Embedding;
    keys?: PlatformTokenKeyRing | undefined;
    deny?: boolean;
    organization?: "gone" | "unreadable";
    failGrant?: boolean;
    failCreate?: "fault" | "lost-race";
  } = {},
): Harness {
  const events: string[] = [];
  const checks: AuthzCheck[] = [];
  const created: Harness["created"] = [];
  const granted: Harness["granted"] = [];
  const accounts = new Map<string, IdentityAccount>();
  const embedding = options.embedding ?? { createAccountsOnSignIn: true };
  const organizations: Pick<Store, "getResource"> = {
    getResource: (async (_kind: unknown, id: string) => {
      events.push(`read ${id}`);
      if (options.organization === "unreadable") throw new Error("store down");
      if (options.organization === "gone" || id !== "acme") {
        throw new ResourceNotFoundError(`organization ${id}`);
      }
      return create(OrganizationSchema, { metadata: { id }, spec: { embedding } });
    }) as Store["getResource"],
  };
  const authorizer: Authorizer = {
    authorize: async (_caller, check) => {
      checks.push(check);
      return options.deny === true
        ? { kind: "deny", reason: "not an admin" }
        : { kind: "allow" };
    },
  };
  const grantPath: Pick<IamPolicyGrantPath, "grant"> = {
    async grant(spec, caller, cause) {
      events.push("grant");
      if (options.failGrant === true) throw new Error("policy store down");
      granted.push({ spec, caller, cause });
      return { policy: create(IamPolicySchema), duplicate: false };
    },
  };
  const deps: UserTokenMintDeps = {
    store: organizations,
    authorizer,
    accounts: { findByIdpId: async (idpId) => accounts.get(idpId) },
    createAccount: async (input, caller) => {
      events.push("create");
      const account = create(IdentityAccountSchema, {
        metadata: { id: accountIdFor(input.spec.idpId), name: input.name },
        spec: {
          ...input.spec,
          provisioningMode: IdentityAccountProvisioningMode.app_user,
        },
      });
      if (options.failCreate === "fault") throw new Error("account store down");
      if (options.failCreate === "lost-race") {
        accounts.set(input.spec.idpId, account);
        throw new ConnectError("already exists", Code.AlreadyExists);
      }
      created.push({ input, caller });
      accounts.set(input.spec.idpId, account);
      return account;
    },
    grantPath,
    keys: "keys" in options ? options.keys : RING,
    logger: silentLogger,
    now: () => NOW,
  };
  return { deps, events, checks, created, granted, accounts };
}

function request(
  overrides: Partial<{ org: string; userId: string; userEmail: string; userName: string }> = {},
) {
  return create(MintUserTokenRequestSchema, {
    org: overrides.org ?? "acme",
    userId: overrides.userId ?? "user-7",
    userEmail: overrides.userEmail ?? "pat@example.com",
    userName: overrides.userName ?? "Pat Lee",
  });
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

const SUBJECT = appUserSubject("acme", "user-7");

describe("mintUserToken — the server and the caller", () => {
  it("refuses without a ring and with a verify-only ring, before reading the caller", async () => {
    const unposed = harness({ keys: undefined });
    const noRing = await refusal(mintUserToken(unposed.deps, request(), KEY_CALLER));
    expect([noRing.code, noRing.rawMessage]).toEqual([
      Code.FailedPrecondition,
      MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
    ]);
    expect(unposed.checks).toEqual([]);

    const verifyOnly = platformTokenKeyRingFromPem({ publicKeyPems: [PUBLIC_PEM] });
    const disabled = await refusal(
      mintUserToken(harness({ keys: verifyOnly }).deps, request(), KEY_CALLER),
    );
    expect([disabled.code, disabled.rawMessage]).toEqual([
      Code.FailedPrecondition,
      MINTING_DISABLED_MESSAGE,
    ]);
  });

  it("refuses a person and a key that names no organization before authorization", async () => {
    for (const caller of [
      testCallerIdentity({ identityId: "ida_person", boundOrg: "acme" }),
      testCallerIdentity({ identityId: MINTER, callerClass: "service_account" }),
    ]) {
      const h = harness();
      const denied = await refusal(mintUserToken(h.deps, request(), caller));
      expect([denied.code, denied.rawMessage]).toEqual([
        Code.PermissionDenied,
        MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
      ]);
      expect(h.checks).toEqual([]);
      expect(h.events).toEqual([]);
    }
  });

  it("asks can_mint_user_tokens on the token's organization, and answers a denial with the annotation's copy", async () => {
    const allowed = harness();
    await mintUserToken(allowed.deps, request(), KEY_CALLER);
    expect(allowed.checks).toEqual([
      {
        permission: IamPermission.can_mint_user_tokens,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);

    const h = harness({ deny: true });
    const denied = await refusal(mintUserToken(h.deps, request(), KEY_CALLER));
    expect([denied.code, denied.rawMessage]).toEqual([
      Code.PermissionDenied,
      "unauthorized to mint user tokens for this organization",
    ]);
    expect(h.events).toEqual([]);
  });

  it("reads the minting organization's settings for a token for its child, and the account is the child's", async () => {
    const h = harness({ embedding: { createAccountsOnSignIn: true, signInRole: IamRole.viewer } });
    const minted = await mintUserToken(h.deps, request({ org: "org_acmecust" }), KEY_CALLER);
    expect(h.events[0]).toBe("read acme");
    const childSubject = appUserSubject("org_acmecust", "user-7");
    expect(h.created[0]?.input.spec.idpId).toBe(childSubject);
    expect(h.created[0]?.input.provisioning).toEqual({ mode: "app_user", org: "org_acmecust" });
    expect(h.granted[0]?.spec.resource?.id).toBe("org_acmecust");
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome).toBe("verified");
    if (verified.outcome !== "verified") return;
    expect(verified.token.payload).toMatchObject({
      sub: accountIdFor(childSubject),
      org: "org_acmecust",
      minted_by: MINTER,
    });
  });

  it("refuses when the minting organization is gone, and answers a fault reading it INTERNAL", async () => {
    const gone = await refusal(
      mintUserToken(harness({ organization: "gone" }).deps, request(), KEY_CALLER),
    );
    expect([gone.code, gone.rawMessage]).toEqual([
      Code.PermissionDenied,
      MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
    ]);
    const fault = await refusal(
      mintUserToken(harness({ organization: "unreadable" }).deps, request(), KEY_CALLER),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("refuses a user_id carrying the separator, and a blank one", async () => {
    for (const userId of ["a|b", "  "]) {
      const denied = await refusal(
        mintUserToken(harness().deps, request({ userId }), KEY_CALLER),
      );
      expect(denied.code, userId).toBe(Code.InvalidArgument);
    }
  });
});

describe("mintUserToken — the person", () => {
  it("reuses an existing app-user account with no grant and no write", async () => {
    const h = harness({ embedding: { createAccountsOnSignIn: true, signInRole: IamRole.viewer } });
    h.accounts.set(
      SUBJECT,
      create(IdentityAccountSchema, {
        metadata: { id: "ida_existing" },
        spec: { idpId: SUBJECT, provisioningMode: IdentityAccountProvisioningMode.app_user },
      }),
    );
    const minted = await mintUserToken(h.deps, request(), KEY_CALLER);
    expect(h.events).toEqual(["read acme"]);
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome === "verified" && verified.token.subject).toBe("ida_existing");
  });

  it("refuses an account under the subject that no mint created", async () => {
    const h = harness();
    h.accounts.set(
      SUBJECT,
      create(IdentityAccountSchema, {
        metadata: { id: "ida_direct" },
        spec: { idpId: SUBJECT, provisioningMode: IdentityAccountProvisioningMode.direct },
      }),
    );
    const denied = await refusal(mintUserToken(h.deps, request(), KEY_CALLER));
    expect([denied.code, denied.rawMessage]).toEqual([
      Code.FailedPrecondition,
      foreignAccountMessage("user-7", "acme"),
    ]);
  });

  it("refuses an unknown person when the settings do not create accounts, as with none set", async () => {
    for (const embedding of [{ createAccountsOnSignIn: false }, {}]) {
      const h = harness({ embedding });
      const denied = await refusal(mintUserToken(h.deps, request(), KEY_CALLER));
      expect([denied.code, denied.rawMessage]).toEqual([
        Code.FailedPrecondition,
        noAccountMessage("user-7", "acme"),
      ]);
      expect(h.events).toEqual(["read acme"]);
    }
  });

  it("grants first on the derived id as an ordinary grant by the minting account, then creates the account as it", async () => {
    const h = harness({ embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member } });
    const minted = await mintUserToken(h.deps, request(), KEY_CALLER);

    expect(h.events).toEqual(["read acme", "grant", "create"]);
    const grant = h.granted[0];
    expect(grant?.spec.principal?.id).toBe(accountIdFor(SUBJECT));
    expect(grant?.spec.relation).toBe("member");
    expect(grant?.spec.resource?.id).toBe("acme");
    expect(grant?.cause).toBe("grant");
    expect(grant?.caller).toEqual({
      identityId: MINTER,
      callerClass: "internal",
      issuer: "",
      rawToken: "",
    });

    const creation = h.created[0];
    expect(creation?.caller.identityId).toBe(MINTER);
    expect(creation?.input.provisioning).toEqual({ mode: "app_user", org: "acme" });
    expect(creation?.input.name).toBe("pat@example.com");
    expect(creation?.input.spec).toMatchObject({
      idpId: SUBJECT,
      email: "pat@example.com",
      firstName: "Pat",
      lastName: "Lee",
    });

    expect(minted.tokenType).toBe("Bearer");
    expect(minted.expiresIn).toBe(900);
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome).toBe("verified");
    if (verified.outcome !== "verified") return;
    expect(verified.token.payload).toMatchObject({
      sub: accountIdFor(SUBJECT),
      ext_user_id: "user-7",
      email: "pat@example.com",
      name: "Pat Lee",
      org: "acme",
      minted_by: MINTER,
    });
    expect(verified.token.payload).not.toHaveProperty("platform_client_id");
    expect(verified.token.tokenType).toBeUndefined();
  });

  it("names the account by the external id when no email is given, its first name the display name alone", async () => {
    const h = harness();
    await mintUserToken(h.deps, request({ userEmail: "", userName: "Pat" }), KEY_CALLER);
    expect(h.created[0]?.input.name).toBe("user-7");
    expect(h.created[0]?.input.spec).toMatchObject({ firstName: "Pat", lastName: "" });

    const unnamed = harness();
    await mintUserToken(unnamed.deps, request({ userName: "" }), KEY_CALLER);
    expect(unnamed.created[0]?.input.spec).toMatchObject({ firstName: "pat", lastName: "" });
  });

  it("mints for a person whose email is past the name's bound, the account named by the email cut to 200", async () => {
    const h = harness();
    const email = `${"p".repeat(240)}@example.com`;
    await mintUserToken(h.deps, request({ userEmail: email }), KEY_CALLER);
    expect(h.created[0]?.input.name).toBe(email.slice(0, 200));
    expect(h.created[0]?.input.spec.email).toBe(email);
  });

  it("grants nothing when no sign-in role is set, and refuses owner and a role no organization grants", async () => {
    const h = harness();
    await mintUserToken(h.deps, request(), KEY_CALLER);
    expect(h.granted).toEqual([]);
    expect(h.events).toEqual(["read acme", "create"]);

    const owner = harness({ embedding: { createAccountsOnSignIn: true, signInRole: IamRole.owner } });
    const refusedOwner = await refusal(mintUserToken(owner.deps, request(), KEY_CALLER));
    expect([refusedOwner.code, refusedOwner.rawMessage]).toEqual([
      Code.InvalidArgument,
      OWNER_SIGN_IN_ROLE_MESSAGE,
    ]);
    expect(owner.events).toEqual(["read acme"]);

    for (const role of [IamRole.participant, IamRole.editor, IamRole.user]) {
      const stored = harness({ embedding: { createAccountsOnSignIn: true, signInRole: role } });
      const denied = await refusal(mintUserToken(stored.deps, request(), KEY_CALLER));
      expect([denied.code, denied.rawMessage], IamRole[role]).toEqual([
        Code.InvalidArgument,
        signInRoleNotGrantableMessage(role),
      ]);
      expect(stored.events, IamRole[role]).toEqual(["read acme"]);
    }
  });

  it("writes nothing when the grant fails, and says the request is safe to retry", async () => {
    const h = harness({
      embedding: { createAccountsOnSignIn: true, signInRole: IamRole.viewer },
      failGrant: true,
    });
    const failed = await refusal(mintUserToken(h.deps, request(), KEY_CALLER));
    expect([failed.code, failed.rawMessage]).toEqual([Code.Internal, PROVISIONING_FAILED_MESSAGE]);
    expect(h.events).toEqual(["read acme", "grant"]);
    expect(h.accounts.size).toBe(0);
  });

  it("leaves the grant when the create fails, and the next mint completes the account", async () => {
    const embedding = { createAccountsOnSignIn: true, signInRole: IamRole.viewer };
    const failing = harness({ embedding, failCreate: "fault" });
    await expect(mintUserToken(failing.deps, request(), KEY_CALLER)).rejects.toThrow(
      "account store down",
    );
    expect(failing.events).toEqual(["read acme", "grant", "create"]);

    const retry = harness({ embedding });
    await mintUserToken(retry.deps, request(), KEY_CALLER);
    expect(retry.granted[0]?.spec.principal?.id).toBe(failing.granted[0]?.spec.principal?.id);
    expect(retry.created).toHaveLength(1);
  });

  it("reads a concurrent winner back when the create loses the race", async () => {
    const h = harness({ failCreate: "lost-race" });
    const minted = await mintUserToken(h.deps, request(), KEY_CALLER);
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome === "verified" && verified.token.subject).toBe(accountIdFor(SUBJECT));
  });
});
