/**
 * Pins the IdentityFederation capability: the four federated-account arms
 * open source's identity-account controller dispatches to, AFTER the
 * shared precondition — the controller owns the authorize-on-org, the
 * reference's resolution to its provider's id, the org-match check, and
 * the IdP-exists refusal (through `providerExists`), and hands each arm
 * the RESOLVED ref, which holds the provider's id. What is pinned
 * here is therefore only what differs per edition: the natural-key
 * lookups and writes on the federated rows, with the byte-pinned copy
 * clients match on.
 *
 * Two promises every arm keeps: its one lookup is by the resolved ref's
 * provider id and the external subject, so no arm reaches an account
 * another provider holds, a provider re-created under the same slug
 * included; and deprovision revokes before it
 * deletes, so a revoke that fails deletes nothing and the error reaches
 * the caller. The revoke reaches the provider's organization and every
 * child of that organization, whatever the provider's `external_id_claim`
 * says now (it may have routed a sign-in there before it was cleared), and
 * no other organization. A deprovision that keeps the account while a
 * child of the provider's organization is mid-delete (no request can reach
 * it then) revokes everywhere it can and answers ABORTED naming that child,
 * so offboarding never reports done while a role could survive there; one
 * that deletes the account goes through, its removal reaching every
 * policy. A provider whose delete has begun still exists
 * for the controller's question, so deprovision still offboards under it,
 * while create refuses to make an account under it: before it writes, and
 * again after, when the delete began while it wrote; then it removes the
 * account it made, and a removal that fails is logged by the account's id.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { clone, create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import {
  CreateFederatedAccountInputSchema,
  DeprovisionFederatedAccountInputSchema,
  ExternalSubLookupSchema,
  UpdateFederatedAccountInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { CallerIdentity } from "@stigmer/server";
import { createLogger, DuplicateAccountError } from "@stigmer/server";

import type { IdentityAccountService, NewAccountRequest } from "../account/port.js";
import { newIdentityFederation } from "../identity-federation.js";
import type { IamPolicyGrantPathClient } from "../policy/grant-path-client.js";

const CALLER: CallerIdentity = {
  identityId: "ida_platform_admin",
  callerClass: "user",
  issuer: "https://auth.test",
  rawToken: "h.p.s",
};

const REF: ApiResourceReference = create(ApiResourceReferenceSchema, {
  org: "acme",
  kind: ApiResourceKind.identity_provider,
  id: "idp_acme_okta",
});

function federatedRow(overrides: { id: string; externalSub: string }): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id: overrides.id, org: "acme", name: "old@acme.example" },
    spec: {
      idpId: overrides.externalSub,
      email: "old@acme.example",
      firstName: "Old",
      lastName: "Name",
      pictureUrl: "https://old.pic",
      provisioningMode: IdentityAccountProvisioningMode.federated,
      identityProviderRef: REF,
    },
  });
}

interface Recorded {
  byNaturalKey: IdentityAccount | undefined;
  created: NewAccountRequest[];
  updated: IdentityAccount[];
  deleted: string[];
  revoked: Array<{ accountId: string; org: string }>;
  naturalKeyLookups: Array<[string, string]>;
  /** When set, createAccount rejects with it and the winner appears on the re-read. */
  createFailure?: Error;
  /** When set, bootstrapRevokeOrgAccess rejects with it. */
  revokeFailure?: Error;
}

function harness(
  initial: {
    byNaturalKey?: IdentityAccount;
    createFailure?: Error;
    revokeFailure?: Error;
    /** The provider's external_id_claim; empty routes every sign-in to acme itself. */
    externalIdClaim?: string;
    /** acme's child organizations, as the library's lookup lists them. */
    children?: ReadonlyArray<string>;
    /** acme's child organizations whose delete is pending, which no request can reach. */
    childrenBeingDeleted?: ReadonlyArray<string>;
    /** Successive answers of the pending-delete read, overriding `childrenBeingDeleted` while they last. */
    beingDeletedReads?: ReadonlyArray<ReadonlyArray<string>>;
    /** Organizations a revoke answers NOT_FOUND for: mid-delete when the revoke reaches them. Defaults to the pending ones. */
    unreachable?: ReadonlyArray<string>;
    /** An organization whose revoke fails with a fault that is not NOT_FOUND. */
    faultIn?: { readonly org: string; readonly error: Error };
    /** When set, acme's provider is being deleted: no longer live. */
    deleting?: boolean;
    /**
     * Successive answers of the liveness read, the first being the check
     * before the write; an Error is a read that faults. Overrides `deleting`.
     */
    liveness?: ReadonlyArray<boolean | Error>;
    /** When set, acme's provider is gone from the second read on. */
    goneAfterFirstRead?: boolean;
    /** When set, the provider is deleted and another made under its slug (another id) from the second read on. */
    recreatedAfterFirstRead?: boolean;
    /** When set, deleteAccount rejects with it. */
    deleteFailure?: Error;
    /** When set, every read of the provider store rejects with it. */
    providerReadFailure?: Error;
  } = {},
) {
  const logged: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: "warn",
    pretty: false,
    write: (line: string) => {
      logged.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const liveness = [...(initial.liveness ?? [])];
  let providerReads = 0;
  const recorded: Recorded = {
    byNaturalKey: initial.byNaturalKey,
    created: [],
    updated: [],
    deleted: [],
    revoked: [],
    naturalKeyLookups: [],
    createFailure: initial.createFailure,
    revokeFailure: initial.revokeFailure,
  };
  const accounts = {
    store: {
      findByProviderAndIdpId: (providerId: string, sub: string) => {
        recorded.naturalKeyLookups.push([providerId, sub]);
        return Promise.resolve(recorded.byNaturalKey);
      },
    },
    createAccount: (request: NewAccountRequest) => {
      if (recorded.createFailure !== undefined) {
        recorded.byNaturalKey = federatedRow({
          id: "ida_winner",
          externalSub: request.spec.idpId,
        });
        return Promise.reject(recorded.createFailure);
      }
      recorded.created.push(request);
      return Promise.resolve(
        create(IdentityAccountSchema, {
          metadata: { id: "ida_new", org: request.org ?? "" },
          spec: request.spec,
        }),
      );
    },
    // The guarded write's shape: the change applied to the stored row.
    updateAccount: (id: string, change: (account: IdentityAccount) => void) => {
      const stored = recorded.byNaturalKey;
      if (stored === undefined || stored.metadata?.id !== id) {
        return Promise.resolve(undefined);
      }
      const account = clone(IdentityAccountSchema, stored);
      change(account);
      recorded.updated.push(account);
      return Promise.resolve(account);
    },
    deleteAccount: (account: IdentityAccount) => {
      if (initial.deleteFailure !== undefined) {
        return Promise.reject(initial.deleteFailure);
      }
      recorded.deleted.push(account.metadata?.id ?? "");
      return Promise.resolve();
    },
  } as unknown as IdentityAccountService;
  const beingDeletedReads = [...(initial.beingDeletedReads ?? [])];
  const unreachable = new Set(initial.unreachable ?? initial.childrenBeingDeleted ?? []);
  const policies = {
    bootstrapRevokeOrgAccess: (accountId: string, org: string) => {
      if (recorded.revokeFailure !== undefined) {
        return Promise.reject(recorded.revokeFailure);
      }
      if (initial.faultIn?.org === org) {
        return Promise.reject(initial.faultIn.error);
      }
      if (unreachable.has(org)) {
        return Promise.reject(new ConnectError(`Organization not found: ${org}`, Code.NotFound));
      }
      recorded.revoked.push({ accountId, org });
      return Promise.resolve();
    },
  } as unknown as IamPolicyGrantPathClient;
  // The provider a reference's id names: gone after the first read when
  // asked, and so when another provider took its slug (a new id).
  const providers = {
    findById: (id: string) => {
      providerReads += 1;
      if (initial.providerReadFailure !== undefined) {
        return Promise.reject(initial.providerReadFailure);
      }
      const gone =
        (initial.goneAfterFirstRead === true || initial.recreatedAfterFirstRead === true) && providerReads > 1;
      return Promise.resolve(
        id === "idp_acme_okta" && !gone
          ? ({
              metadata: { id, org: "acme", slug: "acme-okta" },
              spec: { externalIdClaim: initial.externalIdClaim ?? "" },
            } as unknown as IdentityProvider)
          : undefined,
      );
    },
    isLive: (id: string) => {
      const answer = liveness.shift();
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      return Promise.resolve(id === "idp_acme_okta" && (answer ?? initial.deleting !== true));
    },
  };
  const childOrganizations = {
    listIds: (parentId: string) =>
      Promise.resolve(parentId === "acme" ? [...(initial.children ?? [])] : []),
    listIdsBeingDeleted: (parentId: string) =>
      Promise.resolve(
        parentId === "acme" ? [...(beingDeletedReads.shift() ?? initial.childrenBeingDeleted ?? [])] : [],
      ),
  };
  const federation = newIdentityFederation({
    accounts,
    policies,
    providers,
    childOrganizations,
    logger,
  });
  return { federation, recorded, logged };
}

function connectCode(error: unknown): Code | undefined {
  return error instanceof ConnectError ? error.code : undefined;
}

describe("the IdentityFederation capability — createFederatedAccount", () => {
  const input = create(CreateFederatedAccountInputSchema, {
    org: "acme",
    identityProviderRef: REF,
    externalSub: "okta|u1",
    email: "u1@acme.example",
    firstName: "Una",
    lastName: "One",
    pictureUrl: "https://u1.pic",
  });

  it("creates a federated account under the resolved ref: mode federated, the ref, the org, named by its email", async () => {
    const { federation, recorded } = harness();
    const created = await federation.createFederatedAccount(input, REF, CALLER);
    expect(created.metadata?.id).toBe("ida_new");
    expect(recorded.created).toHaveLength(1);
    const request = recorded.created[0];
    expect(request.org).toBe("acme");
    expect(request.name).toBe("u1@acme.example");
    expect(request.spec.idpId).toBe("okta|u1");
    expect(request.spec.provisioningMode).toBe(IdentityAccountProvisioningMode.federated);
    expect(request.spec.identityProviderRef?.id).toBe("idp_acme_okta");
    expect(request.spec.identityProviderRef?.org).toBe("acme");
  });

  it("refuses to make an account under a provider whose delete has begun, and writes nothing", async () => {
    const { federation, recorded } = harness({ deleting: true });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.FailedPrecondition &&
        (error as ConnectError).rawMessage === "This identity provider is being deleted. If its delete failed, delete it again to finish.",
    );
    expect(recorded.created).toEqual([]);
  });

  const BEING_DELETED = "This identity provider is being deleted. If its delete failed, delete it again to finish.";

  it("removes the account it made and refuses, when the provider's delete began while it wrote", async () => {
    const { federation, recorded, logged } = harness({ liveness: [true, false] });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.FailedPrecondition && (error as ConnectError).rawMessage === BEING_DELETED,
    );
    expect(recorded.created).toHaveLength(1);
    expect(recorded.deleted).toEqual(["ida_new"]);
    expect(logged).toEqual([]);
  });

  it("removes the account it made and refuses, when the provider's row is gone after the write", async () => {
    const { federation, recorded } = harness({ goneAfterFirstRead: true });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) => connectCode(error) === Code.FailedPrecondition,
    );
    expect(recorded.deleted).toEqual(["ida_new"]);
  });

  it("removes the account it made and refuses, when the slug names a provider re-created under another id after the write", async () => {
    const { federation, recorded } = harness({ recreatedAfterFirstRead: true });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) => connectCode(error) === Code.FailedPrecondition,
    );
    expect(recorded.deleted).toEqual(["ida_new"]);
  });

  it("removes the account it made when the read after the write faults, and answers that fault", async () => {
    const readDown = new Error("provider read down");
    const { federation, recorded, logged } = harness({ liveness: [true, readDown] });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toBe(readDown);
    expect(recorded.deleted).toEqual(["ida_new"]);
    expect(logged).toEqual([]);
  });

  it("logs an account it cannot remove by its id, and still refuses", async () => {
    const { federation, logged } = harness({
      liveness: [true, false],
      deleteFailure: new Error("account delete down"),
    });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) => connectCode(error) === Code.FailedPrecondition,
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: "error",
      accountId: "ida_new",
      idp: "acme/acme-okta",
      error: "account delete down",
    });
  });

  it("refuses a lost create race under a provider being deleted, leaving the winner to its own writer", async () => {
    const { federation, recorded } = harness({
      createFailure: new DuplicateAccountError("identity account already exists"),
      liveness: [true, false],
    });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) => connectCode(error) === Code.FailedPrecondition,
    );
    expect(recorded.deleted).toEqual([]);
  });

  it("refuses ALREADY_EXISTS with the byte-pinned copy naming the existing id when the natural key is held", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_held", externalSub: "okta|u1" }),
    });
    await expect(federation.createFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.AlreadyExists &&
        (error as ConnectError).rawMessage ===
          "Federated account already exists for this identity provider and external subject (existing id: ida_held)",
    );
    expect(recorded.created, "nothing is created after the refusal").toEqual([]);
  });

  it("resolves a lost create race to the winner by the natural key (create is idempotent under a race)", async () => {
    const { federation, recorded } = harness({
      createFailure: new DuplicateAccountError("identity account already exists"),
    });
    const winner = await federation.createFederatedAccount(input, REF, CALLER);
    expect(winner.metadata?.id).toBe("ida_winner");
    expect(recorded.naturalKeyLookups.at(-1)).toEqual(["idp_acme_okta", "okta|u1"]);
  });
});

describe("the IdentityFederation capability — updateFederatedAccount", () => {
  const input = create(UpdateFederatedAccountInputSchema, {
    org: "acme",
    identityProviderRef: REF,
    externalSub: "okta|u1",
    email: "new@acme.example",
    firstName: "New",
    lastName: "Person",
    pictureUrl: "https://new.pic",
  });

  it("writes the four profile fields and nothing else — the identity keys stay as the row has them", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
    });
    const updated = await federation.updateFederatedAccount(input, REF, CALLER);
    expect(recorded.updated).toHaveLength(1);
    expect(updated.spec?.email).toBe("new@acme.example");
    expect(updated.spec?.firstName).toBe("New");
    expect(updated.spec?.lastName).toBe("Person");
    expect(updated.spec?.pictureUrl).toBe("https://new.pic");
    expect(updated.spec?.idpId).toBe("okta|u1");
    expect(updated.spec?.provisioningMode).toBe(IdentityAccountProvisioningMode.federated);
    expect(updated.spec?.identityProviderRef?.id).toBe("idp_acme_okta");
  });

  it("is NOT_FOUND with the byte-pinned copy when no federated account holds the key", async () => {
    const { federation, recorded } = harness();
    await expect(federation.updateFederatedAccount(input, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.NotFound &&
        (error as ConnectError).rawMessage ===
          "No federated account found for IdP 'acme/acme-okta' with external_sub 'okta|u1'",
    );
    expect(recorded.updated).toEqual([]);
  });
});

describe("the IdentityFederation capability — deprovisionFederatedAccount", () => {
  function input(deleteAccount: boolean) {
    return create(DeprovisionFederatedAccountInputSchema, {
      org: "acme",
      identityProviderRef: REF,
      externalSub: "okta|u1",
      deleteAccount,
    });
  }

  it("revokes the account's access to the org and keeps the row when delete_account is false", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
    });
    const answered = await federation.deprovisionFederatedAccount(input(false), REF, CALLER);
    expect(answered.metadata?.id).toBe("ida_u1");
    expect(recorded.revoked).toEqual([{ accountId: "ida_u1", org: "acme" }]);
    expect(recorded.deleted).toEqual([]);
  });

  it("still offboards an account under a provider whose delete has begun", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      deleting: true,
    });
    await federation.deprovisionFederatedAccount(input(true), REF, CALLER);
    expect(recorded.revoked).toEqual([{ accountId: "ida_u1", org: "acme" }]);
    expect(recorded.deleted).toEqual(["ida_u1"]);
  });

  it("revokes in every child of the provider's organization too, and in no other", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      externalIdClaim: "customer",
      children: ["org_cust_b", "org_cust_a"],
    });
    await federation.deprovisionFederatedAccount(input(false), REF, CALLER);
    expect(recorded.revoked).toEqual([
      { accountId: "ida_u1", org: "acme" },
      { accountId: "ida_u1", org: "org_cust_b" },
      { accountId: "ida_u1", org: "org_cust_a" },
    ]);
    expect(recorded.deleted).toEqual([]);
  });

  it("reaches every child whatever the provider's claim says now: clearing it after a child sign-in keeps no access behind", async () => {
    // The provider routed the person into org_cust_a while it set the
    // claim; an admin has since cleared it. Offboarding still reaches the
    // child, so setting the claim again brings nothing back.
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      children: ["org_cust_a"],
    });
    await federation.deprovisionFederatedAccount(input(false), REF, CALLER);
    expect(recorded.revoked).toEqual([
      { accountId: "ida_u1", org: "acme" },
      { accountId: "ida_u1", org: "org_cust_a" },
    ]);
  });

  it("revokes and then deletes the row when delete_account is true — revoke first, so a failed delete leaves no access behind", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
    });
    await federation.deprovisionFederatedAccount(input(true), REF, CALLER);
    expect(recorded.revoked).toEqual([{ accountId: "ida_u1", org: "acme" }]);
    expect(recorded.deleted).toEqual(["ida_u1"]);
  });

  it("is NOT_FOUND when no federated account holds the key, and revokes nothing", async () => {
    const { federation, recorded } = harness();
    await expect(
      federation.deprovisionFederatedAccount(input(true), REF, CALLER),
    ).rejects.toSatisfy((error: unknown) => connectCode(error) === Code.NotFound);
    expect(recorded.revoked).toEqual([]);
    expect(recorded.deleted).toEqual([]);
  });

  const MID_DELETE =
    "Offboarding is not complete: the child organization 'org_pending' of 'acme' is being deleted, and no role " +
    "there can be revoked until its delete finishes or is refused. The revocations made so far stand; retry " +
    "the deprovision then.";

  it("revokes everywhere it can, then answers ABORTED naming a child mid-delete, when the account is kept", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      children: ["org_live"],
      childrenBeingDeleted: ["org_pending"],
    });
    await expect(federation.deprovisionFederatedAccount(input(false), REF, CALLER)).rejects.toSatisfy(
      (error: unknown) => connectCode(error) === Code.Aborted && (error as ConnectError).rawMessage === MID_DELETE,
    );
    expect(recorded.revoked).toEqual([
      { accountId: "ida_u1", org: "acme" },
      { accountId: "ida_u1", org: "org_live" },
    ]);
    expect(recorded.deleted).toEqual([]);
  });

  it("names every child mid-delete in one answer", async () => {
    const { federation } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      childrenBeingDeleted: ["org_b", "org_a"],
    });
    await expect(federation.deprovisionFederatedAccount(input(false), REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        (error as ConnectError).rawMessage ===
        "Offboarding is not complete: the child organizations 'org_b', 'org_a' of 'acme' are being deleted, and no " +
          "role there can be revoked until their delete finishes or is refused. The revocations made so far stand; " +
          "retry the deprovision then.",
    );
  });

  it("revokes in a child its delete refused between the reads: the pending set is read on both sides of the live one", async () => {
    // org_flip is marked when the live children are listed, so it is not
    // among them, and its delete is refused right after: the read before
    // the live list saw it pending, the read after sees nothing.
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      children: ["org_live"],
      beingDeletedReads: [["org_flip"], []],
      unreachable: [],
    });
    await federation.deprovisionFederatedAccount(input(false), REF, CALLER);
    expect(recorded.revoked).toEqual([
      { accountId: "ida_u1", org: "acme" },
      { accountId: "ida_u1", org: "org_live" },
      { accountId: "ida_u1", org: "org_flip" },
    ]);
  });

  it("answers ABORTED for a live child whose delete began before its revoke reached it", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      children: ["org_marked_since"],
      unreachable: ["org_marked_since"],
    });
    await expect(federation.deprovisionFederatedAccount(input(false), REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.Aborted &&
        (error as ConnectError).rawMessage.includes("'org_marked_since' of 'acme' is being deleted"),
    );
    expect(recorded.revoked).toEqual([{ accountId: "ida_u1", org: "acme" }]);
  });

  it("lets a child's revoke fault other than not-found reach the caller, and deletes nothing", async () => {
    const engineDown = new Error("engine down");
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      children: ["org_live"],
      faultIn: { org: "org_live", error: engineDown },
    });
    await expect(federation.deprovisionFederatedAccount(input(true), REF, CALLER)).rejects.toBe(engineDown);
    expect(recorded.deleted).toEqual([]);
  });

  it("goes through while a child is mid-delete when the account is deleted too: its removal reaches every policy", async () => {
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      childrenBeingDeleted: ["org_pending"],
    });
    await federation.deprovisionFederatedAccount(input(true), REF, CALLER);
    expect(recorded.deleted).toEqual(["ida_u1"]);
  });

  it("deletes nothing when the revoke fails, and the revoke's error reaches the caller", async () => {
    const revokeFailure = new Error("fga unavailable");
    const { federation, recorded } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      revokeFailure,
    });
    await expect(federation.deprovisionFederatedAccount(input(true), REF, CALLER)).rejects.toBe(revokeFailure);
    expect(recorded.deleted).toEqual([]);
  });
});

describe("the IdentityFederation capability — getByExternalSub and providerExists", () => {
  const lookup = create(ExternalSubLookupSchema, {
    org: "acme",
    identityProviderRef: REF,
    externalSub: "okta|u1",
  });

  it("answers the federated account by its natural key", async () => {
    const { federation } = harness({
      byNaturalKey: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
    });
    expect((await federation.getByExternalSub(lookup, REF, CALLER)).metadata?.id).toBe("ida_u1");
  });

  it("keeps the byte-pinned NOT_FOUND when the provider's name cannot be read, naming the provider by its id", async () => {
    const { federation } = harness({ providerReadFailure: new Error("provider store down") });
    await expect(federation.getByExternalSub(lookup, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.NotFound &&
        (error as ConnectError).rawMessage ===
          `No federated account found for IdP 'acme/${REF.id}' with external_sub 'okta|u1'`,
    );
  });

  it("is NOT_FOUND with the byte-pinned copy for an unknown key", async () => {
    const { federation } = harness();
    await expect(federation.getByExternalSub(lookup, REF, CALLER)).rejects.toSatisfy(
      (error: unknown) =>
        connectCode(error) === Code.NotFound &&
        (error as ConnectError).rawMessage ===
          "No federated account found for IdP 'acme/acme-okta' with external_sub 'okta|u1'",
    );
  });

  it("providerExists reads the IdentityProvider store by the id the resolved reference holds, in its organization — the controller's IdP-exists precondition", async () => {
    const { federation } = harness();
    expect(await federation.providerExists("acme", "idp_acme_okta")).toBe(true);
    expect(await federation.providerExists("acme", "idp_acme_google")).toBe(false);
    expect(await federation.providerExists("globex", "idp_acme_okta")).toBe(false);
    expect(await federation.providerExists("acme", "")).toBe(false);
  });

  it("still answers that a provider being deleted exists, so its admins can deprovision and look up its accounts", async () => {
    const { federation } = harness({ deleting: true });
    expect(await federation.providerExists("acme", "idp_acme_okta")).toBe(true);
  });
});

describe("the IdentityFederation capability — every arm is scoped to its own provider", () => {
  type Federation = ReturnType<typeof harness>["federation"];
  const key = { org: "acme", identityProviderRef: REF, externalSub: "okta|u1" };
  const arms: ReadonlyArray<{
    arm: string;
    /** The row the natural key holds when the arm runs: none for a create. */
    held: IdentityAccount | undefined;
    call: (federation: Federation) => Promise<unknown>;
  }> = [
    {
      arm: "create",
      held: undefined,
      call: (federation) =>
        federation.createFederatedAccount(
          create(CreateFederatedAccountInputSchema, { ...key, email: "u1@acme.example" }),
          REF,
          CALLER,
        ),
    },
    {
      arm: "update",
      held: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      call: (federation) =>
        federation.updateFederatedAccount(
          create(UpdateFederatedAccountInputSchema, { ...key, email: "u1@acme.example" }),
          REF,
          CALLER,
        ),
    },
    {
      arm: "deprovision",
      held: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      call: (federation) =>
        federation.deprovisionFederatedAccount(create(DeprovisionFederatedAccountInputSchema, key), REF, CALLER),
    },
    {
      arm: "getByExternalSub",
      held: federatedRow({ id: "ida_u1", externalSub: "okta|u1" }),
      call: (federation) => federation.getByExternalSub(create(ExternalSubLookupSchema, key), REF, CALLER),
    },
  ];

  it("looks up by the resolved ref's provider id and the external subject, once, in every arm", async () => {
    for (const { arm, held, call } of arms) {
      const { federation, recorded } = harness({ byNaturalKey: held });
      await call(federation);
      expect(recorded.naturalKeyLookups, arm).toEqual([["idp_acme_okta", "okta|u1"]]);
    }
  });
});
