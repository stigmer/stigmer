/**
 * The runner-synthesized conversation participation attachment — a cheap
 * local predicate,
 * not the channel module's discovery machinery.
 *
 * When the session IS a live channel conversation, the runner
 * synthesizes ONE MCP attachment serving `escalate_to_human`, so the
 * agent can flag its own conversation for human attention
 * (escalate-and-continue: the agent keeps serving; nothing is paged).
 *
 * The conditioning signal is two session resource labels, stamped
 * server-side from the JWT on every channel-created Session, each
 * answering its own question:
 *
 *   - `stigmer.ai/channel-id` answers "which channel serves this
 *     session?". Every conversation a channel serves carries it, a
 *     chat-link (web channel) guest session included, so it alone does
 *     not say there is a provider conversation to escalate.
 *   - `stigmer.ai/channel-conversation-key` answers "which provider
 *     conversation is this?" (a Slack thread, a WhatsApp chat). Only a
 *     Slack or WhatsApp conversation carries it; a chat-link session
 *     never does.
 *
 * Escalation acts on exactly one provider conversation, so the tool
 * attaches only when BOTH labels are present: a chat-link session, with
 * the channel id and no conversation key, gets no tool. These are the
 * same fields the cloud's channel messaging reach reads to answer exactly
 * this question. They are deliberately NOT SessionSpec.metadata keys:
 * none of those asserts "this is a channel conversation" (sender identity
 * is who wrote, the bridge is rollover provenance), and a new key would
 * reach existing live conversations only at rollover. The labels are not
 * authorization — a spoofed label buys a tool the server refuses (the
 * reach derives identity from the session token, never from labels the
 * runner read).
 *
 * ONE connection shape — HTTP against the bridge's /conversation route
 * with the execution's session-scoped credential as the Bearer token —
 * and deliberately NO stdio fallback, diverging from both siblings:
 * escalate is cloud-only (OSS refuses FAILED_PRECONDITION) AND
 * session-token-only (a stdio child's startup API key carries no
 * session_id claim, so even cloud would refuse PERMISSION_DENIED). A
 * stdio shape would be a tool that can only fail; no bridge endpoint
 * means honest absence instead.
 *
 * Also deliberately NO prompt section (the siblings' <available_*>
 * pattern): the tool description carries the full when-to-use contract,
 * and a standing section would spend every channel turn's context to
 * restate what the tool listing already shows.
 *
 * Approval-free by construction, and FORCED, not convenient: channel
 * surfaces run APPROVAL_MODE_UNATTENDED, where a gated tool resolves as
 * skip-and-adapt — a gated escalation would never fire. It is no plugin's
 * server, so the approval default reads no mark from it and cannot gate
 * it, and its tools sit outside every tool list (see
 * synthesized-attachment.ts). Callers inject AFTER resolve.
 */

import { CONVERSATION_MCP_SERVER } from "@stigmer/tool-vocabulary";

import type { ResolvedMcpServer } from "./mcp-resolver.js";
import type { SynthesizedAttachmentOptions } from "./synthesized-attachment.js";

/**
 * The synthesized attachment's slug. Reserved: no plugin server is named
 * like it (theirs start `plugin_`), and one that were would be shadowed by
 * the synthesized attachment, with a warning.
 * Runner-internal (the resolved-server name and shadow key — the
 * mcp-server never sees it); pinned by this module's test.
 */
export const CONVERSATION_ATTACHMENT_SLUG = CONVERSATION_MCP_SERVER;

/**
 * The bridge route serving the conversation-only roster. The cross-repo
 * string: pinned here and in the mcp-server's conversation integration
 * test — a drift strands every synthesized attachment on a 404.
 */
export const CONVERSATION_ROUTE = "/conversation";

/**
 * The session label naming the serving channel. Pinned verbatim to the
 * cloud's channel runtime constant of the same name (mirror guard in this
 * module's test and on the cloud's side). Drift degrades to honest
 * absence — the tool silently stops attaching, escalation never fires
 * from a tool that was never offered — never worse.
 */
export const CHANNEL_ID_LABEL = "stigmer.ai/channel-id";

/**
 * The session label naming the provider conversation (a Slack thread, a
 * WhatsApp chat) the session serves. Pinned verbatim to the cloud's
 * channel runtime constant CONVERSATION_KEY_LABEL, with the same
 * honest-absence drift as {@link CHANNEL_ID_LABEL}.
 */
export const CONVERSATION_KEY_LABEL = "stigmer.ai/channel-conversation-key";

/**
 * Read the serving channel id of a session that is a live provider
 * conversation: the channel id, present only when the conversation key is
 * present too. A session serving a channel with no conversation key (a
 * chat-link guest session) reads as absent, as do blank and
 * whitespace-only values: the labels are stamped complete or not at all,
 * and a blank one must not synthesize a tool.
 */
export function readChannelConversationId(
  labels: Record<string, string> | undefined,
): string | undefined {
  const channelId = labels?.[CHANNEL_ID_LABEL]?.trim();
  const conversationKey = labels?.[CONVERSATION_KEY_LABEL]?.trim();
  if (channelId === undefined || channelId === "") return undefined;
  if (conversationKey === undefined || conversationKey === "") return undefined;
  return channelId;
}

/**
 * Synthesize the conversation attachment for a channel-conversation
 * session. Returns undefined when the session serves no channel
 * conversation OR no bridge endpoint is configured (the deliberate
 * no-stdio divergence — see the file header).
 */
export function synthesizeConversationAttachment(
  channelId: string | undefined,
  options: SynthesizedAttachmentOptions,
): ResolvedMcpServer | undefined {
  if (channelId === undefined) {
    return undefined;
  }
  if (options.bridgeEndpoint === null || options.bridgeEndpoint === "") {
    return undefined;
  }

  // Approval-free by construction: see file header.
  return {
    slug: CONVERSATION_ATTACHMENT_SLUG,
    home: { kind: "platform" },
    connectionType: "http",
    url: options.bridgeEndpoint.replace(/\/+$/, "") + CONVERSATION_ROUTE,
    headers: options.credential !== null && options.credential !== ""
      ? { Authorization: `Bearer ${options.credential}` }
      : undefined,
  };
}
