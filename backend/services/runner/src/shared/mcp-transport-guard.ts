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
 * The posture derives from Config.mode ("cloud" → forbid stdio).
 * STIGMER_MCP_ALLOW_STDIO exists as
 * an explicit override so operators can roll the policy back without a
 * redeploy (the runner-side counterpart of the control plane's
 * stigmer.mcp.stdio-cloud-block kill-switch). Managed cloud deployments
 * never set it.
 *
 * A conversation without a computer (`shared/computer.ts`) forbids stdio
 * on every runner, and the override does not reach it: a stdio server is a
 * program on the runner's machine, which such a conversation has none of
 * by its author's word, wherever it runs. The server refuses one at the
 * agent's save, at each conversation write and at each turn's create
 * (stigmer-server `domain/run/computer.ts`); this is the runner's own
 * wall, because the runner is what would start the program. Its refusal
 * has its own sentence, since the remedy is the agent's, not the runner's.
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

/**
 * `stdio-forbidden` is a runner's refusal (a cloud runner, or the
 * override); `no-computer` is the conversation's (it has no computer).
 */
export type McpTransportPosture = "stdio-allowed" | "stdio-forbidden" | "no-computer";

/** Thrown for every guard rejection; message is safe to surface to the user. */
export class McpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpTransportError";
  }
}

/**
 * Derive the transport posture from runner mode plus the explicit override,
 * for a conversation with a computer; one without is `no-computer`, whatever
 * the mode or the override.
 *
 * @param mode     Config.mode — "cloud" means a managed runner on shared infrastructure.
 * @param computer Whether the conversation has a computer (`shared/computer.ts`).
 * @param env      Environment to read STIGMER_MCP_ALLOW_STDIO from.
 */
export function resolveMcpTransportPosture(
  mode: "local" | "cloud",
  computer: boolean,
  env: NodeJS.ProcessEnv = process.env,
): McpTransportPosture {
  if (!computer) return "no-computer";
  const override = env.STIGMER_MCP_ALLOW_STDIO;
  if (override === "true") return "stdio-allowed";
  if (override === "false") return "stdio-forbidden";
  return mode === "cloud" ? "stdio-forbidden" : "stdio-allowed";
}

/**
 * Assert that a resolved MCP server's transport is allowed under the given
 * posture. Applies only to the servers plugins bring, flowing through the
 * resolvers — the internal synthesized attachments are built
 * separately and are already HTTP in cloud mode.
 *
 * @throws McpTransportError when the posture forbids stdio and the server uses it
 */
export function assertTransportAllowed(
  slug: string,
  connectionType: "stdio" | "http" | "sse",
  posture: McpTransportPosture,
): void {
  if (connectionType !== "stdio" || posture === "stdio-allowed") return;
  if (posture === "no-computer") {
    throw new McpTransportError(
      `MCP server '${slug}' uses the stdio transport: it is a program on this machine, which a ` +
      `conversation without a computer can't start. Replace '${slug}' with a remote (HTTP) MCP ` +
      `server, or give the agent a computer.`,
    );
  }
  throw new McpTransportError(
    `MCP server '${slug}' uses the stdio transport, which runs only on local ` +
    `runners — this cloud runner refuses to spawn it. Run the session on a ` +
    `local runner (session execution_target: local), or replace '${slug}' ` +
    `with a remote (HTTP) MCP server.`,
  );
}
