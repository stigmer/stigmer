/**
 * The owner-row reconcile: at every boot, every kind that records no owner
 * loses any direct `owner` policy row it still holds. Four kinds, in the
 * model `@stigmer/server` ships, are managed by their organization's
 * current admins alone (`owner: admin from organization`, kind_meta
 * `owner_type` NONE): federation issuers and invitations since
 * stigmer/stigmer#1314, the Enterprise domain's to reconcile
 * (extension/enterprise-identity.ts), and OAuth apps and channel apps
 * since stigmer/stigmer#1329 and stigmer/stigmer#1426, the host's.
 *
 * Why the rows exist at all: until those models, the creation event wrote
 * `<kind>:<id>#owner@identity_account:<creator>`, and a Grant grant
 * could write the same shape. A creator demoted below admin, or removed,
 * kept full control of the row through it: for a provider enough to mint
 * an owner of the organization, for an app enough to change its
 * credentials. The model no longer admits the
 * shape, so a stored row grants nothing once that model is applied; until
 * then it still grants, and after it every access listing would still
 * show it. So the row goes.
 *
 * One read per kind: every `owner` row on the kind, from the policy table
 * (`OwnerRowReads`, the adapter's `findByResourceKindAndRelation`).
 * The question is which owner rows exist, not which resources exist, so
 * the reconcile never enumerates a kind's rows, and a row left on a
 * resource that is already gone goes too.
 *
 * The revoke goes through the grant path (`delete`, as the server itself),
 * so the tuple goes before the row and the two stores never disagree the
 * fail-open way. OpenFGA deletes such a tuple under a model that no longer
 * admits its shape as well as under one that does, so the revoke holds on
 * either side of a model change. A row written by an older server is
 * revoked at the next boot.
 *
 * Posture: the organization-link reconcile's (iam/organization-links.ts).
 * It reports what it revoked; one row's failure is reported while the rest
 * continue, and one kind's failed read is logged while the next kind
 * runs; the caller logs and boot proceeds.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Grant } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { Logger } from "@stigmer/server";

import type { GrantPathClient } from "./grant/grant-path-client.js";

/** The relation no row of a no-owner kind may hold directly. */
const OWNER = "owner";

/** The one read the reconcile makes: every policy row granting `relation` on a kind. */
export interface OwnerRowReads {
  findByResourceKindAndRelation(
    resourceKind: string,
    relation: string,
  ): Promise<ReadonlyArray<Grant>>;
}

export interface OwnerRowReport {
  /** Owner rows revoked, with the resource they were on and the account they named. */
  readonly revoked: ReadonlyArray<{ readonly id: string; readonly accountId: string }>;
  /** Rows whose revoke failed; retried at the next boot. */
  readonly failures: ReadonlyArray<{ readonly id: string; readonly error: string }>;
}

export interface OwnerRowDeps {
  readonly grantStore: OwnerRowReads;
  readonly grants: Pick<GrantPathClient, "delete">;
}

/** A kind the reconcile covers, and how its log lines name it. */
export interface OwnerRowKind {
  readonly kind: ApiResourceKind;
  /** The log lines' subject, `federation-issuer owner row revoked; ...`. */
  readonly key: string;
  /** The log field carrying the resource id. */
  readonly idField: string;
}

/** Revokes every direct owner row on `kind`. A failed read throws; a failed revoke is reported. */
export async function revokeOwnerRows(
  kind: ApiResourceKind,
  deps: OwnerRowDeps,
): Promise<OwnerRowReport> {
  const rows = await deps.grantStore.findByResourceKindAndRelation(
    ApiResourceKind[kind],
    OWNER,
  );
  const revoked: Array<OwnerRowReport["revoked"][number]> = [];
  const failures: Array<OwnerRowReport["failures"][number]> = [];
  for (const row of rows) {
    const spec = row.spec;
    if (spec === undefined) {
      continue;
    }
    const id = spec.resource?.id ?? "";
    try {
      await deps.grants.delete(spec);
      revoked.push({ id, accountId: spec.principal?.id ?? "" });
    } catch (error) {
      failures.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { revoked, failures };
}

/** The boot reconcile over `kinds`, in order, logged row by row; never throws. */
export async function reconcileOwnerRows(
  kinds: ReadonlyArray<OwnerRowKind>,
  deps: OwnerRowDeps & { readonly logger: Logger },
): Promise<void> {
  for (const { kind, key, idField } of kinds) {
    try {
      const report = await revokeOwnerRows(kind, deps);
      for (const row of report.revoked) {
        deps.logger.info(`${key} owner row revoked; its organization's admins manage it`, {
          [idField]: row.id,
          account: row.accountId,
        });
      }
      for (const failure of report.failures) {
        deps.logger.error(`${key} owner row could not be revoked`, {
          [idField]: failure.id,
          error: failure.error,
        });
      }
    } catch (error) {
      deps.logger.error(`${key} owner-row reconcile failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
