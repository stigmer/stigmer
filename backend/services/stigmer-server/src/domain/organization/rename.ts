/**
 * The organization rename chain's own steps: the only writer of an
 * organization's slug, the way updateVisibility is the only writer of a
 * resource's visibility (an update ignores both).
 *
 * The organization is filed under its id, so a rename moves no resource,
 * grant or key; it moves names (names.ts). The store has no transaction
 * across tables, so the order is chosen for what a failure leaves:
 *
 *   1. the name table moves in one transaction: the new slug becomes the
 *      organization's current name and the old one a previous name, held
 *      for RENAMED_SLUG_HOLD_MS (for good when the old name is the id an
 *      organization made before ids were minted carries);
 *   2. the row is written with the new slug; when that fails, the names
 *      move back. If the move back fails too, both slugs still lead to the
 *      same organization, and a retry converges: the new slug is already
 *      its own, and the row's slug is one of its own previous names.
 *
 * Proven by __tests__/organization-rename.test.ts and the
 * organization-identity conformance suite.
 */
import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ResourceNameEntry, ResourceNameRename, Store } from "../../store/interface.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";

import type { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import {
  ORGANIZATION_NAME_KIND,
  RENAMED_SLUG_HOLD_MS,
  nameHolderIsGone,
  refusalForHeldName,
  settleOrganizationSlug,
} from "./names.js";
import { organizationSearchExtractor } from "./search-extractor.js";

type RenameDesc = typeof RenameInputSchema;

/** Where the chain keeps the organization it renames, and returns. */
export const RENAMED_ORGANIZATION_KEY = "renamedOrganization";

/** Where RenameOrganizationSlug leaves the move it made, for the write that follows. */
const NAME_MOVE_KEY = "organizationNameMove";

/** The move RenameOrganizationSlug made, and the earlier state of a name it took back. */
interface NameMove {
  readonly move: ResourceNameRename;
  readonly takenBack?: ResourceNameEntry;
}

/** Loads the organization by resource_id; a missing one answers NotFound, a store fault Internal. */
export function newLoadOrganizationForRenameStep(
  store: Store,
): PipelineStep<RenameDesc> {
  return {
    name: "LoadOrganizationForRename",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      let organization: Organization;
      try {
        organization = await store.getResource(
          ApiResourceKind.organization,
          ctx.input.resourceId,
          OrganizationSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Organization", ctx.input.resourceId);
        }
        throw internalError(error, "failed to load organization");
      }
      ctx.set(RENAMED_ORGANIZATION_KEY, organization);
    },
  };
}

/**
 * Moves the organization's names, then sets its slug and stamps the spec
 * audit with the event "renamed". A rename to the slug it already has
 * changes nothing. A slug another live organization answers to is refused
 * as a create of it is; one whose organization is gone is freed and taken.
 */
export function newRenameOrganizationSlugStep(
  store: Store,
): PipelineStep<RenameDesc> {
  return {
    name: "RenameOrganizationSlug",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      const organization = ctx.get(RENAMED_ORGANIZATION_KEY) as Organization;
      const metadata = organization.metadata;
      if (metadata === undefined || metadata.id === "" || metadata.slug === "") {
        throw internalError(
          new Error("organization row has no id or slug"),
          "failed to rename the organization",
        );
      }
      // The name table, not the row, says what the organization is called:
      // a row a failed settle left behind moves from the table's name.
      let current;
      try {
        current = await store.resourceNames.current(ORGANIZATION_NAME_KIND, "", metadata.id);
      } catch (error) {
        throw internalError(error, "failed to rename the organization");
      }
      const from = current?.name ?? metadata.slug;
      if (from === ctx.input.slug) {
        metadata.slug = from;
        return;
      }
      const now = new Date();
      const move: ResourceNameRename = {
        kind: ORGANIZATION_NAME_KIND,
        org: "",
        id: metadata.id,
        from,
        to: ctx.input.slug,
        // The store holds a name equal to the id for good (an organization
        // from an earlier release, filed under its first slug).
        fromExpiresAt: new Date(now.getTime() + RENAMED_SLUG_HOLD_MS).toISOString(),
        now: now.toISOString(),
      };
      let moved;
      try {
        moved = await store.resourceNames.rename(move);
        if (!moved.claimed && (await nameHolderIsGone(store, moved.entry, now))) {
          await store.resourceNames.release(
            moved.entry.kind,
            moved.entry.org,
            moved.entry.id,
          );
          moved = await store.resourceNames.rename(move);
        }
      } catch (error) {
        throw internalError(error, "failed to rename the organization");
      }
      if (!moved.claimed) {
        throw refusalForHeldName(moved.entry);
      }
      const recorded: NameMove = moved.takenBack === undefined ? { move } : { move, takenBack: moved.takenBack };
      ctx.set(NAME_MOVE_KEY, recorded);
      metadata.slug = ctx.input.slug;
      setAuditFieldsForUpdate(
        OrganizationSchema,
        organization,
        "spec_audit",
        ctx.callerIdentity,
      );
      const specAudit = organization.status?.audit?.specAudit;
      if (specAudit !== undefined) {
        specAudit.event = "renamed";
      }
    },
  };
}

/**
 * Writes the renamed organization. When the write fails, the names move
 * back (the module header says why a failed move back is safe).
 */
export function newPersistRenamedOrganizationStep(
  store: Store,
  logger: Logger,
): PipelineStep<RenameDesc> {
  return {
    name: "PersistRenamedOrganization",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      const recorded = ctx.get(NAME_MOVE_KEY) as NameMove | undefined;
      if (recorded === undefined) {
        return; // the slug was already the organization's
      }
      const { move, takenBack } = recorded;
      const organization = ctx.get(RENAMED_ORGANIZATION_KEY) as Organization;
      try {
        await store.saveResource(
          ApiResourceKind.organization,
          move.id,
          OrganizationSchema,
          organization,
        );
      } catch (error) {
        try {
          await store.resourceNames.revertRename(move, takenBack);
        } catch (revertError) {
          logger.error(
            "organization rename failed and its names could not be moved back; both slugs lead to the organization until a retry",
            {
              org: move.id,
              from: move.from,
              to: move.to,
              error:
                revertError instanceof Error
                  ? revertError.message
                  : String(revertError),
            },
          );
        }
        throw internalError(error, "failed to save organization");
      }
      await settleOrganizationSlug(store, organization, logger);
    },
  };
}

/** Re-indexes the renamed organization (its slug is indexed); best-effort. */
export function newIndexOrganizationAfterRenameStep(
  store: Store,
  logger: Logger,
): PipelineStep<RenameDesc> {
  return {
    name: "IndexOrganizationAfterRename",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      if (ctx.get(NAME_MOVE_KEY) === undefined) {
        return;
      }
      const organization = ctx.get(RENAMED_ORGANIZATION_KEY) as Organization;
      const id = organization.metadata?.id ?? "";
      const entry = organizationSearchExtractor.getSearchIndexEntry(organization);
      if (entry === undefined) {
        return;
      }
      try {
        await store.upsertSearchIndex(ApiResourceKind.organization, id, entry);
      } catch (error) {
        logger.warn("IndexOrganizationAfterRename: failed (best-effort)", {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
