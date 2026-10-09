/**
 * How a schedule names vaults: the schedule's options for the shared
 * attachments step (domain/vault/attachments.ts), which the create and
 * update chains run.
 *
 * A schedule's fires have no person: each asks the account that attached
 * each vault. Its owner may attach their own My vault, and a change of the
 * agent it runs re-judges every vault it keeps against the updater.
 *
 * While it names its creator's My vault, its spec is that person's alone:
 * the message, workspace, cron, agent and every other spec field shape
 * what a fire does with their credentials. Anyone else may still stop it
 * (enabled to false), rename it, relabel it or delete it; switching it
 * back on, or any other spec change, needs the creator or the vault's
 * removal in the same update. Resume and trigger are their own commands
 * and change nothing a fire runs. The agent itself stays its editors': a
 * schedule that follows the agent's latest version fills what that
 * version declares, which the vault docs tell owners (pin the version).
 *
 * Proven by __tests__/update-vaults.test.ts,
 * __tests__/my-vault-lock.composed.test.ts (the update RPC) and
 * domain/vault/__tests__/attachments.test.ts.
 */
import { clone, create, equals } from "@bufbuild/protobuf";

import type { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";

import type { VaultAttachmentOptions } from "../vault/attachments.js";

export const SCHEDULE_VAULT_ATTACHMENTS: VaultAttachmentOptions<typeof ScheduleSchema> = {
  surface: "a schedule other than its owner's own",
  allowsOwnersMyVault: true,
  rejudgeAllWhen: (existing, next) => {
    const before = existing.spec?.target;
    const after = next.spec?.target;
    const refOf = (target: typeof before) =>
      target?.case === "agent" ? target.value.agentRef : undefined;
    const a = refOf(before);
    const b = refOf(after);
    return (
      (a?.org ?? "") !== (b?.org ?? "") ||
      (a?.slug ?? "") !== (b?.slug ?? "") ||
      (a?.version ?? "") !== (b?.version ?? "")
    );
  },
  changesRuns: (existing, next) => {
    const before = existing.spec ?? create(ScheduleSpecSchema);
    const after = clone(ScheduleSpecSchema, next.spec ?? create(ScheduleSpecSchema));
    // Stopping it changes nothing a fire runs: there is no next fire.
    if (!after.enabled) {
      after.enabled = before.enabled;
    }
    return !equals(ScheduleSpecSchema, before, after);
  },
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(ScheduleStatusSchema)).vaultAttachers = attachers;
    },
  },
};
