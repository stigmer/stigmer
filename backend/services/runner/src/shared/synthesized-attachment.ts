/**
 * Shared mechanics of runner-synthesized MCP attachments — the pieces
 * the channel messaging attachment and the conversation participation
 * attachment have in
 * common, extracted when the second attachment arrived.
 *
 * A synthesized attachment is a first-party MCP server entry the runner
 * builds itself (no plugin, no credential in any manifest) on a RESERVED
 * slug, with no plugin origin. Approval-freedom is structural, not
 * configured: the turn records its slug in `TurnMcp.platformServerSlugs`,
 * and the approval default reads destructive marks only from plugin
 * servers, so none of its tools ever asks. Its tools are the platform's,
 * outside every agent tool list. Callers inject AFTER the plugins' servers
 * resolve; every harness call site does.
 *
 * Where they connect ({@link platformBridge}): the bridge the runner was
 * given, else for a conversation with a computer a spawned `stigmer
 * mcp-server` stdio child, else the Stigmer server's own MCP lane on its
 * port, at the runner's backend endpoint under
 * {@link PLATFORM_MCP_LANE_PATH}. A conversation without a computer starts
 * no program, so the child is not its to start. Nobody configured the lane's
 * address, and a server from before the lane has none, so an attachment on
 * it is marked inferred (`ResolvedMcpServer.addressedByRunner`) and one that
 * does not answer leaves the turn without its tools and says so
 * ({@link platformToolsOffNotice}), where a configured bridge that does not
 * answer fails the turn as any server does.
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
  /**
   * True when `bridgeEndpoint` is the Stigmer server's MCP lane, inferred
   * from `backendEndpoint` rather than configured ({@link platformBridge}).
   */
  bridgeInferred?: boolean;
}

/**
 * The path the Stigmer server serves the platform's MCP rosters under on
 * its own port: `/v1/mcp/memory`, `/v1/mcp/channels`, `/v1/mcp/conversation`.
 * A cross-package string, pinned on both sides (the server's
 * `transport/mcp` lane).
 */
export const PLATFORM_MCP_LANE_PATH = "/v1/mcp";

/** The endpoints a turn's platform bridge is chosen from (the runner Config satisfies it). */
export interface PlatformBridgeEndpoints {
  readonly mcpBridgeEndpoint: string | null;
  readonly stigmerBackendEndpoint: string;
}

/**
 * Where a turn's platform attachments connect (the module header): the
 * configured bridge for every turn; none (the stdio child) for a
 * conversation with a computer on a runner without one; and the Stigmer
 * server's MCP lane, inferred from the backend endpoint, for one without a
 * computer.
 */
export function platformBridge(
  endpoints: PlatformBridgeEndpoints,
  computer: boolean,
): Pick<SynthesizedAttachmentOptions, "bridgeEndpoint" | "bridgeInferred"> {
  if (endpoints.mcpBridgeEndpoint !== null && endpoints.mcpBridgeEndpoint !== "") {
    return { bridgeEndpoint: endpoints.mcpBridgeEndpoint, bridgeInferred: false };
  }
  if (computer) return { bridgeEndpoint: null, bridgeInferred: false };
  return {
    bridgeEndpoint: endpoints.stigmerBackendEndpoint.replace(/\/+$/, "") + PLATFORM_MCP_LANE_PATH,
    bridgeInferred: true,
  };
}

/** How a bridge attachment's address was chosen, as its resolved server records it. */
export function bridgeAddressing(
  options: Pick<SynthesizedAttachmentOptions, "bridgeInferred">,
): Pick<ResolvedMcpServer, "addressedByRunner"> {
  return { addressedByRunner: options.bridgeInferred === true ? "inferred" : "known" };
}

/**
 * The transcript line of a turn that runs without the platform's own MCP
 * servers, with why: a SYSTEM note in the runtime's voice
 * (`transcript/events.ts`), never the agent's words.
 */
export function platformToolsOffNotice(reason: string): string {
  return `The platform's own tools (memory, channel messaging and the conversation tools) are off for this turn: ${reason}.`;
}

/** The reason {@link platformToolsOffNotice} gives when the inferred lane at `address` did not answer. */
export function serverDidNotAnswer(address: string): string {
  return `the Stigmer server didn't answer at ${address}`;
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
 * resolve (see the module header). A user server shadowing
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
