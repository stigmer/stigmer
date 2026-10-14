/**
 * Test fixtures for the Grant domain: an in-memory GrantStore with
 * the primary-key semantics the OSS adapter has (a second save under a held
 * id is DuplicateGrantError), a recording lifecycle that captures the two
 * grant hooks in the order they fire beside the store's writes, and spec
 * builders in
 * the contract's own vocabulary. Driver-backed fixtures live with the
 * drivers (the sqlite and postgres __tests__/support modules under
 * src/store).
 */
import { create } from "@bufbuild/protobuf";

import type { Grant } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { GrantSpecSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

import type {
  GrantedEvent,
  OrganizationAffiliationEvent,
  RevokedEvent,
  ResourceAuthorizationLifecycle,
} from "../../../extensions/resource-authorization.js";
import type { GrantChange, GrantChangeRecord } from "../change.js";
import type { StoredResources } from "../grant-path.js";
import { DuplicateGrantError } from "../store.js";
import type { GrantStore } from "../store.js";

/** `identity_account:<id>` holds `<relation>` on `organization:<org>` — the organization role. */
export function orgRole(
  accountId: string,
  relation: string,
  orgId: string,
): GrantSpec {
  return create(GrantSpecSchema, {
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
): GrantSpec {
  return create(GrantSpecSchema, {
    principal: {
      kind: principal.kind,
      id: principal.id,
      relation: principal.relation ?? "",
    },
    relation,
    resource: { kind: resource.kind, id: resource.id },
  });
}

/**
 * A server that stores no resource rows: nothing the sweep meets is
 * anyone's authorship, and no row names an organization a revoke could
 * fall back to.
 */
export const NO_STORED_RESOURCES: StoredResources = storedResources({});

/**
 * Stored rows by `kind:id`: the creator the removal sweep keeps authorship
 * by, and the organization a record falls back to when the resource's
 * scope links are gone. A row named in neither map is not stored.
 */
export function storedResources(rows: {
  readonly creators?: Readonly<Record<string, string>>;
  readonly organizations?: Readonly<Record<string, string>>;
}): StoredResources {
  return {
    async creatorOf(kind, id) {
      return rows.creators?.[`${kind}:${id}`];
    },
    async organizationOf(kind, id) {
      return rows.organizations?.[`${kind}:${id}`] ?? "";
    },
  };
}

/** Recorded creators by `kind:id`, the removal sweep's authorship read. */
export function recordedCreators(
  creators: Readonly<Record<string, string>>,
): StoredResources {
  return storedResources({ creators });
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
    }
  | {
      readonly kind: "affiliation-changing" | "affiliation-changed";
      readonly pair: string;
    };

/** A change record the fake store was handed, beside the write it came with. */
export interface RecordedChange {
  readonly op: "save" | "delete";
  readonly id: string;
  readonly record: GrantChangeRecord | undefined;
}

export interface FakeGrantStore extends GrantStore {
  readonly rows: Map<string, Grant>;
  /** Every save and delete that changed a row, with the record it carried. */
  readonly changes: RecordedChange[];
}

/** An in-memory store with the adapter's primary-key semantics; writes are recorded when a log is given. */
export function fakeGrantStore(
  recorded?: RecordedEvent[],
): FakeGrantStore {
  const rows = new Map<string, Grant>();
  const changes: RecordedChange[] = [];
  // The history a store that keeps one reads back: each organization's
  // changes numbered from 1, in the order they were made, from a head that
  // a removal never resets.
  const history: GrantChange[] = [];
  const heads = new Map<string, bigint>();
  const keep = (
    change: GrantChange["change"],
    grant: Grant,
    record: GrantChangeRecord | undefined,
  ): void => {
    if (record === undefined) {
      return;
    }
    const org = record.organizationId;
    const sequence = (heads.get(org) ?? 0n) + 1n;
    heads.set(org, sequence);
    history.push({
      sequence,
      occurredAt: new Date().toISOString(),
      change,
      actor: record.actor,
      cause: record.cause,
      organizationId: org,
      grant,
    });
  };
  const all = (): Grant[] => [...rows.values()];
  const matches = (
    grant: Grant,
    principalKind?: string,
    principalId?: string,
    resourceKind?: string,
    resourceId?: string,
  ): boolean =>
    (principalKind === undefined ||
      grant.spec?.principal?.kind === principalKind) &&
    (principalId === undefined || grant.spec?.principal?.id === principalId) &&
    (resourceKind === undefined ||
      grant.spec?.resource?.kind === resourceKind) &&
    (resourceId === undefined || grant.spec?.resource?.id === resourceId);
  return {
    rows,
    changes,
    async save(grant, record) {
      const id = grant.metadata?.id ?? "";
      if (rows.has(id)) {
        throw new DuplicateGrantError(`grant '${id}' already exists`);
      }
      rows.set(id, grant);
      changes.push({ op: "save", id, record });
      keep("granted", grant, record);
      recorded?.push({ kind: "row-save", id });
    },
    async deleteById(id, record) {
      const held = rows.get(id);
      if (held !== undefined && rows.delete(id)) {
        changes.push({ op: "delete", id, record });
        keep("revoked", held, record);
      }
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
    async findByResourceKindAndRelation(resourceKind, relation) {
      return all().filter(
        (p) =>
          p.spec?.resource?.kind === resourceKind &&
          p.spec.relation === relation,
      );
    },
    async listChanges(org, page) {
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new Error(`limit must be a positive integer, got ${page.limit}`);
      }
      const own = history.filter((kept) => kept.organizationId === org);
      if ("after" in page) {
        return own
          .filter((kept) => kept.sequence > page.after)
          .slice(0, page.limit);
      }
      const before = page.before;
      return own
        .filter((kept) => before === undefined || kept.sequence < before)
        .reverse()
        .slice(0, page.limit);
    },
    async lastChangeSequence(org) {
      return heads.get(org) ?? 0n;
    },
    async pruneChanges(before, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error(`limit must be a positive integer, got ${limit}`);
      }
      const cutoff = before.toISOString();
      const removed = history
        .filter((kept) => kept.occurredAt < cutoff)
        .sort(oldestChangeFirst)
        .slice(0, limit);
      for (const change of removed) {
        history.splice(history.indexOf(change), 1);
      }
      return removed.length;
    },
  };
}

/** Retention's order: time, then organization, then number. */
function oldestChangeFirst(a: GrantChange, b: GrantChange): number {
  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt < b.occurredAt ? -1 : 1;
  }
  if (a.organizationId !== b.organizationId) {
    return a.organizationId < b.organizationId ? -1 : 1;
  }
  return a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0;
}

/** A lifecycle that records the two grant hooks and can be told to fail either. */
export function recordingLifecycle(
  recorded: RecordedEvent[],
  faults: {
    readonly granted?: Error;
    readonly revoked?: Error;
    readonly changing?: Error;
  } = {},
  options: { readonly affiliation?: boolean } = {},
): ResourceAuthorizationLifecycle {
  const pair = (event: OrganizationAffiliationEvent): string =>
    `${event.identityAccountId}@${event.organizationId}`;
  const affiliation: Pick<
    ResourceAuthorizationLifecycle,
    "onOrganizationAffiliationChanging" | "onOrganizationAffiliationChanged"
  > =
    options.affiliation === true
      ? {
          async onOrganizationAffiliationChanging(event) {
            if (faults.changing !== undefined) {
              throw faults.changing;
            }
            recorded.push({ kind: "affiliation-changing", pair: pair(event) });
          },
          async onOrganizationAffiliationChanged(event) {
            recorded.push({ kind: "affiliation-changed", pair: pair(event) });
          },
        }
      : {};
  return {
    ...affiliation,
    async onResourceCreated() {},
    async onResourceDeleted() {},
    async onVisibilityChanged() {},
    async onGranted(event: GrantedEvent) {
      if (faults.granted !== undefined) {
        throw faults.granted;
      }
      recorded.push({
        kind: "granted",
        id: event.grant.metadata?.id ?? "",
        duplicate: event.duplicate,
      });
    },
    async onRevoked(event: RevokedEvent) {
      if (faults.revoked !== undefined) {
        throw faults.revoked;
      }
      recorded.push({
        kind: "revoked",
        id: event.grant?.metadata?.id,
        relation: event.spec.relation,
      });
    },
  };
}
