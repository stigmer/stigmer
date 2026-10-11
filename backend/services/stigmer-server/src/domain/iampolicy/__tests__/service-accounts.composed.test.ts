/**
 * Pins the IamPolicy chains' service-account rules (steps.ts, the module
 * header's last paragraph) through a composed server with sign-in on and
 * the built-in Authorizer, over the wire:
 *
 *   - granting `owner` on an organization to a service account is
 *     INVALID_ARGUMENT with SERVICE_ACCOUNT_OWNER_MESSAGE and writes no
 *     row, while `admin` is granted;
 *   - an ADMIN service account's own key, which the model admits to the
 *     organization's roles, is refused every grant and revoke of a role on
 *     the organization (create, delete, revokeOrgAccess) with the refusal
 *     copy, and the organization's rows stay as they were.
 * The arm that lets a service account share one resource, and the
 * owner-step's reads, are pinned at step level in steps.test.ts: open
 * source's grant scope admits organization roles only.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "../../identityaccount/__tests__/service-account-support.js";
import type { SignInServer } from "../../identityaccount/__tests__/service-account-support.js";
import { SERVICE_ACCOUNT_OWNER_MESSAGE } from "../steps.js";
import { orgRole } from "./support.js";

const FOUNDER = "fake|policy-founder";
const PERSON = "fake|policy-person";
const MEMBERSHIP_REFUSAL = serviceAccountRefusedMessage(
  "grant or revoke roles on the organization",
);

let at: SignInServer;
let org: string;
let personId: string;
let robotId: string;
let robotKey: string;

/** `<relation>@<organization>` for every row `principal` holds, sorted. */
async function rolesOf(principal: string): Promise<string[]> {
  const rows = await at.server.store.listResources(ApiResourceKind.iam_policy);
  return rows
    .map((row) => fromBinary(IamPolicySchema, row))
    .filter((p) => p.spec?.principal?.id === principal)
    .map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`)
    .sort();
}

beforeAll(async () => {
  at = await bootSignInServer("iampolicy-service-accounts");
  await provision(at, FOUNDER);
  org = await foundOrganization(at.as(FOUNDER), "policy-acme");
  personId = await provision(at, PERSON);
  const robot = await createServiceAccount(
    at.as(FOUNDER),
    org,
    "policy-robot",
    IamRole.admin,
  );
  robotId = robot.metadata?.id ?? "";
  robotKey = await mintServiceAccountKey(at.as(FOUNDER), robotId, "robot-key");
});

afterAll(async () => {
  await at.shutdown();
});

describe("what a service account may hold on its organization", () => {
  it("never owner: INVALID_ARGUMENT with the copy, and no row", async () => {
    const error = await refusal(
      createClient(IamPolicyCommandController, at.as(FOUNDER)).create(
        orgRole(robotId, "owner", org),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(SERVICE_ACCOUNT_OWNER_MESSAGE);
    expect(await rolesOf(robotId)).toEqual([`admin@${org}`]);
  });

  it("admin, member or viewer: granted", async () => {
    const helper = await createServiceAccount(
      at.as(FOUNDER),
      org,
      "policy-helper",
      IamRole.viewer,
    );
    const id = helper.metadata?.id ?? "";
    await createClient(IamPolicyCommandController, at.as(FOUNDER)).create(
      orgRole(id, "admin", org),
    );
    expect(await rolesOf(id)).toEqual([`admin@${org}`, `viewer@${org}`]);
  });
});

describe("an admin service account's key never changes the organization's roles", () => {
  it("create is refused with the copy, and no row is written", async () => {
    const error = await refusal(
      createClient(IamPolicyCommandController, at.presenting(robotKey)).create(
        orgRole(personId, "admin", org),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(MEMBERSHIP_REFUSAL);
    expect(await rolesOf(personId)).toEqual([`member@${org}`]);
  });

  it("delete is refused with the copy, and the row stays", async () => {
    const error = await refusal(
      createClient(IamPolicyCommandController, at.presenting(robotKey)).delete(
        orgRole(personId, "member", org),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(MEMBERSHIP_REFUSAL);
    expect(await rolesOf(personId)).toEqual([`member@${org}`]);
  });

  it("revokeOrgAccess is refused with the copy, and the person keeps their role", async () => {
    const error = await refusal(
      createClient(
        IamPolicyCommandController,
        at.presenting(robotKey),
      ).revokeOrgAccess({ identityAccountId: personId, org }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(MEMBERSHIP_REFUSAL);
    expect(await rolesOf(personId)).toEqual([`member@${org}`]);
  });

  it("is refused on its own role too: it cannot remove itself from the organization", async () => {
    const error = await refusal(
      createClient(IamPolicyCommandController, at.presenting(robotKey)).delete(
        orgRole(robotId, "admin", org),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(MEMBERSHIP_REFUSAL);
    expect(await rolesOf(robotId)).toEqual([`admin@${org}`]);
  });
});
