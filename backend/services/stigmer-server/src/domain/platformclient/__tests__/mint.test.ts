/**
 * Pins the PlatformClient mint over fakes of its four ports, so every arm is
 * asserted without a server:
 *   - no ring (a server that trusts every request) and a verify-only ring
 *     refuse FAILED_PRECONDITION before any credential is read;
 *   - an unknown client_id and a wrong secret answer one UNAUTHENTICATED
 *     copy; an expired secret refuses, an unset or never-expiring one mints;
 *     an org_id other than the owning organization refuses;
 *   - an existing platform-client account is reused with no grant and no
 *     write; an account under the subject in any other mode is refused;
 *   - a client that does not provision refuses an unknown user;
 *   - provisioning GRANTS FIRST on the derived account id, then creates the
 *     account as the client with the cloud's shape; a failed grant writes
 *     nothing; a failed create leaves the grant, and the next mint completes
 *     the account; a concurrent winner is read back;
 *   - the default role is viewer, owner is refused, and the token carries
 *     the cloud's claim set for the account.
 */
import { generateKeyPairSync } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { MintUserTokenRequestSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { verifyPlatformToken } from "../../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { PlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import type { IamPolicyGrantPath } from "../../iampolicy/grant-path.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import type { CreateAccountInput } from "../../identityaccount/provisioning.js";
import {
  EXPIRED_CLIENT_SECRET_MESSAGE,
  INVALID_CLIENT_CREDENTIALS_MESSAGE,
  MINTING_DISABLED_MESSAGE,
  MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
  PROVISIONING_FAILED_MESSAGE,
  foreignAccountMessage,
  noAccountMessage,
  organizationMismatchMessage,
} from "../constants.js";
import { hashClientSecret } from "../credentials.js";
import { mintUserToken, platformClientSubject } from "../mint.js";
import type { PlatformClientMintDeps } from "../mint.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PUBLIC_PEM = publicKey.export({ format: "pem", type: "spki" }).toString();
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [PUBLIC_PEM],
});
const NOW = new Date("2026-09-23T10:00:00Z");
const SECRET = "stgm_cs_the-secret";

function platformClient(
  spec: Partial<{
    autoProvisionAccounts: boolean;
    autoGrantOnOrg: boolean;
    autoGrantRole: IamRole;
    neverExpires: boolean;
    expiresAt: Date;
  }> = {},
): PlatformClient {
  return create(PlatformClientSchema, {
    metadata: { id: "pcl_dashboard", org: "acme", slug: "dashboard" },
    spec: {
      clientId: "stgm_cid_dashboard",
      clientSecretHash: hashClientSecret(SECRET),
      autoProvisionAccounts: spec.autoProvisionAccounts ?? true,
      autoGrantOnOrg: spec.autoGrantOnOrg ?? false,
      autoGrantRole: spec.autoGrantRole ?? IamRole.iam_role_unspecified,
      neverExpires: spec.neverExpires ?? false,
      ...(spec.expiresAt !== undefined
        ? { expiresAt: timestampFromDate(spec.expiresAt) }
        : {}),
    },
  });
}

interface Harness {
  readonly deps: PlatformClientMintDeps;
  readonly events: string[];
  readonly created: Array<{
    input: CreateAccountInput;
    caller: CallerIdentity;
  }>;
  readonly granted: Array<{ spec: IamPolicySpec; caller: CallerIdentity }>;
  readonly accounts: Map<string, IdentityAccount>;
}

function harness(
  options: {
    client?: PlatformClient;
    keys?: PlatformTokenKeyRing | undefined;
    failGrant?: boolean;
    failCreate?: "fault" | "lost-race";
  } = {},
): Harness {
  const client = options.client ?? platformClient();
  const events: string[] = [];
  const created: Harness["created"] = [];
  const granted: Harness["granted"] = [];
  const accounts = new Map<string, IdentityAccount>();
  const grantPath: Pick<IamPolicyGrantPath, "grant"> = {
    async grant(spec, caller) {
      events.push("grant");
      if (options.failGrant === true) throw new Error("policy store down");
      granted.push({ spec, caller });
      return { policy: create(IamPolicySchema), duplicate: false };
    },
  };
  const deps: PlatformClientMintDeps = {
    clients: {
      save: async () => {},
      update: async () => {},
      deleteById: async () => {},
      findById: async () => client,
      findByClientId: async (clientId) =>
        clientId === client.spec?.clientId ? client : undefined,
      findByOrgAndSlug: async () => undefined,
      findByOrg: async () => [],
    },
    accounts: { findByIdpId: async (idpId) => accounts.get(idpId) },
    createAccount: async (input, caller) => {
      events.push("create");
      const account = create(IdentityAccountSchema, {
        metadata: { id: accountIdFor(input.spec.idpId), name: input.name },
        spec: {
          ...input.spec,
          provisioningMode: IdentityAccountProvisioningMode.platform_client,
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
  return { deps, events, created, granted, accounts };
}

function request(
  overrides: Partial<{
    clientSecret: string;
    clientId: string;
    userId: string;
    orgId: string;
    userEmail: string;
    userName: string;
  }> = {},
) {
  return create(MintUserTokenRequestSchema, {
    clientId: overrides.clientId ?? "stgm_cid_dashboard",
    clientSecret: overrides.clientSecret ?? SECRET,
    userId: overrides.userId ?? "user-7",
    userEmail: overrides.userEmail ?? "pat@example.com",
    userName: overrides.userName ?? "Pat Lee",
    orgId: overrides.orgId ?? "",
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

const SUBJECT = platformClientSubject("acme", "user-7");

describe("mintUserToken — the server and the client", () => {
  it("refuses without a ring and with a verify-only ring, before reading any credential", async () => {
    const unposed = await refusal(
      mintUserToken(harness({ keys: undefined }).deps, request()),
    );
    expect(unposed.code).toBe(Code.FailedPrecondition);
    expect(unposed.rawMessage).toBe(MINTING_REQUIRES_AUTHENTICATION_MESSAGE);

    const verifyOnly = platformTokenKeyRingFromPem({
      publicKeyPems: [PUBLIC_PEM],
    });
    const disabled = await refusal(
      mintUserToken(harness({ keys: verifyOnly }).deps, request()),
    );
    expect(disabled.code).toBe(Code.FailedPrecondition);
    expect(disabled.rawMessage).toBe(MINTING_DISABLED_MESSAGE);
  });

  it("answers an unknown client_id and a wrong secret with one UNAUTHENTICATED copy", async () => {
    for (const bad of [
      request({ clientId: "stgm_cid_unknown" }),
      request({ clientSecret: "stgm_cs_wrong" }),
    ]) {
      const denied = await refusal(mintUserToken(harness().deps, bad));
      expect(denied.code).toBe(Code.Unauthenticated);
      expect(denied.rawMessage).toBe(INVALID_CLIENT_CREDENTIALS_MESSAGE);
    }
  });

  it("refuses an expired secret; an unset or never-expiring one mints", async () => {
    const past = new Date(NOW.getTime() - 1000);
    const expired = await refusal(
      mintUserToken(
        harness({ client: platformClient({ expiresAt: past }) }).deps,
        request(),
      ),
    );
    expect(expired.code).toBe(Code.FailedPrecondition);
    expect(expired.rawMessage).toBe(EXPIRED_CLIENT_SECRET_MESSAGE);

    await mintUserToken(harness({ client: platformClient() }).deps, request());
    await mintUserToken(
      harness({
        client: platformClient({ expiresAt: past, neverExpires: true }),
      }).deps,
      request(),
    );
  });

  it("refuses an org_id other than the owning organization, and accepts it or empty", async () => {
    const other = await refusal(
      mintUserToken(harness().deps, request({ orgId: "globex" })),
    );
    expect(other.code).toBe(Code.InvalidArgument);
    expect(other.rawMessage).toBe(organizationMismatchMessage("acme"));
    await mintUserToken(harness().deps, request({ orgId: "acme" }));
  });

  it("refuses a user_id carrying the separator", async () => {
    const denied = await refusal(
      mintUserToken(harness().deps, request({ userId: "a|b" })),
    );
    expect(denied.code).toBe(Code.InvalidArgument);
  });
});

describe("mintUserToken — the user", () => {
  it("reuses an existing platform-client account with no grant and no write", async () => {
    const h = harness({ client: platformClient({ autoGrantOnOrg: true }) });
    h.accounts.set(
      SUBJECT,
      create(IdentityAccountSchema, {
        metadata: { id: "ida_existing" },
        spec: {
          idpId: SUBJECT,
          provisioningMode: IdentityAccountProvisioningMode.platform_client,
        },
      }),
    );
    const minted = await mintUserToken(h.deps, request());
    expect(h.events).toEqual([]);
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome === "verified" && verified.token.subject).toBe(
      "ida_existing",
    );
  });

  it("refuses an account under the subject that no platform client provisioned", async () => {
    const h = harness();
    h.accounts.set(
      SUBJECT,
      create(IdentityAccountSchema, {
        metadata: { id: "ida_direct" },
        spec: {
          idpId: SUBJECT,
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
    const denied = await refusal(mintUserToken(h.deps, request()));
    expect(denied.code).toBe(Code.FailedPrecondition);
    expect(denied.rawMessage).toBe(foreignAccountMessage("user-7", "acme"));
  });

  it("refuses an unknown user when the client does not provision", async () => {
    const h = harness({
      client: platformClient({ autoProvisionAccounts: false }),
    });
    const denied = await refusal(mintUserToken(h.deps, request()));
    expect(denied.code).toBe(Code.FailedPrecondition);
    expect(denied.rawMessage).toBe(noAccountMessage("user-7", "acme"));
    expect(h.events).toEqual([]);
  });

  it("grants first on the derived id, then creates the account as the client with the cloud's shape", async () => {
    const h = harness({
      client: platformClient({
        autoGrantOnOrg: true,
        autoGrantRole: IamRole.member,
      }),
    });
    const minted = await mintUserToken(h.deps, request());

    expect(h.events).toEqual(["grant", "create"]);
    const grant = h.granted[0];
    expect(grant?.spec.principal?.id).toBe(accountIdFor(SUBJECT));
    expect(grant?.spec.relation).toBe("member");
    expect(grant?.spec.resource?.id).toBe("acme");
    expect(grant?.caller).toEqual({
      identityId: "pcl_dashboard",
      callerClass: "internal",
      issuer: "",
      rawToken: "",
    });

    const creation = h.created[0];
    expect(creation?.caller.identityId).toBe("pcl_dashboard");
    expect(creation?.input.provisioning).toEqual({
      mode: "platform_client",
      org: "acme",
    });
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
      platform_client_id: "pcl_dashboard",
    });
    expect(verified.token.tokenType).toBeUndefined();
  });

  it("grants viewer when the role is unspecified, and refuses an owner auto-grant", async () => {
    const h = harness({ client: platformClient({ autoGrantOnOrg: true }) });
    await mintUserToken(h.deps, request());
    expect(h.granted[0]?.spec.relation).toBe("viewer");

    const owner = harness({
      client: platformClient({
        autoGrantOnOrg: true,
        autoGrantRole: IamRole.owner,
      }),
    });
    const denied = await refusal(mintUserToken(owner.deps, request()));
    expect(denied.code).toBe(Code.InvalidArgument);
    expect(owner.events).toEqual([]);
  });

  it("writes nothing when the grant fails, and says the request is safe to retry", async () => {
    const h = harness({
      client: platformClient({ autoGrantOnOrg: true }),
      failGrant: true,
    });
    const failed = await refusal(mintUserToken(h.deps, request()));
    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe(PROVISIONING_FAILED_MESSAGE);
    expect(h.events).toEqual(["grant"]);
    expect(h.accounts.size).toBe(0);
  });

  it("leaves the grant when the create fails, and the next mint completes the account", async () => {
    const failing = harness({
      client: platformClient({ autoGrantOnOrg: true }),
      failCreate: "fault",
    });
    await expect(mintUserToken(failing.deps, request())).rejects.toThrow(
      "account store down",
    );
    expect(failing.events).toEqual(["grant", "create"]);

    const retry = harness({ client: platformClient({ autoGrantOnOrg: true }) });
    await mintUserToken(retry.deps, request());
    expect(retry.granted[0]?.spec.principal?.id).toBe(
      failing.granted[0]?.spec.principal?.id,
    );
    expect(retry.created).toHaveLength(1);
  });

  it("reads a concurrent winner back when the create loses the race", async () => {
    const h = harness({ failCreate: "lost-race" });
    const minted = await mintUserToken(h.deps, request());
    const verified = verifyPlatformToken(RING, minted.accessToken, NOW);
    expect(verified.outcome === "verified" && verified.token.subject).toBe(
      accountIdFor(SUBJECT),
    );
  });
});
