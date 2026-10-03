/**
 * The boot step of a composition that declares one organization
 * (`ServerExtension.orgLimit: 1`, the open-source edition): make the
 * organization when the store holds none, then settle which organization
 * the serving chain fills (pipeline/interceptors/single-organization.ts)
 * and `getServerInfo` reports.
 *
 * It runs in `start()`, after the units' own start hooks and before
 * Temporal, the search index rebuild and the port, so the organization
 * exists before any background work reads the store and before any request
 * can arrive. It runs on every boot: "none in the store" is its own
 * idempotency, and a store that already holds one or more is left alone.
 *
 * The organization is made through its in-process edge
 * (`singleOrganizationCreator`, boot/inprocess.ts), so the whole create chain
 * runs (the limit, the slug claim, the role lifecycle, the search entry), as
 * the caller compose.ts passes:
 *
 *   - trusted-local: the operator's account (`accountAsCaller`), so the
 *     role lifecycle makes the operator `owner` at create and the stamp
 *     names them — on first boot the operator-ownership ensure has
 *     already run, before the organization existed;
 *   - sign-in: the server acting as nobody
 *     (`serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID)`), so the stamp names
 *     no person and the membership rules decide the owner from the
 *     recorded SINGLE_ORG_KEY (iampolicy/membership.ts).
 *
 * After the create the store is read again, and that read settles the
 * holder and the SINGLE_ORG_KEY record, not the create's answer: two replicas racing on an empty store
 * end with one organization (the slug claim admits one; the other's
 * AlreadyExists is the lost race), and a store from before this step may
 * hold several. Exactly one turns the fill on; any other count leaves it
 * off for the process, with one warning naming the count.
 *
 * One failure is not fatal. A store whose ledger retired the slug and that
 * holds no organization (a laptop that deleted it before the server made
 * its own) cannot get it back: the step warns, the fill stays off, and the
 * console's onboarding lets the person make one under another slug, which
 * the next boot fills. Every other failure is a boot throw: a server
 * composed to hold one organization cannot serve without it, and the port
 * stays closed.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";

import type { Logger } from "./logger.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type { SingleOrganizationHolder } from "../pipeline/interceptors/single-organization.js";
import {
  SINGLE_ORGANIZATION_SLUG,
  SINGLE_ORG_KEY,
} from "../domain/organization/limit.js";
import { ORGANIZATION_SLUG_RESERVED } from "../domain/organization/slug-ledger.js";
import type { Store } from "../store/interface.js";

/** The in-process edge that makes the organization: the whole create chain, as the given caller. */
export interface SingleOrganizationCreator {
  createAsCaller(
    organization: Organization,
    caller: CallerIdentity,
  ): Promise<Organization>;
}

export interface SingleOrganizationBootDeps {
  readonly store: Store;
  readonly creator: SingleOrganizationCreator;
  /** Who makes the organization (see the module header for each posture). */
  readonly caller: CallerIdentity;
  readonly holder: SingleOrganizationHolder;
  readonly logger: Logger;
}

export async function ensureSingleOrganization(
  deps: SingleOrganizationBootDeps,
): Promise<void> {
  const { store, logger } = deps;
  const made =
    (await store.listResources(ApiResourceKind.organization)).length === 0 &&
    (await createSingleOrganization(deps));
  const [only, ...others] = (
    await store.listResources(ApiResourceKind.organization)
  ).map((bytes) => fromBinary(OrganizationSchema, bytes).metadata?.id ?? "");
  if (only !== undefined && only !== "" && others.length === 0) {
    // Recorded from the store's own answer, and only by the start that made
    // it: a replica that lost the race leaves the record to the winner.
    if (made) {
      await store.bootstrapState.set(SINGLE_ORG_KEY, only);
    }
    deps.holder.settle(only);
    logger.info("single organization ensured", { org: only });
    return;
  }
  deps.holder.settle(undefined);
  if (others.length > 0) {
    logger.warn(
      "this server holds one organization, but its store holds several: requests must name their organization, and no organization can be added",
      { organizations: others.length + 1 },
    );
  }
}

/** Resolves true when this start made the organization, false when the store already had it or cannot. */
async function createSingleOrganization(
  deps: SingleOrganizationBootDeps,
): Promise<boolean> {
  try {
    await deps.creator.createAsCaller(
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "Stigmer", slug: SINGLE_ORGANIZATION_SLUG },
        spec: {
          description: "The organization this server holds",
          managementMode: ManagementMode.self_managed,
        },
      }),
      deps.caller,
    );
    return true;
  } catch (error) {
    if (!(error instanceof ConnectError) || error.code !== Code.AlreadyExists) {
      throw new Error(
        `cannot make this server's organization: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const reserved = error
      .findDetails(ErrorInfoSchema)
      .some((info) => info.reason === ORGANIZATION_SLUG_RESERVED);
    if (reserved) {
      deps.logger.warn(
        `this server cannot make its organization: the slug '${SINGLE_ORGANIZATION_SLUG}' belonged to a deleted organization, and a slug is never reused; create an organization to start`,
        { slug: SINGLE_ORGANIZATION_SLUG },
      );
    }
    // Otherwise another replica made it first: the store read that follows
    // finds it.
    return false;
  }
}
