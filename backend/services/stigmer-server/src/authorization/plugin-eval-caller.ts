/**
 * The built-in plugin-eval caller: a plugin eval's tries and AI-graded
 * checks act as the eval's CREATOR. Open source's driver for the
 * pluginEvalCaller seam (extensions/plugin-eval-caller.ts), composed under
 * the built-in authorization posture, in the grading caller's shape
 * (grading-caller.ts beside this file).
 *
 * Why the creator: open source has no system account to own an eval's
 * tries, and the eval row names one person, the one who started it, read
 * from the row's creation stamp, which nothing changes. The tries are then
 * that person's sessions, which they own as any session's creator does.
 *
 * The creator must still be able to read the eval: the composed
 * authorizer is asked `can_view` on it, which is the plugin's viewers in
 * its own organization. A creator who has left the organization, or can
 * no longer see the plugin, is the seam's deterministic refusal, as is a
 * stamp that resolves to no account (the laptop's "system", a deleted
 * account); a missing eval, a store fault or an authorizer that cannot
 * answer is an infrastructure throw.
 *
 * Proven by __tests__/plugin-eval-caller.postgres.test.ts on both store
 * drivers.
 */
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { Authorizer } from "../extensions/authorizer.js";
import type { PluginEvalCallerMint } from "../extensions/plugin-eval-caller.js";
import { PluginEvalCallerRefusedError } from "../extensions/plugin-eval-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInPluginEvalCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
  /** The composed authorizer: may the creator still read the eval. */
  readonly authorizer: Authorizer;
}

/** The refusal's log copy when the stamp names nobody. */
export function pluginEvalHasNoPersonMessage(evalId: string): string {
  return `plugin eval ${evalId} was created by nobody this server recognizes as a person`;
}

/** The refusal's log copy when the creator may no longer read the eval. */
export function creatorCannotSeeEvalMessage(evalId: string): string {
  return `the creator of plugin eval ${evalId} may no longer read it, so its tries cannot act as them`;
}

export function newBuiltInPluginEvalCaller(
  deps: BuiltInPluginEvalCallerDeps,
): PluginEvalCallerMint {
  return {
    async mintPluginEvalCaller(_org, evalId) {
      const pluginEval = await deps.store.getResource(
        ApiResourceKind.plugin_eval,
        evalId,
        PluginEvalSchema,
      );
      const stamp =
        auditOf(PluginEvalSchema, pluginEval)?.specAudit?.createdBy?.id ?? "";
      const account = await accountForStamp(deps.accounts, stamp);
      if (account === undefined) {
        throw new PluginEvalCallerRefusedError(
          pluginEvalHasNoPersonMessage(evalId),
        );
      }
      const caller = accountAsCaller(account);
      const decision = await deps.authorizer.authorize(caller, {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.plugin_eval,
        resourceId: evalId,
      });
      if (decision.kind === "unavailable") {
        throw decision.cause;
      }
      if (decision.kind !== "allow") {
        throw new PluginEvalCallerRefusedError(
          creatorCannotSeeEvalMessage(evalId),
        );
      }
      return caller;
    },
  };
}
