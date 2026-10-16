/**
 * The built-in eval-run caller: an eval run's tries and AI-graded checks
 * act as the eval run's CREATOR. Open source's driver for the evalRunCaller
 * seam (extensions/eval-run-caller.ts), composed under the built-in
 * authorization posture, in the grading caller's shape (grading-caller.ts
 * beside this file).
 *
 * Why the creator: open source has no system account to own an eval run's
 * tries, and the eval run row names one person, the one who started it,
 * read from the row's creation stamp, which nothing changes. The tries are
 * then that person's sessions, which they own as any session's creator
 * does.
 *
 * The creator must still be able to edit the eval run's subject, as create
 * required (its agent, or its plugin): the tries spend for the
 * organization and act as the creator, so a creator demoted to viewer
 * mid-run stops them. The composed authorizer is asked `can_edit` on the
 * subject. A creator who may no longer edit it, or has left the
 * organization, is the seam's deterministic refusal, the try not graded
 * "the eval run's creator can no longer run it", as is a stamp that
 * resolves to no account (the laptop's "system", a deleted account) and a
 * row naming no subject; a missing eval run, a store fault or an
 * authorizer that cannot answer is an infrastructure throw.
 *
 * Proven by __tests__/eval-run-caller.postgres.test.ts on both store
 * drivers.
 */
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { subjectOf } from "../domain/eval-run/subject.js";
import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { Authorizer } from "../extensions/authorizer.js";
import type { EvalRunCallerMint } from "../extensions/eval-run-caller.js";
import { EvalRunCallerRefusedError } from "../extensions/eval-run-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInEvalRunCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
  /** The composed authorizer: may the creator still edit the eval run's subject (`can_edit`). */
  readonly authorizer: Authorizer;
}

/** The refusal's log copy when the stamp names nobody. */
export function evalRunHasNoPersonMessage(evalRunId: string): string {
  return `eval run ${evalRunId} was created by nobody this server recognizes as a person`;
}

/** The refusal's log copy when the row names no subject. */
export function evalRunHasNoSubjectMessage(evalRunId: string): string {
  return `eval run ${evalRunId} names no agent and no plugin`;
}

/** The refusal's log copy when the creator may no longer edit the eval run's subject. */
export function creatorCannotEditSubjectMessage(evalRunId: string, kind: "agent" | "plugin", subjectId: string): string {
  return `the creator of eval run ${evalRunId} may no longer edit ${kind} ${subjectId}, so its tries cannot act as them`;
}

/** The not-graded reason of a try whose creator may no longer edit the eval run's subject. */
export const CREATOR_CANNOT_RUN_EVAL_REASON = "the eval run's creator can no longer run it";

export function newBuiltInEvalRunCaller(deps: BuiltInEvalRunCallerDeps): EvalRunCallerMint {
  return {
    async mintEvalRunCaller(_org, evalRunId) {
      const evalRun = await deps.store.getResource(ApiResourceKind.eval_run, evalRunId, EvalRunSchema);
      const subject = subjectOf(evalRun.spec);
      if (subject === undefined) {
        throw new EvalRunCallerRefusedError(evalRunHasNoSubjectMessage(evalRunId));
      }
      const stamp = auditOf(EvalRunSchema, evalRun)?.specAudit?.createdBy?.id ?? "";
      const account = await accountForStamp(deps.accounts, stamp);
      if (account === undefined) {
        throw new EvalRunCallerRefusedError(evalRunHasNoPersonMessage(evalRunId));
      }
      const caller = accountAsCaller(account);
      const decision = await deps.authorizer.authorize(caller, {
        permission: IamPermission.can_edit,
        resourceKind: subject.kind === "agent" ? ApiResourceKind.agent : ApiResourceKind.plugin,
        resourceId: subject.id,
      });
      if (decision.kind === "unavailable") {
        throw decision.cause;
      }
      if (decision.kind !== "allow") {
        throw new EvalRunCallerRefusedError(
          creatorCannotEditSubjectMessage(evalRunId, subject.kind, subject.id),
          CREATOR_CANNOT_RUN_EVAL_REASON,
        );
      }
      return caller;
    },
  };
}
