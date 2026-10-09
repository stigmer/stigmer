/**
 * The built-in grading caller: an AI judge run acts as the CREATOR of the
 * evaluator that asked for it. Open source's driver for the gradingCaller
 * seam (extensions/grading-caller.ts), composed under the built-in
 * authorization posture, line for line the schedule fire's
 * (schedule-fire-caller.ts beside this file).
 *
 * Why the creator: the evaluator row names one person, the one who
 * switched grading on, and that person may edit the agent, so the short
 * judge session they briefly own (the grading workflow deletes it once
 * the grade is recorded) is one they could have run themselves. The
 * creator is read from the row's creation stamp, which no update changes,
 * and resolved through the identity-account domain as an account id and as
 * a raw issuer subject, as the schedule's driver does. A stamp that
 * resolves to no account (the laptop's "system", a deleted account) is the
 * seam's deterministic refusal; a missing evaluator or a store fault is an
 * infrastructure throw.
 */
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { GradingCallerMint } from "../extensions/grading-caller.js";
import { GradingCallerRefusedError } from "../extensions/grading-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInGradingCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
}

/** The refusal's log copy. */
export function evaluatorHasNoPersonMessage(evaluatorId: string): string {
  return `evaluator ${evaluatorId} was created by nobody this server recognizes as a person`;
}

export function newBuiltInGradingCaller(
  deps: BuiltInGradingCallerDeps,
): GradingCallerMint {
  return {
    async mintGradingCaller(_org, evaluatorId) {
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
      return accountAsCaller(account);
    },
  };
}
