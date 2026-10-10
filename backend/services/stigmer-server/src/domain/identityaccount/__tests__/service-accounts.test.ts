/**
 * Pins createServiceAccount and listServiceAccounts
 * (service-accounts.ts) through composed servers, over the wire:
 *
 *   - trusted-local (no sign-in): createServiceAccount is
 *     FAILED_PRECONDITION with the sign-in copy and writes nothing, since
 *     no API-key verifier is composed there and no key could ever
 *     authenticate as the account;
 *   - sign-in on, the built-in Authorizer: an organization admin (not
 *     only its owner) creates one. Its row is mode `service_account`,
 *     `metadata.org` the organization's id, subject `stgm_sa|<org>|…` with
 *     the id derived from it, slug fitted from the name, no person
 *     fields; its role row exists and the grant path recorded the cause
 *     `service_account_created` with the admin as actor;
 *   - the name is unique among one organization's service accounts, by
 *     its slug (ALREADY_EXISTS, reason SERVICE_ACCOUNT_NAME_TAKEN), while
 *     another organization may reuse it; a rename onto a held name is
 *     refused the same way and the slug follows an accepted rename;
 *   - the owner role is INVALID_ARGUMENT; a member is PERMISSION_DENIED;
 *     a service account's own key is refused with the refusal copy, even
 *     an admin service account the model would admit;
 *   - listServiceAccounts answers the organization's service accounts
 *     alone, newest first, keeps one whose role was revoked (so it can
 *     still be deleted), and pages;
 *   - with a composition's own lifecycle, `onServiceAccountLinked` fires
 *     once with the account, the organization and the creating admin, and
 *     a throw there answers INTERNAL with the row in place and listed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, fromBinary } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type {
  ResourceAuthorizationLifecycle,
  ServiceAccountLinkedEvent,
} from "../../../extensions/resource-authorization.js";
import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import { orgRole } from "../../iampolicy/__tests__/support.js";
import {
  seedOrganizations,
  organizationId,
} from "../../organization/__tests__/support.js";
import {
  SERVICE_ACCOUNTS_NEED_SIGN_IN_MESSAGE,
  SERVICE_ACCOUNT_SUBJECT_PREFIX,
  accountIdFor,
  serviceAccountNameTakenMessage,
} from "../constants.js";
import { SERVICE_ACCOUNT_NAME_TAKEN } from "../service-accounts.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "./service-account-support.js";
import type { SignInServer } from "./service-account-support.js";

async function policiesIn(server: ComposedServer): Promise<IamPolicy[]> {
  const rows = await server.store.listResources(ApiResourceKind.iam_policy);
  return rows.map((row) => fromBinary(IamPolicySchema, row));
}

async function serviceAccountRowsIn(server: ComposedServer) {
  const rows = await server.store.listResources(
    ApiResourceKind.identity_account,
  );
  return rows
    .map((row) => fromBinary(IdentityAccountSchema, row))
    .filter(
      (row) =>
        row.spec?.provisioningMode ===
        IdentityAccountProvisioningMode.service_account,
    );
}

describe("createServiceAccount without sign-in (trusted-local)", () => {
  let dir: string;
  let server: ComposedServer;
  let localOrg = "";
  let localPort = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "service-accounts-local-"));
    setOperatorIdentity("operator@example.com", "The Operator");
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: "operator@example.com",
        STIGMER_OPERATOR_NAME: "The Operator",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    localPort = await server.start();
    const ids = await seedOrganizations(
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${localPort}` }),
      ["sa-local"],
    );
    localOrg = organizationId(ids, "sa-local");
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is FAILED_PRECONDITION with the sign-in copy, and writes no account", async () => {
    const error = await refusal(
      createServiceAccount(
        createGrpcTransport({ baseUrl: `http://127.0.0.1:${localPort}` }),
        localOrg,
        "ci-deploy",
        IamRole.member,
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(SERVICE_ACCOUNTS_NEED_SIGN_IN_MESSAGE);
    expect(await serviceAccountRowsIn(server)).toEqual([]);
  });
});

describe("service accounts with sign-in on (built-in Authorizer)", () => {
  const FOUNDER = "fake|sa-founder";
  const ADMIN = "fake|sa-admin";
  const MEMBER = "fake|sa-member";
  let at: SignInServer;
  let adminId: string;
  let acme: string;
  let globex: string;

  beforeAll(async () => {
    at = await bootSignInServer("service-accounts-sign-in");
    await provision(at, FOUNDER);
    acme = await foundOrganization(at.as(FOUNDER), "sa-acme");
    globex = await foundOrganization(at.as(FOUNDER), "sa-globex");
    // Provisioned after both exist: a member of each (arm 5).
    adminId = await provision(at, ADMIN);
    await provision(at, MEMBER);
    await createClient(IamPolicyCommandController, at.as(FOUNDER)).create(
      orgRole(adminId, "admin", acme),
    );
  });

  afterAll(async () => {
    await at.shutdown();
  });

  it("an admin creates one: its own mode, its organization, a reserved subject, its slug, no person fields", async () => {
    const account = await createServiceAccount(
      at.as(ADMIN),
      acme,
      "Nightly Deploy",
      IamRole.member,
    );
    const idpId = account.spec?.idpId ?? "";
    expect(idpId.startsWith(`${SERVICE_ACCOUNT_SUBJECT_PREFIX}${acme}|`)).toBe(
      true,
    );
    expect(account.metadata?.id).toBe(accountIdFor(idpId));
    expect(account.metadata?.org).toBe(acme);
    expect(account.metadata?.name).toBe("Nightly Deploy");
    expect(account.metadata?.slug).toBe("nightly-deploy");
    expect(account.spec).toMatchObject({
      provisioningMode: IdentityAccountProvisioningMode.service_account,
      isMachineAccount: false,
      email: "",
      firstName: "",
      lastName: "",
      pictureUrl: "",
    });
    // The fake verifier admits the raw subject, as a composition's own
    // verifier that runs before any row exists does: the admin is named
    // by the identity the request carried.
    expect(account.status?.audit?.specAudit?.createdBy?.id).toBe(ADMIN);
  });

  it("files an organization named by its slug under the organization's id", async () => {
    const account = await createServiceAccount(
      at.as(FOUNDER),
      "sa-globex",
      "by-slug",
      IamRole.member,
    );
    expect(account.metadata?.org).toBe(globex);
    expect(
      (account.spec?.idpId ?? "").startsWith(
        `${SERVICE_ACCOUNT_SUBJECT_PREFIX}${globex}|`,
      ),
    ).toBe(true);
  });

  it("grants its role through the grant path, with the cause service_account_created and the admin as actor", async () => {
    const account = await createServiceAccount(
      at.as(ADMIN),
      acme,
      "role-check",
      IamRole.viewer,
    );
    const id = account.metadata?.id ?? "";
    const held = (await policiesIn(at.server)).filter(
      (p) => p.spec?.principal?.id === id,
    );
    expect(
      held.map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`),
    ).toEqual([`viewer@${acme}`]);
    const granted = at.logs.filter(
      (line) =>
        line.message === "iam policy granted" && line["principalId"] === id,
    );
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({
      relation: "viewer",
      resourceId: acme,
      cause: "service_account_created",
      actorId: ADMIN,
    });
  });

  it("refuses a name another service account of the organization holds, by slug, and lets another organization reuse it", async () => {
    await createServiceAccount(at.as(ADMIN), acme, "ci", IamRole.member);
    for (const name of ["ci", "CI"]) {
      const error = await refusal(
        createServiceAccount(at.as(ADMIN), acme, name, IamRole.member),
      );
      expect(error.code, name).toBe(Code.AlreadyExists);
      expect(error.rawMessage, name).toBe(serviceAccountNameTakenMessage(name));
      expect(error.findDetails(ErrorInfoSchema)[0]?.reason, name).toBe(
        SERVICE_ACCOUNT_NAME_TAKEN,
      );
    }
    const elsewhere = await createServiceAccount(
      at.as(FOUNDER),
      globex,
      "ci",
      IamRole.member,
    );
    expect(elsewhere.metadata?.org).toBe(globex);
    expect(elsewhere.metadata?.slug).toBe("ci");
  });

  it("a rename moves the slug with the name, and a rename onto a held name is ALREADY_EXISTS", async () => {
    const command = createClient(
      IdentityAccountCommandController,
      at.as(ADMIN),
    );
    const query = createClient(IdentityAccountQueryController, at.as(ADMIN));
    await createServiceAccount(at.as(ADMIN), acme, "held-name", IamRole.member);
    const account = await createServiceAccount(
      at.as(ADMIN),
      acme,
      "before-rename",
      IamRole.member,
    );
    const id = account.metadata?.id ?? "";

    const renamed = clone(
      IdentityAccountSchema,
      await query.get({ value: id }),
    );
    if (renamed.metadata === undefined)
      throw new Error("account has no metadata");
    renamed.metadata.name = "After Rename";
    const updated = await command.update(renamed);
    expect(updated.metadata?.slug).toBe("after-rename");
    expect(updated.metadata?.org).toBe(acme);

    const taken = clone(IdentityAccountSchema, await query.get({ value: id }));
    if (taken.metadata === undefined)
      throw new Error("account has no metadata");
    taken.metadata.name = "held-name";
    const error = await refusal(command.update(taken));
    expect(error.code).toBe(Code.AlreadyExists);
    expect(error.findDetails(ErrorInfoSchema)[0]?.reason).toBe(
      SERVICE_ACCOUNT_NAME_TAKEN,
    );
    expect((await query.get({ value: id })).metadata?.slug).toBe(
      "after-rename",
    );
  });

  it("refuses the owner role with INVALID_ARGUMENT and writes no account", async () => {
    const before = (await serviceAccountRowsIn(at.server)).length;
    const error = await refusal(
      createServiceAccount(at.as(ADMIN), acme, "would-own", IamRole.owner),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect((await serviceAccountRowsIn(at.server)).length).toBe(before);
  });

  it("refuses a member of the organization with PERMISSION_DENIED", async () => {
    const error = await refusal(
      createServiceAccount(at.as(MEMBER), acme, "member-made", IamRole.member),
    );
    expect(error.code).toBe(Code.PermissionDenied);
  });

  it("refuses a service account's own key, even an admin one, with the refusal copy", async () => {
    const robot = await createServiceAccount(
      at.as(ADMIN),
      acme,
      "admin-robot",
      IamRole.admin,
    );
    const key = await mintServiceAccountKey(
      at.as(ADMIN),
      robot.metadata?.id ?? "",
      "robot-key",
    );
    const error = await refusal(
      createServiceAccount(
        at.presenting(key),
        acme,
        "robot-made",
        IamRole.member,
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(
      serviceAccountRefusedMessage("create service accounts"),
    );
  });

  describe("listServiceAccounts", () => {
    let listed: string;
    let made: string[];

    beforeAll(async () => {
      listed = await foundOrganization(at.as(FOUNDER), "sa-listed");
      made = [];
      for (const name of ["first", "second", "third"]) {
        const account = await createServiceAccount(
          at.as(FOUNDER),
          listed,
          name,
          IamRole.member,
        );
        made.push(account.metadata?.id ?? "");
      }
    });

    it("answers the organization's service accounts alone, newest first", async () => {
      const list = await createClient(
        IdentityAccountQueryController,
        at.as(FOUNDER),
      ).listServiceAccounts({ org: listed });
      expect(list.entries.map((a) => a.metadata?.id)).toEqual(
        [...made].reverse(),
      );
      expect(
        list.entries.every(
          (a) =>
            a.spec?.provisioningMode ===
            IdentityAccountProvisioningMode.service_account,
        ),
      ).toBe(true);
      expect(list.totalPages).toBe(1);
    });

    it("keeps a service account whose role was revoked, so it can still be deleted", async () => {
      const revoked = made[0] ?? "";
      await createClient(IamPolicyCommandController, at.as(FOUNDER)).delete(
        orgRole(revoked, "member", listed),
      );
      expect(
        (await policiesIn(at.server)).some(
          (p) => p.spec?.principal?.id === revoked,
        ),
      ).toBe(false);
      const list = await createClient(
        IdentityAccountQueryController,
        at.as(FOUNDER),
      ).listServiceAccounts({ org: listed });
      expect(list.entries.map((a) => a.metadata?.id)).toContain(revoked);
    });

    it("pages", async () => {
      const query = createClient(
        IdentityAccountQueryController,
        at.as(FOUNDER),
      );
      const first = await query.listServiceAccounts({
        org: listed,
        page: { num: 1, size: 2 },
      });
      const second = await query.listServiceAccounts({
        org: listed,
        page: { num: 2, size: 2 },
      });
      const past = await query.listServiceAccounts({
        org: listed,
        page: { num: 3, size: 2 },
      });
      expect(first.totalPages).toBe(2);
      expect(first.entries.map((a) => a.metadata?.id)).toEqual([
        made[2],
        made[1],
      ]);
      expect(second.entries.map((a) => a.metadata?.id)).toEqual([made[0]]);
      expect(past.entries).toEqual([]);
    });

    it("refuses a member of the organization", async () => {
      const error = await refusal(
        createClient(
          IdentityAccountQueryController,
          at.as(MEMBER),
        ).listServiceAccounts({
          org: acme,
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
    });
  });
});

describe("createServiceAccount under a composition's own lifecycle", () => {
  const FOUNDER = "fake|sa-lifecycle-founder";
  const linked: ServiceAccountLinkedEvent[] = [];
  let failNextLink = false;
  let at: SignInServer;
  let org: string;

  const permissive: Authorizer = {
    authorize: () => Promise.resolve({ kind: "allow" }),
  };
  const lifecycle: ResourceAuthorizationLifecycle = {
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: () => Promise.resolve(),
    onVisibilityChanged: () => Promise.resolve(),
    onServiceAccountLinked(event) {
      if (failNextLink) {
        failNextLink = false;
        return Promise.reject(new Error("tuple store unavailable"));
      }
      linked.push(event);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    at = await bootSignInServer("service-accounts-lifecycle", {
      authorizer: permissive,
      drivers: { resourceAuthorizationLifecycle: lifecycle },
    });
    await provision(at, FOUNDER);
    org = await foundOrganization(at.as(FOUNDER), "sa-linked");
  });

  afterAll(async () => {
    await at.shutdown();
  });

  it("fires onServiceAccountLinked once, with the account, its organization and the creating admin", async () => {
    const account = await createServiceAccount(
      at.as(FOUNDER),
      org,
      "linked",
      IamRole.member,
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]?.accountId).toBe(account.metadata?.id);
    expect(linked[0]?.orgId).toBe(org);
    expect(linked[0]?.caller.identityId).toBe(FOUNDER);
  });

  it("a throw there answers INTERNAL, and the row stays in place and listed, with no role", async () => {
    failNextLink = true;
    const error = await refusal(
      createServiceAccount(at.as(FOUNDER), org, "link-fails", IamRole.member),
    );
    expect(error.code).toBe(Code.Internal);
    const list = await createClient(
      IdentityAccountQueryController,
      at.as(FOUNDER),
    ).listServiceAccounts({ org });
    const orphan = list.entries.find((a) => a.metadata?.name === "link-fails");
    expect(orphan).toBeDefined();
    expect(
      (await policiesIn(at.server)).some(
        (p) => p.spec?.principal?.id === orphan?.metadata?.id,
      ),
    ).toBe(false);
  });
});
