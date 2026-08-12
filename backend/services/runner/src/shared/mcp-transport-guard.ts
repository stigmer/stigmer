/**
 * Transport guard for MCP servers — stdio is local-runner-only.
 *
 * Why this is load-bearing: a stdio MCP server means "download a package
 * from a public registry at session start and run it as a subprocess with
 * the execution's secrets in its environment". On a local runner that
 * machine belongs to the user — their trust decision. On a managed cloud
 * runner it is a supply-chain exposure the platform owns, so hosted
 * execution is HTTP-only. The control plane refuses such executions at
 * create time (stigmer-cloud's McpTransportPolicy); this guard is the
 * defense-in-depth backstop at the moment a subprocess would actually be
 * spawned — it must hold even if a stdio usage reaches a cloud runner
 * through a path the control plane did not see.
 *
 * The posture derives from Config.mode ("cloud" → forbid stdio), NOT from
 * cloudModeEnabled — that is the Cursor cloud-agent feature flag and says
 * nothing about where this process runs. STIGMER_MCP_ALLOW_STDIO exists as
 * an explicit override so operators can roll the policy back without a
 * redeploy (the runner-side counterpart of the control plane's
 * stigmer.mcp.stdio-cloud-block kill-switch). Managed cloud deployments
 * never set it.
 *
 * A rejection is thrown as {@link McpTransportError} and must FAIL the
 * execution loudly: the resolvers' per-server catch blocks swallow
 * resolution failures into console.warn and continue, which would turn a
 * policy rejection into an agent silently losing tools. Both resolvers
 * rethrow this error type for exactly that reason.
 *
 * Mirrors the posture/override/error shape of tools/url-guard.ts (the
 * web_fetch SSRF boundary), the runner's established idiom for
 * mode-keyed guards.
 */

export type McpTransportPosture = "stdio-allowed" | "stdio-forbidden";

/** Thrown for every guard rejection; message is safe to surface to the user. */
export class McpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpTransportError";
  }
}

/**
 * Derive the transport posture from runner mode plus the explicit override.
 *
 * @param mode Config.mode — "cloud" means a managed runner on shared infrastructure.
 * @param env  Environment to read STIGMER_MCP_ALLOW_STDIO from.
 */
export function resolveMcpTransportPosture(
  mode: "local" | "cloud",
  env: NodeJS.ProcessEnv = process.env,
): McpTransportPosture {
  const override = env.STIGMER_MCP_ALLOW_STDIO;
  if (override === "true") return "stdio-allowed";
  if (override === "false") return "stdio-forbidden";
  return mode === "cloud" ? "stdio-forbidden" : "stdio-allowed";
}

/**
 * Assert that a resolved MCP server's transport is allowed under the given
 * posture. Applies only to user-defined McpServer resources flowing through
 * the resolvers — the internal synthesized attachments are built
 * separately and are already HTTP in cloud mode.
 *
 * @throws McpTransportError when the posture forbids stdio and the server uses it
 */
export function assertTransportAllowed(
  slug: string,
  connectionType: "stdio" | "http" | "sse",
  posture: McpTransportPosture,
): void {
  if (posture === "stdio-forbidden" && connectionType === "stdio") {
    throw new McpTransportError(
      `MCP server '${slug}' uses the stdio transport, which runs only on local ` +
      `runners — this cloud runner refuses to spawn it. Run the session on a ` +
      `local runner (session execution_target: local), or replace '${slug}' ` +
      `with a remote (HTTP) MCP server.`,
    );
  }
}
