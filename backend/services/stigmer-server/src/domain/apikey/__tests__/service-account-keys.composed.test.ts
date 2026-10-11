/**
 * Pins whose API keys are whose, on a composed server in the
 * authentication posture with the built-in Authorizer (a unit that vouches
 * for tokens and registers no Authorizer: the open-source sign-in
 * self-host's shape). The founder creates an organization and owns it; a
 * second person signs up afterwards and is its member (the membership
 * rules' last arm); the founder creates service accounts in it and keys
 * for them. A service account acts through the plaintext of its key.
 * The fake verifier admits a person by their raw subject, so a person's
 * keys carry the subject as their stamp: the owner read answers both of a
 * person's names, which is what these lists exercise.
 *
 *   - findAll answers the caller's own keys only: another person's never
 *     appear, and an admin's list never includes a service account's
 *     keys, which the admin reaches through findByAccount instead;
 *   - a key's name is unique among its owner's keys, not its
 *     organization's (stigmer#2111): two people of one organization may
 *     each name a key "ci"; one person naming a second key "ci" is
 *     ALREADY_EXISTS, and the copy names no other key's id;
 *   - createForServiceAccount, by an admin, makes a key that speaks for
 *     the service account (its creator stamp), filed in and bound to the
 *     account's organization (metadata.org and spec.bound_org), with the
 *     plaintext answered once; the key authenticates as the account. A
 *     member is refused; a person target is refused (nobody manages a
 *     person's keys, so PERMISSION_DENIED under the built-in model, and
 *     FAILED_PRECONDITION past a permissive Authorizer, where the
 *     controller's own check is what refuses it); a service account's own
 *     key is refused even where its admin role would admit it;
 *   - findByAccount: an admin lists a service account's keys, a member is
 *     refused, a person lists their own;
 *   - a service account's key may not create or change a key.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import { notAServiceAccountMessage } from "../controller.js";

const FOUNDER = "fake|keys-founder";
const MEMBER = "fake|keys-member";
const ORG = "keys-org";

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

function keyInput(name: string, org: string) {
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name, org },
    spec: {},
  };
}

function idsOf(keys: ReadonlyArray<ApiKey>): string[] {
  return keys.map((key) => key.metadata?.id ?? "").sort();
}

async function composeWith(
  dir: string,
  unit: ServerExtension,
): Promise<{ server: ComposedServer; port: number }> {
  const server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    extensions: [unit],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  return { server, port };
}

describe("API keys and service accounts (composed server, built-in Authorizer)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;
  const founderId = accountIdFor(FOUNDER);
  const memberId = accountIdFor(MEMBER);

  /** The admin-role service account, and the plaintext of its first key. */
  let adminSa: { id: string; key: string; keyId: string };
  /** The member-role service account, with one key the founder minted. */
  let memberSa: { id: string; keyId: string };

  const asFounder = (): Transport =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = (): Transport =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));
  const presenting = (token: string): Transport => transportFor(port, token);

  async function createServiceAccount(
    name: string,
    role: IamRole,
  ): Promise<string> {
    const account = await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).createServiceAccount({ org: orgId, name, role });
    return account.metadata?.id ?? "";
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "service-account-keys-composed-"));
    ({ server, port } = await composeWith(dir, {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    }));

    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    const organization = await createClient(
      OrganizationCommandController,
      asFounder(),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    orgId = organization.metadata?.id ?? "";
    await createClient(
      IdentityAccountCommandController,
      asMember(),
    ).provisionMyAccount({});

    const keys = createClient(ApiKeyCommandController, asFounder());
    const adminSaId = await createServiceAccount("ci-admin", IamRole.admin);
    const adminKey = await keys.createForServiceAccount({
      serviceAccountId: adminSaId,
      name: "deploy",
      neverExpires: true,
    });
    adminSa = {
      id: adminSaId,
      key: adminKey.spec?.keyHash ?? "",
      keyId: adminKey.metadata?.id ?? "",
    };
    const memberSaId = await createServiceAccount("ci-member", IamRole.member);
    const memberKey = await keys.createForServiceAccount({
      serviceAccountId: memberSaId,
      name: "deploy",
      neverExpires: true,
    });
    memberSa = { id: memberSaId, keyId: memberKey.metadata?.id ?? "" };
  });

  afterAll(async () => {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the founder owns the organization and the second person is its member (the roles every case below stands on)", async () => {
    const rows = await server.store.listResources(ApiResourceKind.iam_policy);
    const roles = rows
      .map((row) => fromBinary(IamPolicySchema, row).spec)
      .filter((spec) => spec?.resource?.id === orgId)
      .map((spec) => `${spec?.principal?.id}:${spec?.relation}`);
    expect(roles).toContain(`${founderId}:owner`);
    expect(roles).toContain(`${memberId}:member`);
  });

  describe("createForServiceAccount", () => {
    it("an admin's key speaks for the service account, filed in and bound to its organization, with the plaintext answered once", async () => {
      const created = await createClient(
        ApiKeyCommandController,
        asFounder(),
      ).createForServiceAccount({
        serviceAccountId: memberSa.id,
        name: "release",
        neverExpires: true,
      });
      const plaintext = created.spec?.keyHash ?? "";
      expect(plaintext.startsWith("stk_")).toBe(true);
      expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(memberSa.id);
      expect(created.spec?.boundOrg).toBe(orgId);
      expect(created.metadata?.org).toBe(orgId);

      const fetched = await createClient(
        ApiKeyQueryController,
        asFounder(),
      ).get({ value: created.metadata?.id ?? "" });
      expect(fetched.spec?.keyHash).not.toBe("");
      expect(fetched.spec?.keyHash).not.toBe(plaintext);
      expect(fetched.spec?.boundOrg).toBe(orgId);
      expect(fetched.metadata?.org).toBe(orgId);
    });

    it("the minted key authenticates as the service account", async () => {
      const me = await createClient(
        IdentityAccountQueryController,
        presenting(adminSa.key),
      ).whoAmI({});
      expect(me.metadata?.id).toBe(adminSa.id);
    });

    it("a member is refused", async () => {
      const error = await refusal(
        createClient(
          ApiKeyCommandController,
          asMember(),
        ).createForServiceAccount({
          serviceAccountId: memberSa.id,
          name: "smuggled",
          neverExpires: true,
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
    });

    it("a person's account is no target: nobody manages a person's keys", async () => {
      const error = await refusal(
        createClient(
          ApiKeyCommandController,
          asFounder(),
        ).createForServiceAccount({
          serviceAccountId: memberId,
          name: "for someone else",
          neverExpires: true,
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
    });

    it("a service account's own key is refused, even an admin's minting for itself", async () => {
      const error = await refusal(
        createClient(
          ApiKeyCommandController,
          presenting(adminSa.key),
        ).createForServiceAccount({
          serviceAccountId: adminSa.id,
          name: "another",
          neverExpires: true,
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        serviceAccountRefusedMessage("create API keys"),
      );
    });
  });

  describe("a service account's key never decides what credentials exist", () => {
    it("create is refused", async () => {
      const error = await refusal(
        createClient(ApiKeyCommandController, presenting(adminSa.key)).create(
          keyInput("own", orgId),
        ),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        serviceAccountRefusedMessage("create API keys"),
      );
    });

    it("update of its own key is refused", async () => {
      const query = createClient(
        ApiKeyQueryController,
        presenting(adminSa.key),
      );
      const own = await query.get({ value: adminSa.keyId });
      if (own.spec !== undefined) {
        own.spec.neverExpires = false;
      }
      const error = await refusal(
        createClient(ApiKeyCommandController, presenting(adminSa.key)).update(
          own,
        ),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        serviceAccountRefusedMessage("change an API key"),
      );
    });
  });

  describe("findByAccount", () => {
    it("an admin lists a service account's keys", async () => {
      const listed = await createClient(
        ApiKeyQueryController,
        asFounder(),
      ).findByAccount({ value: adminSa.id });
      expect(idsOf(listed.entries)).toEqual([adminSa.keyId]);
    });

    it("a member is refused", async () => {
      const error = await refusal(
        createClient(ApiKeyQueryController, asMember()).findByAccount({
          value: memberSa.id,
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
    });

    it("a person lists their own", async () => {
      const own = await createClient(
        ApiKeyCommandController,
        asMember(),
      ).create(keyInput("listed by account", orgId));
      const listed = await createClient(
        ApiKeyQueryController,
        asMember(),
      ).findByAccount({ value: memberId });
      expect(idsOf(listed.entries)).toContain(own.metadata?.id ?? "");
      // The fake verifier stamps the raw subject, so the person's keys
      // carry it rather than the account id: both names are the person's.
      for (const key of listed.entries) {
        expect([memberId, MEMBER]).toContain(
          key.status?.audit?.specAudit?.createdBy?.id ?? "",
        );
      }
    });
  });

  describe("findAll answers the caller's own keys", () => {
    it("never another person's, and never a service account's for an admin", async () => {
      const founderKey = await createClient(
        ApiKeyCommandController,
        asFounder(),
      ).create(keyInput("founder's own", orgId));
      const memberKey = await createClient(
        ApiKeyCommandController,
        asMember(),
      ).create(keyInput("member's own", orgId));

      const founders = await createClient(
        ApiKeyQueryController,
        asFounder(),
      ).findAll({});
      const founderIds = idsOf(founders.entries);
      expect(founderIds).toContain(founderKey.metadata?.id ?? "");
      expect(founderIds).not.toContain(memberKey.metadata?.id ?? "");
      expect(founderIds).not.toContain(adminSa.keyId);
      expect(founderIds).not.toContain(memberSa.keyId);
      for (const key of founders.entries) {
        expect([founderId, FOUNDER]).toContain(
          key.status?.audit?.specAudit?.createdBy?.id ?? "",
        );
      }

      const members = await createClient(
        ApiKeyQueryController,
        asMember(),
      ).findAll({});
      expect(idsOf(members.entries)).toContain(memberKey.metadata?.id ?? "");
      expect(idsOf(members.entries)).not.toContain(
        founderKey.metadata?.id ?? "",
      );
    });

    it("a service account's findAll is its own keys", async () => {
      const listed = await createClient(
        ApiKeyQueryController,
        presenting(adminSa.key),
      ).findAll({});
      expect(idsOf(listed.entries)).toEqual([adminSa.keyId]);
    });
  });

  describe("a key's name is unique among its owner's keys (stigmer#2111)", () => {
    it("two people of one organization may each name a key ci, by its id or its slug", async () => {
      const founders = await createClient(
        ApiKeyCommandController,
        asFounder(),
      ).create(keyInput("ci", orgId));
      const members = await createClient(
        ApiKeyCommandController,
        asMember(),
      ).create(keyInput("ci", ORG));
      expect(founders.metadata?.slug).toBe("ci");
      expect(members.metadata?.slug).toBe("ci");
      expect(members.metadata?.id).not.toBe(founders.metadata?.id);
    });

    it("one person naming a second key ci is ALREADY_EXISTS, and the copy names no other key's id", async () => {
      const first = await createClient(
        ApiKeyCommandController,
        asFounder(),
      ).create(keyInput("ci-twice", orgId));
      const error = await refusal(
        createClient(ApiKeyCommandController, asFounder()).create(
          keyInput("ci-twice", orgId),
        ),
      );
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toBe("ApiKey already exists: slug 'ci-twice'");
      expect(error.rawMessage).not.toContain(first.metadata?.id ?? "");
    });

    it("two service accounts of one organization may each hold a key of one name", async () => {
      // Both service accounts' first keys were named "deploy" in setup.
      const keys = await createClient(
        ApiKeyQueryController,
        asFounder(),
      ).findByAccount({ value: memberSa.id });
      expect(keys.entries.some((key) => key.metadata?.slug === "deploy")).toBe(
        true,
      );
      expect(adminSa.keyId).not.toBe(memberSa.keyId);
    });
  });
});

describe("createForServiceAccount past a permissive Authorizer", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  const PERSON = "fake|permissive-person";

  const permissiveAuthorizer: Authorizer = {
    authorize: () => Promise.resolve({ kind: "allow" }),
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "service-account-keys-permissive-"));
    ({ server, port } = await composeWith(dir, {
      name: "fake-permissive",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      authorizer: permissiveAuthorizer,
    }));
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(PERSON, "person@example.com")),
    ).provisionMyAccount({});
  });

  afterAll(async () => {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a target that is not a service account is FAILED_PRECONDITION, and no key is made", async () => {
    const personId = accountIdFor(PERSON);
    const error = await refusal(
      createClient(
        ApiKeyCommandController,
        transportFor(port, fakeJwt(PERSON, "person@example.com")),
      ).createForServiceAccount({
        serviceAccountId: personId,
        name: "not for a person",
        neverExpires: true,
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(notAServiceAccountMessage(personId));
    expect(await server.store.listResources(ApiResourceKind.api_key)).toEqual(
      [],
    );
  });
});
