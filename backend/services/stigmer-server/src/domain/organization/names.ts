/**
 * The organization domain's use of the resource-name table (the Store's
 * `resourceNames`; store/interface.ts states its guarantees): an
 * organization is filed under its minted id, and its slug is a name it
 * answers to, unique across the server.
 *
 * Every resource an organization owns names it by id (`metadata.org`), so
 * a name can change and can be let go without anything moving. That is
 * what this module does with names:
 *
 *   - the create claims the slug immediately before Persist
 *     (ClaimOrganizationSlug), after the pre-side-effect gate slot, so a
 *     gate's refusal still leaves nothing written; of two concurrent
 *     creates of one slug exactly one claim wins, which the row alone
 *     cannot give because `saveResource` upserts. A create that fails after
 *     its claim and before its row is stored releases the claim;
 *   - a rename moves the current name and leaves the old one resolving to
 *     the organization for RENAMED_SLUG_HOLD_MS, then free
 *     (RenameOrganizationSlug); an organization made before ids were minted
 *     keeps its old name for good, because that name is its id and every
 *     row it owns carries it;
 *   - the delete releases every name the organization holds, after its row
 *     is gone (RetireOrganizationSlug), so a later organization may take
 *     the slug and sees nothing the deleted one owned. A name equal to the
 *     organization's id is the exception: an organization made before ids
 *     were minted was filed under it, its leftovers still carry it, so the
 *     store keeps it reserved after the delete, as v8/v13 keep the slugs
 *     the old ledger had retired.
 *
 * A name whose organization is gone is free, unless it equals that id. Interrupted sequences leave
 * such names behind (a delete whose release failed, a create whose release
 * failed), and a claim that meets one lets it go and claims again. A claim
 * younger than ABANDONED_NAME_AFTER_MS is never treated so, because a create
 * holds its claim before its row exists.
 *
 * The refusal says why. A slug another organization holds as its current
 * name keeps the existing duplicate copy; one it holds as a recent previous
 * name answers AlreadyExists carrying ORGANIZATION_SLUG_RESERVED (the
 * create and rename contracts document it). Both keep the AlreadyExists
 * code, which the personal-organization retry keys on.
 *
 * Proven by __tests__/organization-names.test.ts, the store contract and
 * the organization conformance suites.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameKey,
  Store,
} from "../../store/interface.js";
import {
  alreadyExistsError,
  alreadyExistsWithReasonError,
  internalError,
} from "../../pipeline/errors.js";
import type { OrganizationNameResolver } from "../../pipeline/interceptors/organization-names.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/**
 * The ErrorInfo reason a create or rename carries when the slug is another
 * organization's recent previous name, which still resolves to it. Wire
 * contract, documented on OrganizationCommandController.create; metadata
 * `slug`.
 */
export const ORGANIZATION_SLUG_RESERVED = "ORGANIZATION_SLUG_RESERVED";

/** How long a renamed organization's old slug keeps resolving to it: 30 days. */
export const RENAMED_SLUG_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How old a name must be before a holder with no organization row counts as
 * gone: a create claims its name a step before its row is stored, so a
 * younger claim may be a create in flight.
 */
export const ABANDONED_NAME_AFTER_MS = 60 * 1000;

/** The `kind` an organization's names are filed under (the resources table's kind column). */
export const ORGANIZATION_NAME_KIND = ApiResourceKind[ApiResourceKind.organization];

/** Where ClaimOrganizationSlug leaves the entry it won, for the release after a failure. */
const CLAIMED_NAME_KEY = "organizationNameClaim";

/** An organization's slug as a key in the name table: unique across the server. */
export function organizationNameKey(slug: string): ResourceNameKey {
  return { kind: ORGANIZATION_NAME_KIND, org: "", name: slug };
}

/** The copy of a refusal for another organization's recent previous name. */
export function organizationSlugReservedMessage(slug: string): string {
  return `Organization slug '${slug}' was recently another organization's, and still leads to it`;
}

/** The copy of a refusal for a name an earlier release filed an organization under. */
export function organizationIdReservedMessage(slug: string): string {
  return `Organization slug '${slug}' is reserved: an organization from an earlier release was filed under it`;
}

/**
 * The refusal for a slug an entry already holds: the reserved refusal for a
 * previous name, the existing duplicate copy for a current one.
 */
export function refusalForHeldName(entry: ResourceNameEntry): ConnectError {
  if (entry.state === "previous") {
    return alreadyExistsWithReasonError(
      entry.name === entry.id
        ? organizationIdReservedMessage(entry.name)
        : organizationSlugReservedMessage(entry.name),
      { reason: ORGANIZATION_SLUG_RESERVED, metadata: { slug: entry.name } },
    );
  }
  return alreadyExistsError("Organization", `slug '${entry.name}'`);
}

/**
 * Whether the organization a name points at is gone: no row holds its id,
 * and the name is older than ABANDONED_NAME_AFTER_MS. A name equal to its
 * id never counts as gone: it is reserved for good (the module header).
 */
export async function nameHolderIsGone(
  store: Store,
  entry: ResourceNameEntry,
  now: Date,
): Promise<boolean> {
  if (entry.name === entry.id) {
    return false;
  }
  if (now.getTime() - Date.parse(entry.claimedAt) < ABANDONED_NAME_AFTER_MS) {
    return false;
  }
  try {
    await store.getResource(
      ApiResourceKind.organization,
      entry.id,
      OrganizationSchema,
    );
    return false;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return true;
    }
    throw error;
  }
}

/**
 * The slug's live entry, or undefined when it is free: nothing holds it,
 * or what holds it belongs to an organization that is gone.
 */
export async function liveOrganizationName(
  store: Store,
  slug: string,
  now: Date,
): Promise<ResourceNameEntry | undefined> {
  const entry = await store.resourceNames.resolve(
    organizationNameKey(slug),
    now.toISOString(),
  );
  if (entry === undefined || (await nameHolderIsGone(store, entry, now))) {
    return undefined;
  }
  return entry;
}

/**
 * Claims the new organization's slug for its minted id, immediately before
 * Persist. A claim lost to an organization that is gone lets that holder's
 * names go and claims once more; a claim lost to a live one is refused by
 * the entry that holds the slug. A won claim is left in the request for
 * releaseSlugClaimAfterFailure.
 */
export function newClaimOrganizationSlugStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "ClaimOrganizationSlug",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      const slug = metadata?.slug ?? "";
      const id = metadata?.id ?? "";
      // ResolveSlug and BuildNewState run first, so an empty slug or id
      // here is a server-side ordering bug, not bad client input.
      if (slug === "" || id === "") {
        throw internalError(
          new Error("organization slug or id is empty"),
          "failed to claim the organization slug",
        );
      }
      let claim;
      try {
        claim = await claimFreeingGoneHolder(store, slug, id, new Date());
      } catch (error) {
        throw internalError(error, "failed to claim the organization slug");
      }
      if (!claim.claimed) {
        throw refusalForHeldName(claim.entry);
      }
      ctx.set(CLAIMED_NAME_KEY, claim.entry);
    },
  };
}

async function claimFreeingGoneHolder(
  store: Store,
  slug: string,
  id: string,
  now: Date,
) {
  const key = organizationNameKey(slug);
  const claim = await store.resourceNames.claim(key, id, now.toISOString());
  if (claim.claimed || !(await nameHolderIsGone(store, claim.entry, now))) {
    return claim;
  }
  await store.resourceNames.release(key.kind, key.org, claim.entry.id);
  return store.resourceNames.claim(key, id, now.toISOString());
}

/**
 * Frees the name a failed create claimed, when its organization was never
 * stored, so the caller's retry can take the slug again. Called by the
 * create around its chain, as send-signal.ts releases a dedupe claim.
 *
 * Whether the row exists decides, rather than which step failed: a Persist
 * that stored the row and then failed keeps the claim, as it must, because
 * the organization exists. A fault here is logged and leaves the name
 * pointing at an id no organization holds; the next claim of the slug
 * frees it once it is ABANDONED_NAME_AFTER_MS old.
 */
export async function releaseSlugClaimAfterFailure(
  store: Store,
  logger: Logger,
  ctx: RequestContext<typeof OrganizationSchema>,
): Promise<void> {
  const entry = ctx.get(CLAIMED_NAME_KEY) as ResourceNameEntry | undefined;
  if (entry === undefined) {
    return;
  }
  try {
    await store.getResource(
      ApiResourceKind.organization,
      entry.id,
      OrganizationSchema,
    );
    return; // stored: the organization exists and keeps its name
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      logger.error(
        "organization create failed and its slug claim could not be checked; the slug stays claimed",
        {
          slug: entry.name,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
  }
  try {
    await store.resourceNames.release(entry.kind, entry.org, entry.id);
  } catch (error) {
    logger.error(
      "organization create failed and its slug claim could not be released; the slug stays claimed",
      {
        slug: entry.name,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Releases every name the deleted organization held, after its row is
 * gone, so a later organization may take its slug. Best-effort, like the
 * delete's other post-row steps: the organization is already deleted, so a
 * fault is logged and the names are freed by the next claim that meets
 * them (nameHolderIsGone). Releasing before the row instead would leave a
 * delete that fails later with a live organization whose name anyone could
 * take.
 */
export function newRetireOrganizationSlugStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "RetireOrganizationSlug",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error(
            "organization delete reached RetireOrganizationSlug without its loaded row",
          ),
          "failed to release the organization slug",
        );
      }
      try {
        await store.resourceNames.release(ORGANIZATION_NAME_KIND, "", id);
      } catch (error) {
        logger.error(
          "organization deleted but its names could not be released; a later claim frees them",
          {
            org: id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

/**
 * The serving chain's organization-name resolver over the store
 * (pipeline/interceptors/organization-names.ts): an organization's current
 * slug, or a previous one that has not expired, resolves to its id.
 */
export function newOrganizationNameResolver(
  store: Store,
): OrganizationNameResolver {
  return {
    async resolve(name: string): Promise<string | undefined> {
      const entry = await store.resourceNames.resolve(
        organizationNameKey(name),
        new Date().toISOString(),
      );
      return entry?.id;
    },
  };
}

/**
 * Brings an organization's row to the name the table holds as its current
 * one. The names move under their own lock and the row is written after,
 * so overlapping renames, or an update that copied the slug it loaded, can
 * land the row with a name the table has already moved past. Each write is
 * therefore followed by this: read the current name, and write the row
 * again with it while they differ. The last writer always settles, so the
 * row converges on the table. Best-effort: a fault is logged, and the next
 * write settles it.
 */
export async function settleOrganizationSlug(
  store: Store,
  organization: Organization,
  logger: Logger,
): Promise<void> {
  const metadata = organization.metadata;
  if (metadata === undefined || metadata.id === "") {
    return;
  }
  try {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const current = await store.resourceNames.current(ORGANIZATION_NAME_KIND, "", metadata.id);
      if (current === undefined || current.name === metadata.slug) {
        return;
      }
      metadata.slug = current.name;
      await store.saveResource(ApiResourceKind.organization, metadata.id, OrganizationSchema, organization);
    }
  } catch (error) {
    logger.warn("organization row left behind its current name; the next write settles it", {
      org: metadata.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** How many rewrites a settle makes before leaving the rest to the next write. */
const SETTLE_ATTEMPTS = 3;

/** SettleOrganizationSlug: after an update's Persist (settleOrganizationSlug). */
export function newSettleOrganizationSlugStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "SettleOrganizationSlug",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      await settleOrganizationSlug(store, ctx.newState, logger);
    },
  };
}

/**
 * How copy a person reads names an organization: its current slug, or the
 * value as given when nothing holds a current name for it. For an
 * organization the reader acts in (their own), never for another
 * organization's id, which a refusal must not map to its name.
 */
export async function organizationSlugOf(store: Store, org: string): Promise<string> {
  return (await store.resourceNames.current(ORGANIZATION_NAME_KIND, "", org))?.name ?? org;
}
