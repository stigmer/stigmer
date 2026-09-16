/**
 * The built-in schedule fire caller — a fire acts as the schedule's
 * CREATOR. Open source's driver for the scheduleFireCaller seam
 * (extensions/schedule-fire-caller.ts), composed under the built-in
 * authorization posture.
 *
 * Why the creator: with no driver a fire enters the create pipeline as
 * the `internal` class carrying the operator's email or `"system"`, and
 * under an enforcing authorizer the fired session belongs to nobody the
 * model recognizes — the person who scheduled it cannot see it, the
 * operator cannot, the runner cannot report on it. The creator is the
 * one person the schedule row names, and the person the runner will act
 * as once its own lane lands. The run and its auto-created session are
 * stamped with their account, so their `owner` derives, and the create
 * runs the full chain as them: a creator who has since lost `can_execute`
 * on the agent is refused by the launch gate, which the RunStarter already
 * counts against the schedule.
 *
 * Recorded difference from the cloud: there the schedule's org admins and
 * grantees also see the run, through the session#schedule tuple; here
 * only the creator does, because deriving that link from the
 * client-suppliable schedule-id label is what the cloud explicitly
 * refused.
 *
 * The creator's account is resolved from the row's stamp through the
 * identity-account domain's `accountForStamp` — as an account id (rows
 * stamped since 3.15.0) and as the raw issuer subject (rows the 3.14.x
 * verifiers stamped), the same two shapes `Person` aliases and the same
 * read the runner-subject verifier makes of an execution's stamp. A
 * stamp that resolves to no account
 * is the seam's DETERMINISTIC refusal (`ScheduleFireCallerRefusedError`):
 * the empty stamp, the laptop's `"system"`, an email from the
 * trusted-local era, a deleted account — no retry will make that schedule
 * anyone's, so the RunStarter pauses it with this message rather than
 * failing every tick. A missing schedule row or a store fault is an
 * infrastructure throw, as for every other mint.
 *
 * The identity is `accountAsCaller(account)` (domain/identityaccount/
 * actor.ts, the one construction of an account acting as itself): a
 * `user` with no issuer and no token — open source reads no fire-scoped
 * claims downstream, and the propagation lane stamps `origin:
 * "in-process"` on it.
 */
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { ScheduleFireCallerMint } from "../extensions/schedule-fire-caller.js";
import { ScheduleFireCallerRefusedError } from "../extensions/schedule-fire-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInScheduleFireCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
}

/** The refusal's copy — written for the person who scheduled the run (the schedule's status carries it). */
export function scheduleHasNoPersonMessage(scheduleId: string): string {
  return `schedule ${scheduleId} was created by nobody this server recognizes as a person; recreate it while signed in`;
}

export function newBuiltInScheduleFireCaller(
  deps: BuiltInScheduleFireCallerDeps,
): ScheduleFireCallerMint {
  return {
    async mintFireCaller(_org, scheduleId) {
      const schedule = await deps.store.getResource(
        ApiResourceKind.schedule,
        scheduleId,
        ScheduleSchema,
      );
      const stamp =
        auditOf(ScheduleSchema, schedule)?.specAudit?.createdBy?.id ?? "";
      const account = await accountForStamp(deps.accounts, stamp);
      if (account === undefined) {
        throw new ScheduleFireCallerRefusedError(
          scheduleHasNoPersonMessage(scheduleId),
        );
      }
      return accountAsCaller(account);
    },
  };
}
