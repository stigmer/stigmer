/**
 * The built-in grading caller: an AI judge run acts as the CREATOR of the
 * evaluator that asked for it. Open source's driver for the gradingCaller
 * seam (extensions/grading-caller.ts), composed under the built-in
 * authorization posture, line for line the schedule fire's
 * (schedule-fire-caller.ts beside this file).
 *
 * Why the creator: the evaluator row names one person, the one who
 * switched grading on. The creator is read from the row's creation stamp,
 * which no update changes, and resolved through the identity-account
 * domain as an account id and as a raw issuer subject, as the schedule's
 * driver does.
 *
 * The judge's session carries the graded run's whole conversation (its
 * request, tool calls and answer), and its owner can read it while the
 * judge runs, and longer if the session cannot be deleted. So the creator
 * must already be able to see the graded run: the composed authorizer is
 * asked `can_view` on it, and a creator who may not is the seam's
 * deterministic refusal. In practice an evaluator here grades the runs its
 * creator can see: their own, the ones shared with them, and every run of
 * an organization's admin. A stamp that resolves to no account (the
 * laptop's "system", a deleted account) is a refusal too; a missing
 * evaluator, a store fault or an authorizer that cannot answer is an
 * infrastructure throw.
 */
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { Authorizer } from "../extensions/authorizer.js";
import type { GradingCallerMint } from "../extensions/grading-caller.js";
import { GradingCallerRefusedError } from "../extensions/grading-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInGradingCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
  /** The composed authorizer: may the creator see the graded run. */
  readonly authorizer: Authorizer;
}

/** The refusal's log copy. */
export function evaluatorHasNoPersonMessage(evaluatorId: string): string {
  return `evaluator ${evaluatorId} was created by nobody this server recognizes as a person`;
}

/** The refusal's log copy when the creator may not see the graded run. */
export function creatorCannotSeeRunMessage(evaluatorId: string, runId: string): string {
  return `the creator of evaluator ${evaluatorId} may not see run ${runId}, so its judge cannot act as them`;
}

export function newBuiltInGradingCaller(
  deps: BuiltInGradingCallerDeps,
): GradingCallerMint {
  return {
    async mintGradingCaller(_org, evaluatorId, judgedRunId) {
      const evaluator = await deps.store.getResource(
        ApiResourceKind.evaluator,
        evaluatorId,
        EvaluatorSchema,
      );
      const stamp =
        auditOf(EvaluatorSchema, evaluator)?.specAudit?.createdBy?.id ?? "";
      const account = await accountForStamp(deps.accounts, stamp);
      if (account === undefined) {
        throw new GradingCallerRefusedError(
          evaluatorHasNoPersonMessage(evaluatorId),
        );
      }
      const caller = accountAsCaller(account);
      const decision = await deps.authorizer.authorize(caller, {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.run,
        resourceId: judgedRunId,
      });
      if (decision.kind === "unavailable") {
        throw decision.cause;
      }
      if (decision.kind !== "allow") {
        throw new GradingCallerRefusedError(
          creatorCannotSeeRunMessage(evaluatorId, judgedRunId),
        );
      }
      return caller;
    },
  };
}
