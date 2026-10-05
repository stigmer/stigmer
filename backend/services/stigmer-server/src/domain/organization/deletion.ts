/**
 * The organization delete's own steps: mark, then hand to the purge.
 *
 * The delete answers in one request and removes nothing it cannot undo;
 * the purge (purge/runner.ts) removes everything the organization owned,
 * in the background, and the row, its names and the mark last. The order
 * in the chain (controller.ts `deleteOrganization`) is what makes a
 * refusal safe:
 *
 *   1. the refusals that read only (the single organization, a parent with
 *      live children);
 *   2. MarkDeleting: the organization is pending in the deletion table, and
 *      from this write on every seat of the deleting rule answers
 *      not-found (lifecycle.ts). Of two concurrent deletes exactly one
 *      marks; the other answers NOT_FOUND, as any request naming the
 *      organization now does;
 *   3. RefuseDeletingParent again: a child created between the first check
 *      and the mark is seen now (the create re-reads its parent after its
 *      own write, `newRefuseParentDeletingStep`, so at least one side sees
 *      the other);
 *   4. the `org-delete:pre-delete` slot and RevokeOrganizationPolicies;
 *   5. AcceptPurge: pending becomes accepted, conditional on the mark still
 *      being pending, and the purge is kicked.
 *
 * A refusal or a fault after the mark and before the accept unmarks
 * (`unmarkAfterFailure`), so the organization is live again exactly as
 * before the request, as its caller is told. If that unmark itself fails,
 * the runner unmarks the stale pending mark later (STALE_PENDING_MS).
 *
 * The child-create side of the race: a create that names a parent checks
 * it is live (the deleting rule's interceptor refuses a parent being
 * deleted, and ValidateChildOrganization a missing one), persists, then
 * re-reads the parent's mark. With each side's write committed before
 * its read, at least one sees the other: the delete refuses
 * ORGANIZATION_HAS_CHILDREN and unmarks, or the create finds its parent
 * deleting, marks and accepts its own deletion, kicks the purge, and
 * answers ORGANIZATION_PARENT_DELETING. A child just made holds no policy
 * row (nobody owns a child) and nothing an edition's slot removes, so its
 * own mark needs neither.
 *
 * What the tests pin (__tests__/deletion.test.ts): the single winner of a
 * concurrent delete, unmark on a refusal after the mark, the accept's
 * condition, and both sides of the child race.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";
import { parentOrgOf } from "./children.js";
import type { OrganizationPurgeKick } from "./purge/runner.js";

/** The ErrorInfo reason a child create carries when its parent's delete won the race; metadata `parent_org`. */
export const ORGANIZATION_PARENT_DELETING = "ORGANIZATION_PARENT_DELETING";

/** Where MarkDeleting records that this request holds the mark. */
const MARKED_KEY = "organizationDeletionMarked";

/** Where AcceptPurge records that the mark is the purge's now. */
const ACCEPTED_KEY = "organizationDeletionAccepted";

/** The organization's own name for its kind, as the Authorize step's not-found copy has it. */
const ORGANIZATION = "Organization";

function loadedOrganizationId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  step: string,
): string {
  const organization = ctx.get(EXISTING_RESOURCE_KEY) as
    | Organization
    | undefined;
  const id = organization?.metadata?.id ?? "";
  if (id === "") {
    throw internalError(
      new Error(`organization delete reached ${step} without its loaded row`),
      "failed to delete organization",
    );
  }
  return id;
}

/** MarkDeleting: the organization is pending; a second delete loses the insert and answers NOT_FOUND. */
export function newMarkDeletingStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "MarkDeleting",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = loadedOrganizationId(ctx, "MarkDeleting");
      let marked: boolean;
      try {
        marked = await store.organizationDeletions.mark(
          id,
          new Date().toISOString(),
        );
      } catch (error) {
        throw internalError(error, "failed to delete organization");
      }
      if (!marked) {
        throw notFoundError(ORGANIZATION, id);
      }
      ctx.set(MARKED_KEY, true);
    },
  };
}

/** AcceptPurge: the mark is the purge's; the request answers the organization as it stood. */
export function newAcceptPurgeStep<Desc extends DescMessage>(
  store: Store,
  purge: OrganizationPurgeKick,
): PipelineStep<Desc> {
  return {
    name: "AcceptPurge",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = loadedOrganizationId(ctx, "AcceptPurge");
      let accepted: boolean;
      try {
        accepted = await store.organizationDeletions.accept(
          id,
          new Date().toISOString(),
        );
      } catch (error) {
        throw internalError(error, "failed to delete organization");
      }
      if (!accepted) {
        // The runner unmarked a mark it judged stale: the delete is over.
        throw internalError(
          new Error(`the deletion mark of ${id} was no longer pending`),
          "failed to delete organization",
        );
      }
      ctx.set(ACCEPTED_KEY, true);
      purge.kick(id);
    },
  };
}

/**
 * After a delete chain failed: removes the mark this request holds when the
 * purge has not accepted it, so the organization is live again. A fault is
 * logged; the runner removes a stale pending mark later.
 */
export async function unmarkAfterFailure<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
  ctx: RequestContext<Desc>,
): Promise<void> {
  if (ctx.get(MARKED_KEY) !== true || ctx.get(ACCEPTED_KEY) === true) {
    return;
  }
  const organization = ctx.get(EXISTING_RESOURCE_KEY) as
    | Organization
    | undefined;
  const id = organization?.metadata?.id ?? "";
  try {
    await store.organizationDeletions.unmark(id);
  } catch (error) {
    logger.error(
      "organization delete failed and its deletion mark could not be removed; the purge runner removes it once it is stale",
      {
        org: id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * RefuseParentDeleting — a child create, after Persist: re-reads the
 * parent's mark. A parent whose delete marked it after this create's first
 * check (and so may not have seen this child) loses the child too: the
 * child marks and accepts its own deletion, the purge is kicked, and the
 * create answers ORGANIZATION_PARENT_DELETING.
 */
export function newRefuseParentDeletingStep(
  store: Store,
  purge: OrganizationPurgeKick,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "RefuseParentDeleting",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const parentId = parentOrgOf(ctx.newState);
      if (parentId === "") {
        return;
      }
      const id = metadataOf(ctx.newState)?.id ?? "";
      try {
        if (!(await store.organizationDeletions.isDeleting(parentId))) {
          return;
        }
        const now = new Date().toISOString();
        await store.organizationDeletions.mark(id, now);
        await store.organizationDeletions.accept(id, now);
      } catch (error) {
        throw internalError(error, "failed to create organization");
      }
      purge.kick(id);
      throw failedPreconditionError(
        "the parent organization is being deleted",
        {
          reason: ORGANIZATION_PARENT_DELETING,
          metadata: { parent_org: parentId },
        },
      );
    },
  };
}
