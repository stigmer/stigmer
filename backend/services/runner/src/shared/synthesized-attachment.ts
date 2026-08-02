/**
 * Shared mechanics of runner-synthesized MCP attachments — the pieces
 * the datastore records attachment (T05) and the channel messaging
 * attachment (proactive-messaging DD-006 D8) have in common, extracted
 * when the second attachment arrived.
 *
 * A synthesized attachment is a first-party MCP server entry the runner
 * builds itself (no McpServer resource, no Environment, no credential in
 * any manifest) on a RESERVED slug. Approval-freedom is structural, not
 * configured: empty toolApprovals + pinnedToolApprovals mean
 * mergeApprovalPolicies emits no entries, and discoveredCapabilitiesEmpty
 * false + no McpServerUsage keep the connect backfill's destructiveHint
 * tightener structurally unable to touch it. Callers must still inject
 * AFTER resolve + backfill; every harness call site does.
 */

import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * Connection options for a synthesized attachment — one shape for every
 * attachment because the deployment topology, not the domain, decides
 * the connection.
 */
export interface SynthesizedAttachmentOptions {
  /**
   * The bridge's HTTP endpoint (STIGMER_MCP_BRIDGE_ENDPOINT, e.g.
   * https://mcp.stigmer.ai). Null selects the OSS/local stdio shape.
   */
  bridgeEndpoint: string | null;
  /**
   * The execution's session-scoped credential (the sandbox token a
   * cloud runner holds, or the desktop runner's exchanged scoped
   * token). Null attaches no Authorization header (OSS/local).
   */
  credential: string | null;
  /**
   * The stigmer backend endpoint the stdio child dials
   * (config.stigmerBackendEndpoint). Only used for the OSS shape.
   */
  backendEndpoint: string;
}

/**
 * Inject a synthesized attachment into a resolved server list — AFTER
 * resolve + backfill (see the module header). A user server shadowing
 * the reserved slug is replaced, loudly; `label` names the attachment
 * in that warning (e.g. "datastore records").
 */
export function injectSynthesizedAttachment(
  resolvedServers: ResolvedMcpServer[],
  attachment: ResolvedMcpServer,
  label: string,
): ResolvedMcpServer[] {
  const shadowed = resolvedServers.some((s) => s.slug === attachment.slug);
  if (shadowed) {
    console.warn(
      `MCP server slug "${attachment.slug}" is reserved for the ${label} ` +
      "attachment; the user-defined server is replaced.",
    );
  }
  return [
    ...resolvedServers.filter((s) => s.slug !== attachment.slug),
    attachment,
  ];
}

/**
 * The gRPC dial target (host:port) for a backend endpoint URL — the
 * shape STIGMER_SERVER_ADDRESS wants (the bridge warns on schemes).
 */
export function grpcTarget(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
