/**
 * How a routine names vaults: the routine's options for the shared
 * attachments step (domain/vault/attachments.ts), which the create and
 * update chains run.
 *
 * A routine's runs act as its owner and use the vaults it names, each
 * asking the account that attached it. Its owner may attach their own My
 * vault, and a change of the agent it runs re-judges every vault it keeps
 * against the updater. Only the owner changes what it runs at all
 * (owners-lock.ts), the rule that keeps an owner's My vault theirs. The
 * agent itself stays its editors': a routine that follows the agent's
 * latest version fills what that version declares, which the vault docs
 * tell owners (pin the version).
 *
 * Proven by __tests__/update-vaults.test.ts and
 * domain/vault/__tests__/attachments.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";

import type { VaultAttachmentOptions } from "../vault/attachments.js";

export const ROUTINE_VAULT_ATTACHMENTS: VaultAttachmentOptions<typeof RoutineSchema> = {
  surface: "a routine other than its owner's own",
  allowsOwnersMyVault: true,
  rejudgeAllWhen: (existing, next) => {
    const a = existing.spec?.agent?.agentRef;
    const b = next.spec?.agent?.agentRef;
    return (
      (a?.org ?? "") !== (b?.org ?? "") ||
      (a?.id ?? "") !== (b?.id ?? "") ||
      // A reference still written by a name nothing held carries no id.
      (a?.slug ?? "") !== (b?.slug ?? "") ||
      (a?.version ?? "") !== (b?.version ?? "")
    );
  },
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(RoutineStatusSchema)).vaultAttachers = attachers;
    },
  },
};
