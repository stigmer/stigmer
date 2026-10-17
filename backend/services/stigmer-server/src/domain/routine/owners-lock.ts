/**
 * Only a routine's owner changes what it runs. Every run acts as the
 * owner (owner.ts), so a change to the message, the agent's settings, the
 * workspace, the vaults or the schedule by anyone else would put words and
 * credentials into runs held in the owner's name. Whoever else may manage
 * the routine (an organization's admins, through can_edit) may still stop
 * it (`enabled` to false), rename it, relabel it, resume it or delete it:
 * none of those changes what a run does, and resume and rename are their
 * own commands.
 *
 * `routineChangesRuns` is the one reading of "what it runs": the whole
 * spec, with a switch-off ignored (there is no next run to change), so
 * switching it back on is the owner's too. Labels and the name are
 * metadata.
 *
 * The caller is the owner when they are the principal the row's creator
 * stamp names, or the account that stamp resolves to as a fire resolves it
 * (an account id, or the raw issuer subject rows the 3.14.x verifiers
 * stamped); a routine whose stamp names nobody has no owner, and only the
 * server itself (the internal caller class) changes what it runs. The trusted-local laptop
 * has one person and signs nobody in, as for its fires, so the lock is
 * composed only where callers are accounts (`accounts` undefined: none).
 *
 * Proven by __tests__/owners-lock.test.ts and the routine conformance
 * suite.
 */
import { clone, create, equals } from "@bufbuild/protobuf";

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/spec_pb";

import { RoutineFireRefusedError } from "../../extensions/routine-fire-caller.js";
import { internalError, permissionDeniedError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { auditOf } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { resolveRoutineOwner } from "./owner.js";

/** The refusal's copy (byte-pinned by the conformance suite). */
export const OWNERS_LOCK_MESSAGE =
  "only the person who created this routine may change what it runs; you may switch it off, rename, relabel or delete it";

/** Whether `next` changes what `existing`'s runs do (the module header). */
export function routineChangesRuns(existing: Routine, next: Routine): boolean {
  const before = existing.spec ?? create(RoutineSpecSchema);
  const after = clone(RoutineSpecSchema, next.spec ?? create(RoutineSpecSchema));
  // Stopping it changes nothing a run does: there is no next run.
  if (!after.enabled) {
    after.enabled = before.enabled;
  }
  return !equals(RoutineSpecSchema, before, after);
}

/** Whether `principal` is the routine's owner (the module header). */
async function isOwner(accounts: AccountsByCaller, routine: Routine, principal: string): Promise<boolean> {
  if (principal === "") {
    return false;
  }
  const stamp = auditOf(RoutineSchema, routine)?.specAudit?.createdBy?.id ?? "";
  if (stamp === principal) {
    return true;
  }
  let owner;
  try {
    owner = await resolveRoutineOwner(accounts, routine);
  } catch (error) {
    if (error instanceof RoutineFireRefusedError) {
      return false;
    }
    throw internalError(error, "failed to resolve the routine's owner");
  }
  return owner.metadata?.id === principal || (owner.spec?.idpId ?? "") === principal;
}

export function newOwnersLockStep(
  accounts: AccountsByCaller | undefined,
): PipelineStep<typeof RoutineSchema> {
  return {
    name: "OwnersLock",
    async execute(ctx: RequestContext<typeof RoutineSchema>): Promise<void> {
      const caller = ctx.callerIdentity;
      if (accounts === undefined || caller.callerClass === "internal") {
        return;
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Routine | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing routine not found in context"),
          "existing routine not found in context",
        );
      }
      if (!routineChangesRuns(existing, ctx.newState)) {
        return;
      }
      if (await isOwner(accounts, existing, caller.identityId)) {
        return;
      }
      throw permissionDeniedError(OWNERS_LOCK_MESSAGE);
    },
  };
}
