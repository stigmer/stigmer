/**
 * Test fixtures for the IamPolicy domain: an in-memory IamPolicyStore with
 * the primary-key semantics the OSS adapter has (a second save under a held
 * id is DuplicatePolicyError), a recording lifecycle that captures the two
 * policy hooks in the order they fire beside the store's writes (the shape
 * the cloud's service.test.ts used to pin cloud#425), and spec builders in
 * the contract's own vocabulary. Driver-backed fixtures live with the
 * drivers (the sqlite and postgres __tests__/support modules under
 * src/store).
 */
import { create } from "@bufbuild/protobuf";

import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type {
  PolicyGrantedEvent,
  PolicyRevokedEvent,
  ResourceAuthorizationLifecycle,
} from "../../../extensions/resource-authorization.js";
import { DuplicatePolicyError } from "../store.js";
import type { IamPolicyStore } from "../store.js";

/** `identity_account:<id>` holds `<relation>` on `organization:<org>` — the organization role. */
export function orgRole(
  accountId: string,
  relation: string,
  orgId: string,
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
    principal: { kind: "identity_account", id: accountId },
    relation,
    resource: { kind: "organization", id: orgId },
  });
}

/** Any triple, spelled out. */
export function triple(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
    principal: {
      kind: principal.kind,
      id: principal.id,
      relation: principal.relation ?? "",
    },
    relation,
    resource: { kind: resource.kind, id: resource.id },
  });
}

/** What a recording fixture saw, in order. */
export type RecordedEvent =
  | { readonly kind: "row-save"; readonly id: string }
  | { readonly kind: "row-delete"; readonly id: string }
  | {
      readonly kind: "granted";
      readonly id: string;
      readonly duplicate: boolean;
    }
  | {
      readonly kind: "revoked";
      readonly id: string | undefined;
      readonly relation: string;
    };

export interface FakeIamPolicyStore extends IamPolicyStore {
  readonly rows: Map<string, IamPolicy>;
}

/** An in-memory store with the adapter's primary-key semantics; writes are recorded when a log is given. */
export function fakeIamPolicyStore(
  recorded?: RecordedEvent[],
): FakeIamPolicyStore {
  const rows = new Map<string, IamPolicy>();
  const all = (): IamPolicy[] => [...rows.values()];
  const matches = (
    policy: IamPolicy,
    principalKind?: string,
    principalId?: string,
    resourceKind?: string,
    resourceId?: string,
  ): boolean =>
    (principalKind === undefined ||
      policy.spec?.principal?.kind === principalKind) &&
    (principalId === undefined || policy.spec?.principal?.id === principalId) &&
    (resourceKind === undefined ||
      policy.spec?.resource?.kind === resourceKind) &&
    (resourceId === undefined || policy.spec?.resource?.id === resourceId);
  return {
    rows,
    async save(policy) {
      const id = policy.metadata?.id ?? "";
      if (rows.has(id)) {
        throw new DuplicatePolicyError(`IAM policy '${id}' already exists`);
      }
      rows.set(id, policy);
      recorded?.push({ kind: "row-save", id });
    },
    async deleteById(id) {
      rows.delete(id);
      recorded?.push({ kind: "row-delete", id });
    },
    async findById(id) {
      return rows.get(id);
    },
    async findByPrincipal(principalKind, principalId) {
      return all().filter((p) => matches(p, principalKind, principalId));
    },
    async findByResource(resourceKind, resourceId) {
      return all().filter((p) =>
        matches(p, undefined, undefined, resourceKind, resourceId),
      );
    },
    async findByPrincipalAndResource(
      principalKind,
      principalId,
      resourceKind,
      resourceId,
    ) {
      return all().filter((p) =>
        matches(p, principalKind, principalId, resourceKind, resourceId),
      );
    },
    async findByResourceWithRelations(resourceKind, resourceId, relations) {
      return all().filter(
        (p) =>
          matches(p, undefined, undefined, resourceKind, resourceId) &&
          relations.includes(p.spec?.relation ?? ""),
      );
    },
    async countDistinctPrincipalsByResource(
      resourceKind,
      resourceId,
      principalKind,
      relations,
    ) {
      const seen = new Set<string>();
      for (const p of all()) {
        if (
          matches(p, principalKind, undefined, resourceKind, resourceId) &&
          relations.includes(p.spec?.relation ?? "")
        ) {
          seen.add(`${p.spec?.principal?.kind}:${p.spec?.principal?.id}`);
        }
      }
      return seen.size;
    },
    async findScopeTuple(resourceKind, resourceId) {
      return all().find(
        (p) =>
          matches(p, undefined, undefined, resourceKind, resourceId) &&
          !["identity_account", "team"].includes(
            p.spec?.principal?.kind ?? "",
          ) &&
          !["owner", "creator"].includes(p.spec?.relation ?? ""),
      );
    },
  };
}

/** A lifecycle that records the two policy hooks and can be told to fail either. */
export function recordingLifecycle(
  recorded: RecordedEvent[],
  faults: { readonly granted?: Error; readonly revoked?: Error } = {},
): ResourceAuthorizationLifecycle {
  return {
    async onResourceCreated() {},
    async onResourceDeleted() {},
    async onVisibilityChanged() {},
    async onPolicyGranted(event: PolicyGrantedEvent) {
      if (faults.granted !== undefined) {
        throw faults.granted;
      }
      recorded.push({
        kind: "granted",
        id: event.policy.metadata?.id ?? "",
        duplicate: event.duplicate,
      });
    },
    async onPolicyRevoked(event: PolicyRevokedEvent) {
      if (faults.revoked !== undefined) {
        throw faults.revoked;
      }
      recorded.push({
        kind: "revoked",
        id: event.policy?.metadata?.id,
        relation: event.spec.relation,
      });
    },
  };
}
