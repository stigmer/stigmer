/**
 * The runner-synthesized channel messaging attachment (proactive-messaging
 * DD-006 D7/D8).
 *
 * When the control plane says an agent serves at least one
 * proactive-messaging channel (the `listMessagingChannels` discovery
 * read, DD-006 D2 — the SAME candidate computation the send
 * authorization runs, so attachment and authority cannot disagree), the
 * runner synthesizes ONE MCP attachment serving `send_channel_message`,
 * and injects the `<available_channel_templates>` prompt section so the
 * model composes template sends in context without spending a tool
 * round (DD-003 D5).
 *
 * Two connection shapes, one roster (the records pattern):
 *   - Bridge endpoint configured (cloud): Streamable HTTP against the
 *     bridge's /channels route with the execution's own session-scoped
 *     credential as the Bearer token.
 *   - No bridge endpoint (OSS/local): a spawned `stigmer mcp-server`
 *     stdio child with STIGMER_MCP_ROSTER=channels. In practice OSS
 *     answers the discovery read with an empty list (DD-006 D3), so
 *     this shape only serves local deployments that grow a messaging
 *     runtime later — it exists for symmetry with the deployment
 *     topology, not for a live OSS path today.
 *
 * Approval-free by construction, and FORCED, not convenient (DD-002
 * D6): both calling surfaces run APPROVAL_MODE_UNATTENDED, where a
 * gated tool resolves as skip-and-adapt — a gated send tool would mean
 * reminders never send. Empty approval maps + no McpServerUsage keep
 * the connect backfill structurally unable to gate it (see
 * synthesized-attachment.ts). Callers inject AFTER resolve + backfill.
 *
 * Failure posture (DD-006 D4): every discovery failure — OSS's empty
 * answer, a registry outage, a control plane predating the RPC
 * (UNIMPLEMENTED), a reach refusal — degrades to honest absence: no
 * tool, no section, execution unharmed.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import type {
  ChannelTemplate,
  MessagingChannel,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { grpcTarget, type SynthesizedAttachmentOptions } from "./synthesized-attachment.js";

/**
 * The synthesized attachment's slug. Reserved: a user McpServer with
 * this slug is shadowed by the synthesized attachment, with a warning.
 * Runner-internal (the resolved-server name and shadow key — the
 * mcp-server never sees it); pinned by this module's test. The ROUTE
 * below is the cross-repo string, pinned on both sides (the
 * TOOL_CALL_LIMIT precedent).
 */
export const CHANNEL_ATTACHMENT_SLUG = "stigmer-channels";

/** The bridge route serving the channels-only roster (mcp-server DD-006 D8). */
export const CHANNELS_ROUTE = "/channels";

/**
 * The most templates the prompt section carries (DD-006 D6): Meta
 * allows hundreds per WABA, and an unbounded section would tax every
 * run's context. Deterministic (name, language) order plus a withheld
 * count keep the agent's behavior independent of registry ordering.
 */
export const TEMPLATE_SECTION_CAP = 30;

/** One channel plus its sendable approved templates, ready to format. */
export interface ChannelMessagingInfo {
  channel: MessagingChannel;
  templates: ChannelTemplate[];
}

/**
 * The discovery read plus the per-channel template fetch, with the
 * DD-006 D4 failure posture applied: this function NEVER throws — any
 * failure returns an empty list (no tool, no section), because a
 * messaging hiccup must not fail an execution that may not even want
 * to send anything.
 */
export async function discoverChannelMessaging(
  client: StigmerClient,
  scopedCredential: string | undefined,
): Promise<ChannelMessagingInfo[]> {
  let channels: MessagingChannel[];
  try {
    channels = await client.listMessagingChannels(scopedCredential);
  } catch (err) {
    logDiscoveryFailure("listMessagingChannels", err);
    return [];
  }
  if (channels.length === 0) {
    return [];
  }

  // Template reads degrade PER CHANNEL: a registry outage on one
  // channel must not strip the section for another, and never the tool
  // (a channel with unreadable templates can still send text inside a
  // 24-hour window).
  return Promise.all(channels.map(async (channel) => {
    try {
      return {
        channel,
        templates: await client.listChannelTemplates(channel.channel, scopedCredential),
      };
    } catch (err) {
      logDiscoveryFailure(`listTemplates(${channel.channel})`, err);
      return { channel, templates: [] };
    }
  }));
}

/**
 * Synthesize the channel messaging attachment. Returns undefined when
 * the agent serves no proactive channel — the attachment exists exactly
 * when the discovery read says so.
 */
export function synthesizeChannelAttachment(
  channels: ChannelMessagingInfo[],
  options: SynthesizedAttachmentOptions,
): ResolvedMcpServer | undefined {
  if (channels.length === 0) {
    return undefined;
  }

  // Approval-free by construction + backfill-proof: see file header.
  const base = {
    slug: CHANNEL_ATTACHMENT_SLUG,
    toolApprovals: [],
    pinnedToolApprovals: [],
    toolApprovalOverrides: [],
    discoveredCapabilitiesEmpty: false,
  };

  if (options.bridgeEndpoint !== null && options.bridgeEndpoint !== "") {
    return {
      ...base,
      connectionType: "http",
      url: options.bridgeEndpoint.replace(/\/+$/, "") + CHANNELS_ROUTE,
      headers: options.credential !== null && options.credential !== ""
        ? { Authorization: `Bearer ${options.credential}` }
        : undefined,
    };
  }

  return {
    ...base,
    connectionType: "stdio",
    command: "stigmer",
    args: ["mcp-server"],
    env: {
      STIGMER_MCP_ROSTER: "channels",
      STIGMER_SERVER_ADDRESS: grpcTarget(options.backendEndpoint),
    },
  };
}

/**
 * The `<available_channel_templates>` prompt section (DD-003 D5):
 * approved AND sendable templates with their full body text, so the
 * model fills positional placeholders beside the values it composes.
 * Unsendable entries are filtered, not annotated (DD-006 D6 — the
 * console panel is the diagnosis surface, the prompt is a composition
 * aid). Returns "" when nothing survives the filter — the tool alone
 * still serves text sends inside a 24-hour window.
 */
export function formatChannelTemplatesSection(channels: ChannelMessagingInfo[]): string {
  let withheld = 0;
  let budget = TEMPLATE_SECTION_CAP;

  const channelBlocks: string[] = [];
  for (const { channel, templates } of channels) {
    // Sendable-only (unsupportedReason empty), deterministic order —
    // agent behavior must never depend on registry ordering (DD-006 D6).
    const sendable = templates
      .filter((t) => t.unsupportedReason === "")
      .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

    const kept = sendable.slice(0, Math.max(budget, 0));
    withheld += sendable.length - kept.length;
    budget -= kept.length;
    if (kept.length === 0) {
      continue;
    }

    const lines = kept.map((t) => {
      const parameters = t.parameterNames.length > 0
        ? `, parameters: ${t.parameterNames.join(", ")}`
        : "";
      const header = t.headerFormat === "IMAGE"
        ? " (requires header_image_link: a public HTTPS image URL)"
        : "";
      return [
        `  - ${t.name} (${t.language}) [${t.category}]${parameters}${header}`,
        `    "${t.bodyText}"`,
      ].join("\n");
    });
    channelBlocks.push([`channel: ${channel.channel} (${channel.provider})`, ...lines].join("\n"));
  }

  if (channelBlocks.length === 0) {
    return "";
  }

  const footer = withheld > 0
    ? [`(${withheld} more approved template${withheld === 1 ? "" : "s"} not shown)`]
    : [];
  return [
    "<available_channel_templates>",
    "You can send business-initiated messages on the channels below with the",
    "send_channel_message tool. Outside a 24-hour customer-service window the",
    "provider only accepts a pre-approved template, so prefer a template. Fill",
    "every placeholder from the conversation; never invent a value.",
    "",
    ...channelBlocks,
    ...footer,
    "</available_channel_templates>",
  ].join("\n");
}

/**
 * Expected absences log quietly; anything else warns so an operator can
 * diagnose a mis-provisioned credential without failing the execution.
 * UNIMPLEMENTED is a control plane predating the discovery RPC — the
 * DD-006 D4 deploy-order self-healing case.
 */
function logDiscoveryFailure(what: string, err: unknown): void {
  const ce = ConnectError.from(err);
  const expected =
    ce.code === Code.Unimplemented ||
    ce.code === Code.FailedPrecondition ||
    ce.code === Code.Unavailable;
  if (expected) {
    console.debug(`[channel-attachment] ${what} degraded to honest absence: ${ce.message}`);
  } else {
    console.warn(
      `[channel-attachment] ${what} failed unexpectedly (no tool, no section): ${ce.message}`,
    );
  }
}
