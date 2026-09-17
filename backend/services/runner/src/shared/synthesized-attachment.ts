/**
 * Shared mechanics of runner-synthesized MCP attachments — the pieces
 * the channel messaging attachment (proactive-messaging DD-006 D8) and
 * the conversation participation attachment (DD-008 D-c) have in
 * common, extracted when the second attachment arrived.
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
   * The credential of the RUN this attachment serves — the run's own
   * credential the server minted at dispatch (the OSS shape), or the
   * session-scoped sandbox token a cloud runner holds. Both connection
   * shapes present it: as the Bearer on the bridge's per-request path,
   * and as the stdio child's startup credential (`stdioCredentialEnv`),
   * so what the child writes on the person's behalf is stamped as that
   * person and not refused as nobody's on a server that signs people in.
   * Null presents nothing (a run whose dispatch carried no credential).
   */
  credential: string | null;
  /**
   * The stigmer backend endpoint the stdio child dials
   * (config.stigmerBackendEndpoint). Only used for the OSS shape.
   */
  backendEndpoint: string;
}

/**
 * The mcp-server's startup-credential variable — the ONE name the stdio
 * child reads its bearer from (mcp-server/src/config.ts `STIGMER_API_KEY`;
 * the value is any bearer the server honours, an `stk_` key for an IDE
 * client, the run's credential here). Cross-repo string, pinned on both
 * sides (the TOOL_CALL_LIMIT precedent).
 */
export const STDIO_CREDENTIAL_ENV = "STIGMER_API_KEY";

/**
 * The stdio child's startup-credential entry: `{ STIGMER_API_KEY }` when the
 * attachment holds a credential, nothing when it holds none — so a
 * credential-less run's child environment is byte-for-byte today's, and
 * the two stdio shapes cannot disagree on the carrier.
 *
 * The exposure, stated once: the credential sits in a first-party child's
 * process environment on the runner host, readable by the same OS user.
 * That is the runner's own trust boundary (the runner process holds the
 * same credential), and the child is `stigmer mcp-server`, never a
 * third-party server — those receive only their declared env (oss#256,
 * mcp-manager.ts). The alternative was the operator's API key.
 */
export function stdioCredentialEnv(
  credential: string | null,
): Record<string, string> {
  return credential !== null && credential !== ""
    ? { [STDIO_CREDENTIAL_ENV]: credential }
    : {};
}

/**
 * Inject a synthesized attachment into a resolved server list — AFTER
 * resolve + backfill (see the module header). A user server shadowing
 * the reserved slug is replaced, loudly; `label` names the attachment
 * in that warning (e.g. "channel messaging").
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
