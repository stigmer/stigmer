/**
 * Pins the built-in role lifecycle in isolation (T01_0_plan.md §3a
 * "role-lifecycle.ts"; T01_1_review.md Q-OR-6a): the
 * ResourceAuthorizationLifecycle open source installs when no unit
 * registers one, over the real grant path, a fake policy store and a fake
 * account port. It is the ROW writer of the built-in authorization posture
 * — the one arm that makes an organization's creator its owner without an
 * administrator — and nothing else:
 *
 *   onResourceCreated
 *   - `organization` with DIRECT attribution, for a caller whose identityId
 *     IS an account: one `owner` row for that account, stamped created_by
 *     the caller; the same event again writes nothing more and does not
 *     throw (the grant path's duplicate arm heals);
 *   - a caller whose identityId is no account — an idp-shaped subject the
 *     verifier admitted before any row existed, the in-process `internal`
 *     class, a runner — writes nothing: the membership rules heal the
 *     creator's ownership at first provisioning through the creator stamp
 *     (Q-OR-6b), so the guard loses nobody;
 *   - an organization whose event carries any other attribution writes
 *     nothing (the proto's owner_type is the truth; the driver follows it
 *     exactly as the cloud's tuple driver does);
 *   - every other kind writes nothing, DIRECT attribution or not: a
 *     per-resource owner row would be the per-resource grant the scope
 *     keeps Enterprise (Q-OR-3).
 *
 *   onResourceDeleted
 *   - `organization` and `identity_account`: every row naming the deleted
 *     resource on EITHER side goes, through the grant path's bidirectional
 *     cleanupResource; every other kind is a no-op.
 *
 *   The rest of the contract
 *   - onVisibilityChanged is a no-op; onDefaultInstanceLinked is not
 *     defined (absent = no structural link, the interface's own word);
 *   - onPolicyGranted / onPolicyRevoked are NOT defined: those hooks are a
 *     composed driver's tuple half, fired by the grant path, and the grant
 *     path's lifecycle is that driver (undefined in open source) — never
 *     this object, which sits ON TOP of the grant path. Acyclic by
 *     construction; this pin keeps it so;
 *   - a store fault propagates out of both resource hooks: the caller
 *     (pipeline/steps/authorization-tuples.ts) fails the create and logs
 *     the delete, and those semantics are the step's to pin, not this
 *     module's.
 */
import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  ResourceCreatedEvent,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import { policyIdFor } from "../constants.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { newBuiltInRoleLifecycle } from "../role-lifecycle.js";
import type { IamPolicyStore } from "../store.js";
import { fakeIamPolicyStore, orgRole, triple } from "./support.js";
import type { RecordedEvent } from "./support.js";

const ALICE_SUBJECT = "auth0|alice";
const ALICE = accountIdFor(ALICE_SUBJECT);
const STRANGER_SUBJECT = "auth0|stranger";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function caller(
  identityId: string,
  callerClass: CallerIdentity["callerClass"] = "user",
): CallerIdentity {
  return {
    identityId,
    callerClass,
    issuer: "https://issuer.example.com",
    rawToken: "",
  };
}

/** The event the OSS step hands a driver after an organization row persists. */
function organizationCreated(
  slug: string,
  by: CallerIdentity,
  ownerAttribution = OwnerAttributionType.DIRECT,
): ResourceCreatedEvent {
  return {
    kind: ApiResourceKind.organization,
    resourceId: slug,
    orgId: "",
    caller: by,
    ownerAttribution,
    requiresCreatorTuple: false,
    parentLinks: [],
    visibilityShapes: [],
  };
}

function deleted(
  kind: ApiResourceKind,
  resourceId: string,
  by: CallerIdentity,
): ResourceDeletedEvent {
  return { kind, resourceId, orgId: "", caller: by };
}

/** A lifecycle over the real grant path (no composed driver, the OSS shape), a fake store and one provisioned account. */
function lifecycleOver(
  recorded: RecordedEvent[] = [],
  store: IamPolicyStore = fakeIamPolicyStore(recorded),
) {
  const accounts = fakeIdentityAccountStore();
  accounts.rows.set(
    ALICE,
    create(IdentityAccountSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { id: ALICE, name: "alice@example.com" },
      spec: {
        idpId: ALICE_SUBJECT,
        email: "alice@example.com",
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  const grantPath = newIamPolicyGrantPath({
    policies: store,
    lifecycle: undefined,
    logger: silentLogger,
  });
  return {
    lifecycle: newBuiltInRoleLifecycle({ grantPath, accounts }),
    grantPath,
    store,
    recorded,
  };
}

describe("onResourceCreated: the creator owns the organization", () => {
  it("writes one owner row for the caller's account, stamped created_by the caller", async () => {
    const recorded: RecordedEvent[] = [];
    const { lifecycle, store } = lifecycleOver(recorded);

    await lifecycle.onResourceCreated(
      organizationCreated("acme", caller(ALICE)),
    );

    const id = policyIdFor(orgRole(ALICE, "owner", "acme"));
    const row = await store.findById(id);
    expect(row?.spec).toEqual(orgRole(ALICE, "owner", "acme"));
    expect(row?.status?.audit?.specAudit?.createdBy?.id).toBe(ALICE);
    expect(recorded).toEqual([{ kind: "row-save", id }]);
  });

  it("the same event again writes nothing more and does not throw — the chains retry whole requests", async () => {
    const recorded: RecordedEvent[] = [];
    const { lifecycle } = lifecycleOver(recorded);
    const event = organizationCreated("acme", caller(ALICE));

    await lifecycle.onResourceCreated(event);
    await expect(lifecycle.onResourceCreated(event)).resolves.toBeUndefined();

    expect(recorded.filter((e) => e.kind === "row-save")).toHaveLength(1);
  });

  it.each([
    ["an idp-shaped subject no account holds", caller(STRANGER_SUBJECT)],
    ["the in-process internal class", caller("internal", "internal")],
    ["a runner", caller("runner-1", "runner")],
  ])(
    "writes nothing for %s — the membership rules heal a real person's ownership at provisioning",
    async (_label, by) => {
      const recorded: RecordedEvent[] = [];
      const { lifecycle } = lifecycleOver(recorded);

      await lifecycle.onResourceCreated(organizationCreated("acme", by));

      expect(recorded).toEqual([]);
    },
  );

  it.each([
    ["SELF", OwnerAttributionType.SELF],
    ["INHERITED", OwnerAttributionType.INHERITED],
    ["NONE", OwnerAttributionType.NONE],
    ["UNSPECIFIED", OwnerAttributionType.UNSPECIFIED],
  ])(
    "writes nothing for an organization event with %s attribution — the proto's owner_type is the truth",
    async (_label, attribution) => {
      const recorded: RecordedEvent[] = [];
      const { lifecycle } = lifecycleOver(recorded);

      await lifecycle.onResourceCreated(
        organizationCreated("acme", caller(ALICE), attribution),
      );

      expect(recorded).toEqual([]);
    },
  );

  it.each([
    ApiResourceKind.agent,
    ApiResourceKind.workflow,
    ApiResourceKind.session,
    ApiResourceKind.identity_account,
    ApiResourceKind.project,
  ])(
    "writes nothing for kind %s even under DIRECT attribution — a per-resource owner row is the grant the scope keeps Enterprise",
    async (kind) => {
      const recorded: RecordedEvent[] = [];
      const { lifecycle } = lifecycleOver(recorded);

      await lifecycle.onResourceCreated({
        ...organizationCreated("x", caller(ALICE)),
        kind,
        resourceId: "res_1",
        orgId: "acme",
      });

      expect(recorded).toEqual([]);
    },
  );
});

describe("onResourceDeleted: the rows die with the resource", () => {
  it("an organization's deletion removes every row on it, as resource and as principal", async () => {
    const recorded: RecordedEvent[] = [];
    const { lifecycle, grantPath, store } = lifecycleOver(recorded);
    await grantPath.grant(orgRole(ALICE, "owner", "acme"), caller(ALICE));
    await grantPath.grant(orgRole(ALICE, "member", "acme"), caller(ALICE));
    await grantPath.grant(
      triple({ kind: "organization", id: "acme" }, "organization", {
        kind: "agent",
        id: AGENT,
      }),
      caller(ALICE),
    );
    const unrelated = orgRole(ALICE, "member", "globex");
    await grantPath.grant(unrelated, caller(ALICE));
    recorded.length = 0;

    await lifecycle.onResourceDeleted(
      deleted(ApiResourceKind.organization, "acme", caller(ALICE)),
    );

    expect(
      [...(await store.findByPrincipal("identity_account", ALICE))].map(
        (p) => p.metadata?.id,
      ),
    ).toEqual([policyIdFor(unrelated)]);
    expect(await store.findByPrincipal("organization", "acme")).toEqual([]);
    expect(recorded.map((e) => e.kind)).toEqual([
      "row-delete",
      "row-delete",
      "row-delete",
    ]);
  });

  it("an identity account's deletion removes every row it holds anywhere", async () => {
    const recorded: RecordedEvent[] = [];
    const { lifecycle, grantPath, store } = lifecycleOver(recorded);
    await grantPath.grant(orgRole(ALICE, "owner", "acme"), caller(ALICE));
    await grantPath.grant(orgRole(ALICE, "member", "globex"), caller(ALICE));
    const bob = accountIdFor("auth0|bob");
    await grantPath.grant(orgRole(bob, "member", "acme"), caller(ALICE));
    recorded.length = 0;

    await lifecycle.onResourceDeleted(
      deleted(ApiResourceKind.identity_account, ALICE, caller(ALICE)),
    );

    expect(await store.findByPrincipal("identity_account", ALICE)).toEqual([]);
    expect(
      (await store.findByPrincipal("identity_account", bob)).map(
        (p) => p.metadata?.id,
      ),
    ).toEqual([policyIdFor(orgRole(bob, "member", "acme"))]);
  });

  it.each([
    ApiResourceKind.agent,
    ApiResourceKind.workflow,
    ApiResourceKind.session,
  ])(
    "kind %s is a no-op — the rows of other kinds are a composed driver's to clean",
    async (kind) => {
      const recorded: RecordedEvent[] = [];
      const { lifecycle, grantPath } = lifecycleOver(recorded);
      await grantPath.grant(
        triple({ kind: "identity_account", id: ALICE }, "viewer", {
          kind: "agent",
          id: AGENT,
        }),
        caller(ALICE),
      );
      recorded.length = 0;

      await lifecycle.onResourceDeleted(deleted(kind, AGENT, caller(ALICE)));

      expect(recorded).toEqual([]);
    },
  );
});

describe("the rest of the contract", () => {
  it("onVisibilityChanged is a no-op and onDefaultInstanceLinked is not defined", async () => {
    const recorded: RecordedEvent[] = [];
    const { lifecycle } = lifecycleOver(recorded);

    await lifecycle.onVisibilityChanged({
      kind: ApiResourceKind.agent,
      resourceId: AGENT,
      orgId: "acme",
      shapesToCreate: ["org-viewer"],
      shapesToDelete: [],
    });

    expect(recorded).toEqual([]);
    expect(lifecycle.onDefaultInstanceLinked).toBeUndefined();
  });

  it("defines neither policy hook — it sits on top of the grant path, never inside it", () => {
    const { lifecycle } = lifecycleOver();
    expect(lifecycle.onPolicyGranted).toBeUndefined();
    expect(lifecycle.onPolicyRevoked).toBeUndefined();
  });

  it("a store fault on the owner row propagates out of onResourceCreated — the step fails the create", async () => {
    const healthy = fakeIamPolicyStore();
    const faulty: IamPolicyStore = {
      ...healthy,
      save: () => Promise.reject(new Error("disk full")),
    };
    const { lifecycle } = lifecycleOver([], faulty);

    await expect(
      lifecycle.onResourceCreated(organizationCreated("acme", caller(ALICE))),
    ).rejects.toThrow("disk full");
  });

  it("a store fault during cleanup propagates out of onResourceDeleted — the step logs and continues", async () => {
    const healthy = fakeIamPolicyStore();
    const faulty: IamPolicyStore = {
      ...healthy,
      deleteById: () => Promise.reject(new Error("disk full")),
    };
    const { lifecycle, grantPath } = lifecycleOver([], faulty);
    await grantPath.grant(orgRole(ALICE, "owner", "acme"), caller(ALICE));

    await expect(
      lifecycle.onResourceDeleted(
        deleted(ApiResourceKind.organization, "acme", caller(ALICE)),
      ),
    ).rejects.toThrow("disk full");
  });
});
