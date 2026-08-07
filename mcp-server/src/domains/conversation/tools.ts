// The escalate_to_human tool — the ONE tool of the conversation roster
// (channel-conversations DD-008 D-b). A14 named the roster
// stigmer-conversation, axis-named like stigmer-channels: the
// conditioning axis is "this session IS a live channel conversation",
// and the notes/loop-in tools DD-008 anticipates join this roster
// instead of earning new routes.
//
// Agent audience only, by construction: escalate derives the
// conversation identity server-side from the session-scoped credential
// (the DD-003 identity doctrine), so a direct principal is always
// refused PERMISSION_DENIED — which is why no variant exists on the
// full roster and why the input surface is a single `reason`.
//
// The tool's answer is FIXED COPY, never the RPC's ChannelConversation
// row — a deliberate divergence from the channels roster's
// verbatim-proto-JSON convention. A15 rules the result states only what
// the platform can keep at 3am (attention is a stored flag; no one is
// paged; no console surface renders it yet) and instructs the agent
// never to promise a human or a response time.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { escalateConversation } from "./calls.js";
import { conversationResult } from "./errors.js";

const ESCALATE_DESCRIPTION = [
  "Flag this conversation for a human teammate to look at. Use this when you " +
    "cannot resolve the customer's request yourself: you lack the information, " +
    "the request needs a decision you are not authorized to make, or the " +
    "customer has asked for a person.",
  "You keep serving the conversation after calling this. Nothing is handed " +
    "off automatically and no one is paged. Do not tell the customer a human " +
    "will reply, and never promise a response time.",
  "Write the reason for a teammate who has not read the conversation. " +
    "Calling this again with a new reason is safe; the latest reason is what " +
    "they see.",
].join("\n\n");

/**
 * The success answer (A15): states only recorded fact and repeats the
 * no-promise instruction at the moment of temptation — the model's next
 * message to the customer. Deliberately does NOT claim the flag "shows
 * in the team's console": no console surface renders needs_attention
 * yet (the Conversations surface is T04+); add the claim when it ships.
 */
export const ESCALATION_RECORDED_COPY =
  "Flagged for human attention. Your reason was recorded on this " +
  "conversation. Keep helping the customer as best you can, and do not " +
  "tell the customer a human will reply or when.";

/** Register the conversation participation tool; returns the tool names. */
export function registerConversationTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "escalate_to_human",
    {
      description: ESCALATE_DESCRIPTION,
      inputSchema: {
        // Bounds mirror the protovalidate constraints on
        // EscalateConversationInput.reason (conversation_io.proto:
        // min_len 1, max_len 1024) so the model gets corrective feedback
        // without an RPC; the server's validation is the backstop.
        reason: z
          .string()
          .min(1)
          .max(1024)
          .describe(
            "Why you are escalating, written for a teammate who has not read " +
              "the conversation. Staff see it as the conversation's attention " +
              "reason. 1-1024 characters.",
          ),
      },
    },
    (args, extra) =>
      conversationResult("escalation", async () => {
        await escalateConversation(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.reason,
        );
        return ESCALATION_RECORDED_COPY;
      }),
  );

  return ["escalate_to_human"];
}
