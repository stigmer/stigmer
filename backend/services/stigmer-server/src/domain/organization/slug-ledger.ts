/**
 * The organization domain's use of the slug ledger (the Store's
 * `organizationSlugs`; store/interface.ts states its guarantees): an
 * organization's slug is its for good.
 *
 * An organization's id is its slug, and the delete removes the row. Rows
 * that name the organization can outlive it (every organization-scoped
 * resource names it in `metadata.org`, and an edition may keep its own rows
 * by the id), so a slug taken again would hand them all to the new holder.
 * The ledger closes that: the create claims the slug atomically, the delete
 * retires it, and nothing ever frees a retired slug.
 *
 * The create touches the ledger twice. CheckDuplicate reads it first, so a
 * taken slug is refused before any gate runs (steps.ts). ClaimOrganizationSlug
 * then claims it immediately before Persist, after the pre-side-effect gate
 * slot, so a gate's refusal still leaves nothing written; of two concurrent
 * creates of one slug, exactly one claim wins, which the row alone cannot
 * give because `saveResource` upserts. A create that fails after its claim
 * and before its row is stored releases the claim, so the caller's retry
 * can take the slug again; a create that fails after the row keeps it,
 * because the organization exists.
 *
 * The refusal says why. A retired slug answers AlreadyExists carrying the
 * ORGANIZATION_SLUG_RESERVED reason (the organization create's contract
 * documents it), so the CLI and the console can tell a person the slug
 * belonged to a deleted organization. A held slug keeps the existing copy
 * with no reason: it covers a live organization and also a create between
 * its claim and its row, which must never read as "deleted". Both keep the
 * AlreadyExists code, which the personal-organization retry keys on.
 *
 * Proven by __tests__/organization-slugs.test.ts and the organization
 * conformance suite.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { OrganizationSlugEntry, Store } from "../../store/interface.js";
import {
  alreadyExistsError,
  alreadyExistsWithReasonError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/**
 * The ErrorInfo reason a create of a retired slug carries: a deleted
 * organization held the slug, and a slug is never reused. Wire contract,
 * documented on OrganizationCommandController.create; metadata `slug`.
 */
export const ORGANIZATION_SLUG_RESERVED = "ORGANIZATION_SLUG_RESERVED";

/** Where ClaimOrganizationSlug leaves the entry it won, for the release after a failure. */
const CLAIMED_SLUG_KEY = "organizationSlugClaim";

/** The copy of a retired slug's refusal. */
export function organizationSlugReservedMessage(slug: string): string {
  return `Organization slug '${slug}' belonged to an organization that was deleted, and a slug is never reused`;
}

/**
 * The refusal for a slug an entry already holds: the reserved refusal for a
 * retired entry, the existing duplicate copy for one still held.
 */
export function refusalForHeldSlug(entry: OrganizationSlugEntry): ConnectError {
  if (entry.retiredAt !== "") {
    return alreadyExistsWithReasonError(
      organizationSlugReservedMessage(entry.slug),
      { reason: ORGANIZATION_SLUG_RESERVED, metadata: { slug: entry.slug } },
    );
  }
  return alreadyExistsError("Organization", `slug '${entry.slug}'`);
}

/**
 * Claims the new organization's slug, immediately before Persist. A lost
 * claim is refused by the entry that holds the slug; a won claim is left in
 * the request for releaseSlugClaimAfterFailure.
 */
export function newClaimOrganizationSlugStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "ClaimOrganizationSlug",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const slug = metadataOf(ctx.newState)?.slug ?? "";
      // ResolveSlug and CheckDuplicate run first, so an empty slug here is
      // a server-side ordering bug, not bad client input.
      if (slug === "") {
        throw internalError(
          new Error("organization slug is empty"),
          "failed to claim the organization slug",
        );
      }
      let claim;
      try {
        claim = await store.organizationSlugs.claim(slug);
      } catch (error) {
        throw internalError(error, "failed to claim the organization slug");
      }
      if (!claim.claimed) {
        throw refusalForHeldSlug(claim.entry);
      }
      ctx.set(CLAIMED_SLUG_KEY, claim.entry);
    },
  };
}

/**
 * Frees the slug a failed create claimed, when its organization was never
 * stored, so the caller's retry can take the slug again. Called by the
 * create around its chain, as send-signal.ts releases a dedupe claim.
 *
 * Whether the row exists decides, rather than which step failed: a Persist
 * that stored the row and then failed keeps the claim, as it must, because
 * the organization exists. Any fault here is logged and leaves the slug
 * claimed with no organization, which nothing can then take; that is a
 * hand's to resolve, and far rarer than the failure it follows.
 */
export async function releaseSlugClaimAfterFailure(
  store: Store,
  logger: Logger,
  ctx: RequestContext<typeof OrganizationSchema>,
): Promise<void> {
  const entry = ctx.get(CLAIMED_SLUG_KEY) as OrganizationSlugEntry | undefined;
  if (entry === undefined) {
    return;
  }
  try {
    await store.getResource(
      ApiResourceKind.organization,
      entry.slug,
      OrganizationSchema,
    );
    return; // stored: the organization exists and keeps its slug
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      logger.error(
        "organization create failed and its slug claim could not be checked; the slug stays claimed",
        {
          slug: entry.slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
  }
  try {
    await store.organizationSlugs.release(entry);
  } catch (error) {
    logger.error(
      "organization create failed and its slug claim could not be released; the slug stays claimed",
      {
        slug: entry.slug,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Retires the organization's slug before anything else the delete does,
 * right after the organization is loaded. Its entry may not exist yet (an
 * organization created before the ledger, or by an older binary during a
 * rolling upgrade), and retire records it either way, so the slug is
 * retired before the row can go.
 *
 * A fault fails the delete with the organization intact. A delete that
 * fails later (an edition's refusal on the pre-delete slot, a revocation
 * fault) leaves a live organization whose slug reads as retired; nothing
 * observes that, because a create of the slug is refused either way, and a
 * retry of the delete resumes.
 */
export function newRetireOrganizationSlugStep<Desc extends DescMessage>(
  store: Store,
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
          "failed to retire the organization slug",
        );
      }
      try {
        await store.organizationSlugs.retire(id);
      } catch (error) {
        throw internalError(error, "failed to retire the organization slug");
      }
    },
  };
}
