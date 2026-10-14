/**
 * The user-token lane on a composed server with sign-in on and the
 * built-in Authorizer (the open-source sign-in self-host's shape), the key
 * ring supplied so the run is hermetic. What it pins:
 *
 *   - who mints: a person's own token is refused even when they are an
 *     admin, and so is a member-role service account's key; an admin-role
 *     service account's key mints into its organization and into a child of
 *     it, and is refused for an unrelated organization;
 *   - what a mint does: the token authenticates as the derived app-user
 *     account (its subject names the organization by id), which sees that
 *     organization alone; with account creation off an unknown person is
 *     refused; the sign-in role is granted once, as an ordinary grant made
 *     by the minting service account, and a later change of the setting
 *     does not reach an existing account;
 *   - what a resource an app user writes records: the minting service
 *     account on its audit actor;
 *   - the lane claims only its tokens: a person's token still passes, and a
 *     typed platform token is refused as unclaimed;
 *   - the origin guard follows the minting organization's embedding
 *     settings on the next request after updateEmbedding, and passes a
 *     request without an Origin;
 *   - liveness: deleting the service account's key leaves its minted tokens
 *     working, and deleting the service account refuses them on the next
 *     request.
 */
import { generateKeyPairSync } from "node:crypto";

import { Code, createClient } from "@connectrpc/connect";
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { fromBinary } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { TokenService } from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { bearer } from "../../../extensions/__tests__/composed-support.js";
import { signPlatformToken } from "../../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "../../identityaccount/__tests__/service-account-support.js";
import type { SignInServer } from "../../identityaccount/__tests__/service-account-support.js";
import {
  DELETED_MINTER_MESSAGE,
  MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
  noAccountMessage,
  originRefusalMessage,
} from "../constants.js";

const FOUNDER = "fake|token-founder";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const built = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [publicKey.export({ format: "pem", type: "spki" }).toString()],
});
if (built.signer === undefined) throw new Error("fixture ring must sign");
const RING: SigningPlatformTokenKeyRing = { ...built, signer: built.signer };

let at: SignInServer;
let acme = "";
let kid = "";
let globex = "";
let adminId = "";
let adminKey = "";
let memberKey = "";

/** Stamps the lowercase `origin` header a browser attaches to a cross-origin call. */
function browserOrigin(origin: string): Interceptor {
  return (next) => (request) => {
    request.header.set("origin", origin);
    return next(request);
  };
}

function presenting(token: string, origin?: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${at.port}`,
    interceptors: [
      bearer(token),
      ...(origin !== undefined ? [browserOrigin(origin)] : []),
    ],
  });
}

async function mint(key: string, org: string, userId: string): Promise<string> {
  const minted = await createClient(TokenService, at.presenting(key)).mintUserToken({
    org,
    userId,
    userEmail: `${userId}@product.example`,
    userName: "Product User",
  });
  return minted.accessToken;
}

async function setEmbedding(
  org: string,
  embedding: {
    createAccountsOnSignIn?: boolean;
    signInRole?: IamRole;
    allowedOrigins?: string[];
  },
): Promise<void> {
  await createClient(OrganizationCommandController, at.as(FOUNDER)).updateEmbedding({
    orgId: org,
    embedding,
  });
}

beforeAll(async () => {
  at = await bootSignInServer("user-token", { drivers: { platformTokenKeys: RING } });
  await provision(at, FOUNDER);
  acme = await foundOrganization(at.as(FOUNDER), "token-acme");
  globex = await foundOrganization(at.as(FOUNDER), "token-globex");
  const child = await createClient(OrganizationCommandController, at.as(FOUNDER)).create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: "token-acme-kid", slug: "token-acme-kid" },
    spec: { parentOrg: acme },
  });
  kid = child.metadata?.id ?? "";
  const admin = await createServiceAccount(at.as(FOUNDER), acme, "dashboard", IamRole.admin);
  adminId = admin.metadata?.id ?? "";
  adminKey = await mintServiceAccountKey(at.as(FOUNDER), adminId, "dashboard-key");
  const member = await createServiceAccount(at.as(FOUNDER), acme, "reporting", IamRole.member);
  memberKey = await mintServiceAccountKey(at.as(FOUNDER), member.metadata?.id ?? "", "reporting-key");
  await setEmbedding(acme, { createAccountsOnSignIn: true, signInRole: IamRole.member });
});

afterAll(async () => {
  await at?.shutdown();
});

describe("who mints a user token", () => {
  it("refuses a person, an admin included, and a member-role service account", async () => {
    const asPerson = await refusal(
      createClient(TokenService, at.as(FOUNDER)).mintUserToken({ org: acme, userId: "u-person" }),
    );
    expect([asPerson.code, asPerson.rawMessage]).toEqual([
      Code.PermissionDenied,
      MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
    ]);
    const asMember = await refusal(mint(memberKey, acme, "u-member"));
    expect([asMember.code, asMember.rawMessage]).toEqual([
      Code.PermissionDenied,
      "unauthorized to mint user tokens for this organization",
    ]);
  });

  it("an admin service account mints into its organization and a child of it, and not into an unrelated one", async () => {
    await mint(adminKey, acme, "u-own");
    await setEmbedding(kid, {});
    // The settings that apply are the minting account's organization's:
    // the child's own (account creation off) are not read.
    const inChild = await mint(adminKey, kid, "u-child");
    const me = await createClient(IdentityAccountQueryController, presenting(inChild)).whoAmI({});
    expect(me.metadata?.id).toBe(accountIdFor(`stgm_pc|${kid}|u-child`));
    const unrelated = await refusal(mint(adminKey, globex, "u-elsewhere"));
    expect(unrelated.code).toBe(Code.PermissionDenied);
  });
});

describe("what a mint does", () => {
  it("authenticates as the derived app-user account, which sees its organization alone", async () => {
    const token = await mint(adminKey, acme, "u-1");
    const me = await createClient(IdentityAccountQueryController, presenting(token)).whoAmI({});
    expect(acme).toMatch(/^org_[0-9a-z]{26}$/);
    expect(me.metadata?.id).toBe(accountIdFor(`stgm_pc|${acme}|u-1`));
    const mine = await createClient(OrganizationQueryController, presenting(token)).listMine({});
    expect(mine.entries.map((organization) => organization.metadata?.id)).toEqual([acme]);
  });

  it("refuses an unknown person while account creation is off", async () => {
    await setEmbedding(acme, { createAccountsOnSignIn: false });
    try {
      const refused = await refusal(mint(adminKey, acme, "u-unknown"));
      expect([refused.code, refused.rawMessage]).toEqual([
        Code.FailedPrecondition,
        noAccountMessage("u-unknown", acme),
      ]);
    } finally {
      await setEmbedding(acme, { createAccountsOnSignIn: true, signInRole: IamRole.member });
    }
  });

  it("grants the sign-in role once, as an ordinary grant made by the minting service account", async () => {
    await mint(adminKey, acme, "u-role");
    await setEmbedding(acme, { createAccountsOnSignIn: true, signInRole: IamRole.viewer });
    try {
      await mint(adminKey, acme, "u-role");
    } finally {
      await setEmbedding(acme, { createAccountsOnSignIn: true, signInRole: IamRole.member });
    }
    const accountId = accountIdFor(`stgm_pc|${acme}|u-role`);
    const granted = at.logs.filter(
      (line) => line.message === "iam policy granted" && line["principalId"] === accountId,
    );
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({
      relation: "member",
      resourceId: acme,
      cause: "grant",
      actorId: adminId,
    });
    const rows = await at.server.store.listResources(ApiResourceKind.grant);
    const held = rows
      .map((row) => fromBinary(GrantSchema, row))
      .filter((policy) => policy.spec?.principal?.id === accountId)
      .map((policy) => `${policy.spec?.relation}@${policy.spec?.resource?.id}`);
    expect(held).toContain(`member@${acme}`);
    expect(held).not.toContain(`viewer@${acme}`);
  });

  it("records the minting service account on what an app user writes", async () => {
    const token = await mint(adminKey, acme, "u-writer");
    const agent = await createClient(AgentCommandController, presenting(token)).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "written-by-app-user", org: acme, visibility: ApiResourceVisibility.visibility_private },
      spec: { instructions: "a conformant instruction body" },
    });
    const createdBy = agent.status?.audit?.specAudit?.createdBy;
    expect(createdBy?.id).toBe(accountIdFor(`stgm_pc|${acme}|u-writer`));
    expect(createdBy?.mintedBy).toBe(adminId);
  });
});

describe("the lane", () => {
  it("claims only its tokens: a person's token passes, and a typed platform token is refused as unclaimed", async () => {
    await createClient(OrganizationQueryController, at.as(FOUNDER)).listMine({});
    const guest = signPlatformToken(RING, { sub: "ida_guest", token_type: "guest" }).token;
    const refused = await refusal(
      createClient(OrganizationQueryController, presenting(guest)).listMine({}),
    );
    expect(refused.code).toBe(Code.Unauthenticated);
  });

  it("refuses an Origin outside the embedding settings on the next request after they change, and passes a request without one", async () => {
    const token = await mint(adminKey, acme, "u-origin");
    await createClient(OrganizationQueryController, presenting(token, "https://evil.example")).listMine({});
    await setEmbedding(acme, {
      createAccountsOnSignIn: true,
      signInRole: IamRole.member,
      allowedOrigins: ["https://app.example"],
    });
    try {
      const denied = await refusal(
        createClient(OrganizationQueryController, presenting(token, "https://evil.example")).listMine({}),
      );
      expect([denied.code, denied.rawMessage]).toEqual([
        Code.PermissionDenied,
        originRefusalMessage("https://evil.example"),
      ]);
      await createClient(OrganizationQueryController, presenting(token)).listMine({});
      await createClient(OrganizationQueryController, presenting(token, "https://APP.example")).listMine({});
    } finally {
      await setEmbedding(acme, { createAccountsOnSignIn: true, signInRole: IamRole.member });
    }
  });
});

describe("liveness", () => {
  it("a minted token outlives its minter's key, and ends with its minter", async () => {
    const temp = await createServiceAccount(at.as(FOUNDER), acme, "short-lived", IamRole.admin);
    const tempId = temp.metadata?.id ?? "";
    const key = await createClient(ApiKeyCommandController, at.as(FOUNDER)).createForServiceAccount({
      serviceAccountId: tempId,
      name: "short-lived-key",
      neverExpires: true,
    });
    const token = await mint(key.spec?.keyHash ?? "", acme, "u-live");
    await createClient(ApiKeyCommandController, at.as(FOUNDER)).delete({ value: key.metadata?.id ?? "" });
    await createClient(OrganizationQueryController, presenting(token)).listMine({});

    await createClient(IdentityAccountCommandController, at.as(FOUNDER)).delete({ value: tempId });
    const denied = await refusal(
      createClient(OrganizationQueryController, presenting(token)).listMine({}),
    );
    expect([denied.code, denied.rawMessage]).toEqual([Code.Unauthenticated, DELETED_MINTER_MESSAGE]);
  });
});
