/**
 * The requests Stigmer sends an MCP endpoint it does not yet hold a
 * credential for: one complete `initialize`, and the `tools/list` the
 * catalogue audit follows an open handshake with.
 *
 * Complete, not minimal. A bare `initialize` with empty params never
 * reaches several hosted servers' authentication: Google's Gmail, Calendar,
 * Drive and BigQuery endpoints, GoDaddy's and Shopify's validate the
 * request first and answer HTTP 200 with a JSON-RPC error ("Missing
 * protocol version for Initialize"), so a probe that sent the bare request
 * called seven OAuth servers open (measured 2026-09-19 against the three
 * vendor catalogues; stigmer #1188 records the runner's copy of the
 * mistake). The request therefore carries the protocol version, empty
 * capabilities and a `clientInfo` that names the caller, so a vendor's
 * logs say which Stigmer process asked.
 *
 * `MCP_PROTOCOL_VERSION` is the revision the runner's client speaks. It is
 * a constant here rather than an import from the MCP SDK so this library
 * stays dependency-free; the runner pins the agreement in its own tests.
 */

/** The MCP protocol revision the handshake names. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** A JSON-RPC POST, ready to hand to `fetch` after adding a signal. */
export interface JsonRpcRequestInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The headers every request carries; the caller's headers are layered on top. */
function baseHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    ...(headers ?? {}),
  };
}

/**
 * A complete `initialize`. `clientName` names the process asking
 * (`stigmer-server`, `stigmer-runner`, `stigmer-catalogue-audit`); `headers`
 * are the endpoint's declared headers with any credential the caller holds.
 */
export function initializeRequest(clientName: string, headers?: Readonly<Record<string, string>>): JsonRpcRequestInit {
  return {
    method: "POST",
    headers: baseHeaders(headers),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: clientName, version: "0" },
      },
    }),
  };
}

/** The header a stateful server hands back on `initialize` and expects on every later request. */
export const MCP_SESSION_HEADER = "mcp-session-id";

/**
 * The anonymous `tools/list` that follows an open handshake, carrying the
 * session the server issued when it issued one. Used by the audit, which
 * measures what a user could reach without signing in; the control plane's
 * save-time probe stops at `initialize`.
 */
export function toolsListRequest(headers?: Readonly<Record<string, string>>, sessionId?: string): JsonRpcRequestInit {
  const merged = baseHeaders(headers);
  if (sessionId !== undefined) merged[MCP_SESSION_HEADER] = sessionId;
  return {
    method: "POST",
    headers: merged,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  };
}
