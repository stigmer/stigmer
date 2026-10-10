/**
 * How a plugin eval names vaults: the eval's options for the shared
 * attachments step (domain/vault/attachments.ts), which create runs. A try
 * has no person of its own in the hosted edition, so each vault is asked
 * of the account that attached it, as a schedule's fires are. No My vault
 * is admitted, not even the creator's own: every viewer of the plugin can
 * read a try's transcript, so a hook's or a server's output could show
 * that person's secrets to them. An eval is never updated, so no rule
 * about a later change applies.
 *
 * Proven by __tests__/plugin-eval.test.ts (the create lane) and
 * domain/vault/__tests__/attachments.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";

import type { VaultAttachmentOptions } from "../vault/attachments.js";

export const PLUGIN_EVAL_VAULT_ATTACHMENTS: VaultAttachmentOptions<typeof PluginEvalSchema> = {
  surface: "a plugin eval, whose tries every viewer of its plugin can read",
  allowsOwnersMyVault: false,
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(PluginEvalStatusSchema)).vaultAttachers = attachers;
    },
  },
};
