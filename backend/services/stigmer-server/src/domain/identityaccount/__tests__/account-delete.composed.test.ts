/**
 * Pins what an account's delete removes before its row goes
 * (controller.ts `deleteAccount`), through a composed server with sign-in
 * on and the built-in Authorizer, over the wire:
 *
 *   - deleting a service account deletes every key that speaks for it and
 *     revokes every policy row naming it, so its key is refused on the next
 *     request and nothing names the account afterwards;
 *   - a person who deletes their account and signs up again under the same
 *     subject (and therefore the same derived id) does not get their old
 *     key back: the key's row went with the account (stigmer#1771);
 *   - a fault deleting the keys, or revoking the policy rows, fails the
 *     delete INTERNAL with the account, its keys and its role still in
 *     place, and the same delete, retried, finishes the job;
 *   - a service account's own key may neither update nor delete an
 *     identity account, its own included (PERMISSION_DENIED with the
 *     refusal copy), though the model makes it its own row's owner.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import type { Store } from "../../../store/interface.js";
import { apiKeyListIndex } from "../../apikey/list-index.js";
import { iamPolicyListIndex } from "../../iampolicy/list-index.js";
import { accountIdFor } from "../constants.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "./service-account-support.js";
import type { SignInServer } from "./service-account-support.js";

const FOUNDER = "fake|delete-founder";
let at: SignInServer;
let org: string;
let seq = 0;

beforeAll(async () => {
  at = await bootSignInServer("account-delete");
  await provision(at, FOUNDER);
  org = await foundOrganization(at.as(FOUNDER), "delete-acme");
});

afterAll(async () => {
  await at.shutdown();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every stored key's id whose creator stamp is one of `owners`. */
async function keysOf(...owners: string[]): Promise<string[]> {
  const rows = await at.server.store.listResources(ApiResourceKind.api_key);
  return rows
    .map((row) => fromBinary(ApiKeySchema, row))
    .filter((key) =>
      owners.includes(key.status?.audit?.specAudit?.createdBy?.id ?? ""),
    )
    .map((key) => key.metadata?.id ?? "");
}

/** Every stored policy row naming `id`, as principal or resource. */
async function rowsNaming(id: string): Promise<string[]> {
  const rows = await at.server.store.listResources(ApiResourceKind.iam_policy);
  return rows
    .map((row) => fromBinary(IamPolicySchema, row))
    .filter((p) => p.spec?.principal?.id === id || p.spec?.resource?.id === id)
    .map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`);
}

async function accountExists(id: string): Promise<boolean> {
  const rows = await at.server.store.listResources(
    ApiResourceKind.identity_account,
  );
  return rows.some(
    (row) => fromBinary(IdentityAccountSchema, row).metadata?.id === id,
  );
}

/** A member service account of the organization with one key; its id and the key's plaintext. */
async function serviceAccountWithKey(): Promise<{ id: string; key: string }> {
  seq += 1;
  const account = await createServiceAccount(
    at.as(FOUNDER),
    org,
    `deletable-${seq}`,
    IamRole.member,
  );
  const id = account.metadata?.id ?? "";
  const key = await mintServiceAccountKey(at.as(FOUNDER), id, `key-${seq}`);
  return { id, key };
}

describe("deleting an account removes what speaks for it before its row goes", () => {
  it("a service account: its keys are deleted and refused on the next request, and no policy row names it", async () => {
    const { id, key } = await serviceAccountWithKey();
    const overKey = createClient(
      IdentityAccountQueryController,
      at.presenting(key),
    );
    expect((await overKey.whoAmI({})).metadata?.id).toBe(id);
    expect(await keysOf(id)).toHaveLength(1);
    expect(await rowsNaming(id)).toEqual([`member@${org}`]);

    await createClient(IdentityAccountCommandController, at.as(FOUNDER)).delete(
      {
        value: id,
      },
    );

    expect(await keysOf(id)).toEqual([]);
    expect(await rowsNaming(id)).toEqual([]);
    expect(await accountExists(id)).toBe(false);
    const error = await refusal(overKey.whoAmI({}));
    expect(error.code).toBe(Code.Unauthenticated);
    expect(error.rawMessage).toBe("invalid token");
  });

  it("a person who signs up again under the same subject does not get their old key back (stigmer#1771)", async () => {
    const PERSON = "fake|delete-returning";
    const personId = await provision(at, PERSON);
    const created = await createClient(
      ApiKeyCommandController,
      at.as(PERSON),
    ).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "before-departure", org },
      spec: {},
    });
    const overKey = createClient(
      IdentityAccountQueryController,
      at.presenting(created.spec?.keyHash ?? ""),
    );
    expect((await overKey.whoAmI({})).metadata?.id).toBe(personId);
    expect(await rowsNaming(personId)).toContain(`member@${org}`);

    await createClient(IdentityAccountCommandController, at.as(PERSON)).delete({
      value: personId,
    });
    expect(await keysOf(personId, PERSON)).toEqual([]);
    expect(await rowsNaming(personId)).toEqual([]);

    // The same subject derives the same id.
    expect(await provision(at, PERSON)).toBe(personId);
    expect(accountIdFor(PERSON)).toBe(personId);
    const error = await refusal(overKey.whoAmI({}));
    expect(error.code).toBe(Code.Unauthenticated);
    expect(error.rawMessage).toBe("invalid token");
  });
});

describe("a fault before the row goes fails the delete with everything in place", () => {
  it("deleting the keys: INTERNAL, the account, its key and its role remain, and a retry finishes", async () => {
    const { id } = await serviceAccountWithKey();
    const queryResources = at.server.store.queryResources.bind(at.server.store);
    vi.spyOn(at.server.store, "queryResources").mockImplementation(((
      declaration,
      request,
    ) => {
      if (declaration === apiKeyListIndex) {
        return Promise.reject(new Error("key index unavailable"));
      }
      return queryResources(declaration, request);
    }) as Store["queryResources"]);

    const command = createClient(
      IdentityAccountCommandController,
      at.as(FOUNDER),
    );
    const error = await refusal(command.delete({ value: id }));
    expect(error.code).toBe(Code.Internal);
    expect(await accountExists(id)).toBe(true);
    expect(await keysOf(id)).toHaveLength(1);
    expect(await rowsNaming(id)).toEqual([`member@${org}`]);

    vi.restoreAllMocks();
    await command.delete({ value: id });
    expect(await accountExists(id)).toBe(false);
    expect(await keysOf(id)).toEqual([]);
    expect(await rowsNaming(id)).toEqual([]);
  });

  it("revoking the policy rows: INTERNAL, the account and its role remain, and a retry finishes", async () => {
    const { id } = await serviceAccountWithKey();
    const queryResources = at.server.store.queryResources.bind(at.server.store);
    vi.spyOn(at.server.store, "queryResources").mockImplementation(((
      declaration,
      request,
    ) => {
      // Only the read of the deleted account's own rows: the admin's
      // authorization reads the admin's rows through the same index.
      if (
        declaration === iamPolicyListIndex &&
        (request.anyKey ?? []).some((key) => key.value === id)
      ) {
        return Promise.reject(new Error("policy index unavailable"));
      }
      return queryResources(declaration, request);
    }) as Store["queryResources"]);

    const command = createClient(
      IdentityAccountCommandController,
      at.as(FOUNDER),
    );
    const error = await refusal(command.delete({ value: id }));
    expect(error.code).toBe(Code.Internal);
    // The keys went first, so the fault is the revocation's, after them.
    expect(await keysOf(id)).toEqual([]);
    expect(await accountExists(id)).toBe(true);
    expect(await rowsNaming(id)).toEqual([`member@${org}`]);

    vi.restoreAllMocks();
    await command.delete({ value: id });
    expect(await accountExists(id)).toBe(false);
    expect(await rowsNaming(id)).toEqual([]);
  });
});

describe("a service account's own key changes no identity account", () => {
  it("is refused update and delete of its own account, which stays as it was", async () => {
    seq += 1;
    const account = await createServiceAccount(
      at.as(FOUNDER),
      org,
      `self-changer-${seq}`,
      IamRole.admin,
    );
    const id = account.metadata?.id ?? "";
    const key = await mintServiceAccountKey(at.as(FOUNDER), id, "self-key");
    const asRobot = createClient(
      IdentityAccountCommandController,
      at.presenting(key),
    );
    const current = await createClient(
      IdentityAccountQueryController,
      at.as(FOUNDER),
    ).get({ value: id });

    const update = await refusal(asRobot.update(current));
    expect(update.code).toBe(Code.PermissionDenied);
    expect(update.rawMessage).toBe(
      serviceAccountRefusedMessage("change or delete identity accounts"),
    );
    const remove = await refusal(asRobot.delete({ value: id }));
    expect(remove.code).toBe(Code.PermissionDenied);
    expect(remove.rawMessage).toBe(
      serviceAccountRefusedMessage("change or delete identity accounts"),
    );
    expect(await accountExists(id)).toBe(true);
    expect(await keysOf(id)).toHaveLength(1);
  });
});
