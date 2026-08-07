/**
 * The runner-synthesized conversation participation attachment
 * (channel-conversations DD-008 D-c, A14) — the third synthesized
 * attachment, on the datastore module's shape (a cheap local predicate,
 * not the channel module's discovery machinery).
 *
 * When the session IS a live channel conversation, the runner
 * synthesizes ONE MCP attachment serving `escalate_to_human`, so the
 * agent can flag its own conversation for human attention
 * (escalate-and-continue: the agent keeps serving; nothing is paged).
 *
 * The conditioning signal is the session resource label
 * `stigmer.ai/channel-id`, stamped server-side from the JWT on every
 * channel-created Session (ChannelSessionCreateScopeStep) — the same
 * field the cloud's own ChannelMessagingReach.deriveOrigin reads to
 * answer exactly this question. It is deliberately NOT a
 * SessionSpec.metadata key: none of those asserts "this is a channel
 * conversation" (sender identity is who wrote, the bridge is rollover
 * provenance), and a new key would reach existing live conversations
 * only at rollover. The label is not authorization — a spoofed label
 * buys a tool the server refuses (the reach derives identity from the
 * session token, never from labels the runner read).
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
 * skip-and-adapt — a gated escalation would never fire (DD-008's
 * approval-free ruling). Empty approval maps + no McpServerUsage keep
 * the connect backfill structurally unable to gate it (see
 * synthesized-attachment.ts). Callers inject AFTER resolve + backfill.
 */

import type { ResolvedMcpServer } from "./mcp-resolver.js";
import type { SynthesizedAttachmentOptions } from "./synthesized-attachment.js";

/**
 * The synthesized attachment's slug. Reserved: a user McpServer with
 * this slug is shadowed by the synthesized attachment, with a warning.
 * Runner-internal (the resolved-server name and shadow key — the
 * mcp-server never sees it); pinned by this module's test.
 */
export const CONVERSATION_ATTACHMENT_SLUG = "stigmer-conversation";

/**
 * The bridge route serving the conversation-only roster. The cross-repo
 * string: pinned here and in the mcp-server's conversation integration
 * test — a drift strands every synthesized attachment on a 404.
 */
export const CONVERSATION_ROUTE = "/conversation";

/**
 * The session label naming the serving channel. Pinned verbatim to
 * ChannelRuntimeConstants.CHANNEL_ID_METADATA_KEY in stigmer-cloud
 * (mirror guard in this module's test and in ChannelSessionBrokerTest).
 * Drift degrades to honest absence — the tool silently stops attaching,
 * escalation never fires from a tool that was never offered — never
 * worse.
 */
export const CHANNEL_ID_LABEL = "stigmer.ai/channel-id";

/**
 * Read the serving channel id from a session's resource labels. Blank
 * and whitespace-only values are absent: the label is stamped complete
 * or not at all, and a blank channel id must not synthesize a tool.
 */
export function readChannelConversationId(
  labels: Record<string, string> | undefined,
): string | undefined {
  const channelId = labels?.[CHANNEL_ID_LABEL]?.trim();
  return channelId !== undefined && channelId !== "" ? channelId : undefined;
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

  // Approval-free by construction + backfill-proof: see file header.
  return {
    slug: CONVERSATION_ATTACHMENT_SLUG,
    toolApprovals: [],
    pinnedToolApprovals: [],
    discoveredCapabilitiesEmpty: false,
    connectionType: "http",
    url: options.bridgeEndpoint.replace(/\/+$/, "") + CONVERSATION_ROUTE,
    headers: options.credential !== null && options.credential !== ""
      ? { Authorization: `Bearer ${options.credential}` }
      : undefined,
  };
}
