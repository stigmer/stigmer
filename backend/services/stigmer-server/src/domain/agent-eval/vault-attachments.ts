/**
 * How an agent eval names vaults: the plugin eval's rule
 * (domain/plugin-eval/vault-attachments.ts) on the agent's eval. A try has
 * no person of its own in the hosted edition, so each vault is asked of the
 * account that attached it; no My vault is admitted, since every viewer of
 * the agent in its organization can read a try's transcript.
 *
 * Proven by __tests__/faults.test.ts (the options and the attachers slot);
 * the step that reads them is the shared one, proven by
 * domain/vault/__tests__/attachments.test.ts, and its tries' use of them by
 * domain/vault/__tests__/resolve.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentEvalStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";

import type { VaultAttachmentOptions } from "../vault/attachments.js";

export const AGENT_EVAL_VAULT_ATTACHMENTS: VaultAttachmentOptions<typeof AgentEvalSchema> = {
  surface: "an agent eval, whose tries every viewer of its agent can read",
  allowsOwnersMyVault: false,
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(AgentEvalStatusSchema)).vaultAttachers = attachers;
    },
  },
};
