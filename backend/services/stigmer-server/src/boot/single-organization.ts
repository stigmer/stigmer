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
 *     no person and the membership rules decide the owner of the
 *     organization recorded under SINGLE_ORG_KEY (iampolicy/membership.ts).
 *
 * After the create the store is read again, and that read settles the
 * holder and the SINGLE_ORG_KEY record, not the create's answer. The record
 * names whichever organization the store holds alone, whoever made it, so
 * an upgraded store's organization is the server's as much as one this
 * step made, and a start that died before recording heals. Two replicas
 * racing on an empty store end with one organization (the duplicate check,
 * the limit or the slug claim refuses the loser, and its refusal is the lost
 * race; the loser re-reads for about a second, since it can read the store
 * between the winner's slug claim and its row), and a store from before
 * this step may hold several. Exactly one turns the fill on; any other
 * count leaves it off for the process, clears the record and any owed
 * roles pass, and logs one
 * warning: the count when it holds several, the cause when it holds none.
 *
 * On an empty store, before the create, the step marks the membership
 * rules' pass over the server's organization as owed
 * (SERVER_ORGANIZATION_ROLES_OWED, domain/iampolicy/constants.ts): the
 * people that store already held get their roles on the organization made
 * for them, and no other store's people do.
 *
 * A failure is a boot throw: a server composed to hold one organization
 * cannot serve without it, and the port stays closed. One failure is not
 * fatal: a store from an earlier release whose `stigmer` was deleted keeps
 * that slug reserved for good (it was that organization's id, and what it
 * left behind still names it: domain/organization/names.ts), so the create
 * is refused with ORGANIZATION_SLUG_RESERVED. That start warns, fills
 * nothing and boots, and a person creates an organization to start.
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
  ORGANIZATION_LIMIT_REACHED,
  SINGLE_ORGANIZATION_SLUG,
  SINGLE_ORG_KEY,
} from "../domain/organization/limit.js";
import { ORGANIZATION_SLUG_RESERVED } from "../domain/organization/names.js";
import {
  SERVER_ORGANIZATION_ROLES_KEY,
  SERVER_ORGANIZATION_ROLES_OWED,
} from "../domain/iampolicy/constants.js";
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
  const empty =
    (await store.listResources(ApiResourceKind.organization)).length === 0;
  if (
    empty &&
    (await store.bootstrapState.get(SERVER_ORGANIZATION_ROLES_KEY)) === ""
  ) {
    // Before the create, so a start that dies after it still owes the
    // people this store already held their roles (iampolicy/constants.ts).
    await store.bootstrapState.set(
      SERVER_ORGANIZATION_ROLES_KEY,
      SERVER_ORGANIZATION_ROLES_OWED,
    );
  }
  const outcome: CreateOutcome = empty
    ? await createSingleOrganization(deps)
    : "present";
  let ids = await organizationIds(store);
  // A replica that lost the race can read the store after the winner
  // claimed the slug and before it stored the row: it waits a moment for
  // the row rather than boot a whole process without the fill.
  for (
    let attempt = 0;
    outcome === "lost" && ids.length === 0 && attempt < LOST_RACE_READS;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, LOST_RACE_READ_MS));
    ids = await organizationIds(store);
  }
  const [only, ...others] = ids;
  if (only !== undefined && only !== "" && others.length === 0) {
    // The server's organization, recorded from the store's own answer.
    if ((await store.bootstrapState.get(SINGLE_ORG_KEY)) !== only) {
      await store.bootstrapState.set(SINGLE_ORG_KEY, only);
    }
    deps.holder.settle(only);
    logger.info("single organization ensured", { org: only });
    return;
  }
  deps.holder.settle(undefined);
  // The fill is off, so no organization is the server's: a record left by
  // an earlier start must not keep the owner arms on one of several, and a
  // pass marked owed before a create that made nothing is owed to no
  // organization (one a person makes later in the console owes nobody a
  // role, and a role revoked there must stay revoked).
  if ((await store.bootstrapState.get(SINGLE_ORG_KEY)) !== "") {
    await store.bootstrapState.delete(SINGLE_ORG_KEY);
  }
  if (
    (await store.bootstrapState.get(SERVER_ORGANIZATION_ROLES_KEY)) ===
    SERVER_ORGANIZATION_ROLES_OWED
  ) {
    await store.bootstrapState.delete(SERVER_ORGANIZATION_ROLES_KEY);
  }
  if (others.length > 0) {
    logger.warn(
      "this server holds one organization, but its store holds several: requests must name their organization, and no organization can be added",
      { organizations: others.length + 1 },
    );
  } else if (outcome === "reserved") {
    logger.warn(
      `this server cannot make its organization: the slug '${SINGLE_ORGANIZATION_SLUG}' is reserved for an organization an earlier release made and deleted; create an organization to start`,
      { slug: SINGLE_ORGANIZATION_SLUG },
    );
  } else if (outcome === "lost") {
    // Refused as a duplicate, yet nothing holds the slug's row: a name left
    // by an interrupted create, which a claim frees once it is a minute old
    // (domain/organization/names.ts), so the next start makes it.
    logger.warn(
      `this server cannot make its organization: its create was refused as a duplicate, but the store holds none; create an organization to start`,
      { slug: SINGLE_ORGANIZATION_SLUG },
    );
  }
}

/** How many times, and how far apart, a replica that lost the race re-reads the store for the winner's row: about a second in all. */
const LOST_RACE_READS = 10;
const LOST_RACE_READ_MS = 100;

async function organizationIds(store: Store): Promise<string[]> {
  return (await store.listResources(ApiResourceKind.organization)).map(
    (bytes) => fromBinary(OrganizationSchema, bytes).metadata?.id ?? "",
  );
}

/**
 * What the create did: made the organization; lost it to another replica
 * (refused as a duplicate or at the limit, whose row the store read finds);
 * found the slug reserved for an earlier release's deleted organization,
 * which no later start can take. "present":
 * the store already held one, so nothing was created.
 */
type CreateOutcome = "made" | "lost" | "reserved" | "present";

async function createSingleOrganization(
  deps: SingleOrganizationBootDeps,
): Promise<CreateOutcome> {
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
    return "made";
  } catch (error) {
    if (error instanceof ConnectError) {
      const reasons = error
        .findDetails(ErrorInfoSchema)
        .map((info) => info.reason);
      if (error.code === Code.AlreadyExists && reasons.includes(ORGANIZATION_SLUG_RESERVED)) {
        return "reserved";
      }
      // Another replica made it first. Its row reached this create either at
      // the duplicate check (AlreadyExists) or, persisted a moment later, at
      // the limit (ORGANIZATION_LIMIT_REACHED); the store read that follows
      // finds it either way.
      if (
        error.code === Code.AlreadyExists ||
        (error.code === Code.FailedPrecondition &&
          reasons.includes(ORGANIZATION_LIMIT_REACHED))
      ) {
        return "lost";
      }
    }
    throw new Error(
      `cannot make this server's organization: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
