/**
 * The organization-link reconcile: at every boot, every row of an
 * organization-scoped kind this edition keeps in its own table gets back
 * the one tuple its management hangs off,
 * `<kind>:<id>#organization@organization:<org>`, when that tuple's policy
 * row is missing. Kind-agnostic: the identity unit wires it for identity
 * providers, invitations and teams, and a host may wire it for kinds of its
 * own that carry the link.
 *
 * Why the organization link alone: the first three kinds are managed by
 * their organization's current admins and by nobody else
 * (`federation_issuer.fga`, `invitation.fga`, `team.fga`; the kinds record
 * no owner), and a service account's admins reach it and its keys through
 * it (`identity_account.fga`; its self-owner row is its own), so the link
 * is all a row needs to stay manageable. The owner rows an older server wrote are the
 * owner-row reconcile's to revoke (owner-rows.ts), never this one's to
 * write. The holes it repairs are
 * real: providers created before the create handler wrote any tuple, and
 * any row whose creation event failed after the row was written (the
 * lifecycle contract every create chain follows answers INTERNAL with the
 * row in place).
 *
 * The check is the exact triple, read from the row's policies as
 * resource (`findByResource`), never "any structural row": a lookup
 * satisfied by another structural row would skip the hole it exists for,
 * a row with no organization link at all.
 *
 * It never resurrects. A row names its organization by id, and the delete
 * revokes every link naming it. An organization made since ids were minted
 * has an id no later organization carries; before that an organization's
 * id was its slug, which, before stigmer v3.39.0, a later organization
 * could take again, and rows from then remain. A row whose link is missing
 * because its organization is gone, or because its organization was
 * created after the row, is reported and left alone: re-linking it would
 * hand a stranger's row to whoever holds that organization now. An organization with no recorded creation time
 * predates the TypeScript server (every organization it creates carries
 * one), so it cannot be a re-creation, and it is linked. A row with no
 * creation time cannot be told apart, and is reported.
 *
 * Posture: the tuple backfill's. The write goes through the grant path's
 * structural lane (`bootstrapGrant`), which is safe to repeat; one row's
 * failure is reported and the rest continue; the caller logs and boot
 * proceeds. Two replicas booting together may both write one link; the
 * grant path writes one row. A row deleted by another replica between the
 * read and the write leaves a link naming a row that no longer exists,
 * which grants nobody anything.
 *
 * The same rule answers a second question, so it lives here once:
 * `orphanReason` is also what the invitation lane asks before a
 * redemption and in its preview, because a link that outlived its
 * organization would otherwise open whichever organization took the slug
 * next (invitation/handlers.ts); and what the federated verifier's index
 * asks of a federation issuer, because a provider that outlived its
 * organization would otherwise sign people into it (federation/verifier.ts). The lookup therefore
 * answers the few facts its callers read from one organization read: its
 * creation time, and the name, slug and logo the invitation preview shows.
 */
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import type { GrantStore } from "@stigmer/server";
import { rethrownStatusError } from "@stigmer/server";

import type { TransportRef } from "../rpc/transport-ref.js";
import type { GrantPathClient } from "./grant/grant-path-client.js";

/** The relation a row's organization link is written on, and the principal kind it names. */
const ORGANIZATION = "organization";

/**
 * A row of an organization-scoped kind: its id, its organization and its
 * creation time. Only the audit is read from the status, so any kind's
 * status message fits (an invitation's carries its token and ledger too).
 */
export interface OrganizationScopedRow {
  readonly metadata?: ApiResourceMetadata;
  readonly status?: { readonly audit?: ApiResourceAudit };
}

/** What the IAM lanes read about an organization, from one read of it. */
export interface OrganizationFacts {
  /** Undefined when the organization predates recorded creation times. */
  readonly createdAt: Date | undefined;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string;
  /** The organization's parent (`spec.parent_org`); "" for one with no parent. */
  readonly parentOrg: string;
}

export interface OrganizationLookup {
  /** The organization's facts, or undefined when no organization holds the id. */
  find(orgId: string): Promise<OrganizationFacts | undefined>;
}

/** Why a row without its link was left alone. */
export type OrphanReason =
  | "row-has-no-organization"
  | "organization-gone"
  | "organization-recreated"
  | "row-has-no-creation-time";

export interface OrganizationLinkReport {
  /** Links written. */
  readonly converged: number;
  /** Rows missing their link that were deliberately not linked. */
  readonly orphaned: ReadonlyArray<{
    readonly id: string;
    readonly org: string;
    readonly reason: OrphanReason;
  }>;
  /** Rows whose check or write failed; retried at the next boot. */
  readonly failures: ReadonlyArray<{ readonly id: string; readonly error: string }>;
}

export interface OrganizationLinkDeps {
  readonly grantStore: Pick<GrantStore, "findByResource">;
  readonly grants: Pick<GrantPathClient, "bootstrapGrant">;
  readonly organizations: OrganizationLookup;
}

/** Restores every missing organization link among `rows`, which are all of `kind`. */
export async function reconcileOrganizationLinks(
  kind: ApiResourceKind,
  rows: ReadonlyArray<OrganizationScopedRow>,
  deps: OrganizationLinkDeps,
): Promise<OrganizationLinkReport> {
  const kindName = ApiResourceKind[kind];
  const organizations = new Map<string, Promise<OrganizationFacts | undefined>>();
  const factsOf = (orgId: string): Promise<OrganizationFacts | undefined> => {
    let facts = organizations.get(orgId);
    if (facts === undefined) {
      facts = deps.organizations.find(orgId);
      organizations.set(orgId, facts);
    }
    return facts;
  };

  let converged = 0;
  const orphaned: Array<OrganizationLinkReport["orphaned"][number]> = [];
  const failures: Array<OrganizationLinkReport["failures"][number]> = [];
  for (const row of rows) {
    const id = row.metadata?.id ?? "";
    const org = row.metadata?.org ?? "";
    try {
      if (org === "") {
        orphaned.push({ id, org, reason: "row-has-no-organization" });
        continue;
      }
      if (await hasOrganizationLink(deps.grantStore, kindName, id, org)) {
        continue;
      }
      const reason = orphanReason(row, await factsOf(org));
      if (reason !== undefined) {
        orphaned.push({ id, org, reason });
        continue;
      }
      await deps.grants.bootstrapGrant(
        create(GrantSpecSchema, {
          principal: create(ApiResourceRefSchema, { kind: ORGANIZATION, id: org }),
          relation: ORGANIZATION,
          resource: create(ApiResourceRefSchema, { kind: kindName, id }),
        }),
      );
      converged += 1;
    } catch (error) {
      failures.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { converged, orphaned, failures };
}

/**
 * The organizations the in-process transport serves, asked as the server
 * acting as itself (no caller header rides the call, so the in-process
 * interceptor stamps the `internal` class, which Authorize skips; the
 * grant-path client's idiom). The transport is wired after compose, so
 * the lookup is only usable once the host has wired it.
 */
export function newInProcessOrganizationLookup(transportRef: TransportRef): OrganizationLookup {
  return {
    async find(orgId): Promise<OrganizationFacts | undefined> {
      const transport = transportRef.transport;
      if (transport === undefined) {
        throw new Error("organization lookup used before the in-process transport was wired");
      }
      try {
        const organization = await createClient(OrganizationQueryController, transport).get(
          create(OrganizationIdSchema, { value: orgId }),
        );
        const createdAt = organization.status?.audit?.specAudit?.createdAt;
        return {
          createdAt: createdAt === undefined ? undefined : timestampDate(createdAt),
          name: organization.metadata?.name ?? "",
          slug: organization.metadata?.slug ?? "",
          logoUrl: organization.spec?.logoUrl ?? "",
          parentOrg: organization.spec?.parentOrg ?? "",
        };
      } catch (error) {
        const refusal = ConnectError.from(error);
        if (refusal.code === Code.NotFound) {
          return undefined;
        }
        // A fresh error: the received one carries the inner response's
        // metadata, which corrupts a serving handler's framing.
        throw rethrownStatusError(refusal);
      }
    },
  };
}

async function hasOrganizationLink(
  grantStore: Pick<GrantStore, "findByResource">,
  kindName: string,
  id: string,
  org: string,
): Promise<boolean> {
  const grants = await grantStore.findByResource(kindName, id);
  return grants.some(
    (grant) =>
      grant.spec?.relation === ORGANIZATION &&
      grant.spec.principal?.kind === ORGANIZATION &&
      grant.spec.principal.id === org &&
      grant.spec.principal.relation === "",
  );
}

/**
 * Undefined when the row still belongs to the organization it names;
 * otherwise why it does not: the organization is gone, or was created
 * after the row (its slug was taken again, which only a delete before
 * stigmer v3.39.0 allowed), or the row carries no creation time to
 * compare.
 */
export function orphanReason(
  row: OrganizationScopedRow,
  organization: OrganizationFacts | undefined,
): OrphanReason | undefined {
  if (organization === undefined) {
    return "organization-gone";
  }
  const rowCreatedAt = row.status?.audit?.specAudit?.createdAt;
  if (rowCreatedAt === undefined) {
    return "row-has-no-creation-time";
  }
  if (
    organization.createdAt !== undefined &&
    organization.createdAt.getTime() > timestampDate(rowCreatedAt).getTime()
  ) {
    return "organization-recreated";
  }
  return undefined;
}
