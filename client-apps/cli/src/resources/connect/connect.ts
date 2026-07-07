// `connect mcp-server` orchestration. Mirrors Go's mcpserver.Connect (connect.go):
// resolve the server, then either push to the backend (the Connect RPC runs
// discovery server-side and persists capabilities + tool-approval policies) or,
// for --dry-run, discover locally and return without persisting.
//
// OAuth: when a server requires OAuth, has no existing grant, and no --env was
// supplied, the interactive browser flow (oauth.ts) shepherds the user through
// the web console and waits for the grant. Off an interactive terminal (CI,
// pipes) we stop with actionable guidance instead of blocking for 5 minutes.
// Audit identity (reviewer) and token acquisition stay server-side by design.

import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema, GetOAuthGrantStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { DiscoveredCapabilities } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { BackendType } from "../../config/config.js";
import { UsageError } from "../../errors/index.js";
import { defaultRegistry } from "../../registry/index.js";
import { PlaceholderResolutionError } from "../mcp/placeholder-resolver.js";
import { buildRuntimeEnv } from "../mcp/runtime-env.js";
import { parseReference } from "../reference.js";
import { localDiscover } from "./discover.js";

export interface ConnectOptions {
  readonly reference: string;
  readonly org: string;
  readonly timeoutMs: number;
  readonly dryRun: boolean;
  readonly envOverrides: readonly string[];
  /** Backend type, for resolving the OAuth web-console URL. */
  readonly backendType: BackendType;
  /** Whether an interactive terminal is available to run the OAuth flow. */
  readonly interactive: boolean;
}

export interface ConnectResult {
  readonly server: McpServer;
  readonly capabilities: DiscoveredCapabilities | undefined;
  /** Set when capabilities were persisted (non-dry-run); undefined for dry-run. */
  readonly updated: McpServer | undefined;
}

/** Connect to an MCP server and discover its capabilities (push or dry-run). */
export async function connectMcpServer(client: Stigmer, opts: ConnectOptions): Promise<ConnectResult> {
  const server = await resolveMcpServer(client, opts.reference, opts.org);

  if (opts.dryRun) {
    if (server.spec === undefined) throw new UsageError("MCP server has no spec; cannot discover capabilities");
    try {
      const capabilities = await localDiscover(server.spec, opts.envOverrides, opts.timeoutMs);
      return { server, capabilities, updated: undefined };
    } catch (err) {
      // A ${VAR} placeholder that could not be resolved is a configuration
      // problem, not a discovery failure — surface it as actionable guidance
      // instead of a raw resolver error or a cryptic subprocess crash.
      if (err instanceof PlaceholderResolutionError) throw unresolvedEnvError(server, err);
      throw err;
    }
  }

  await ensureOAuthSatisfied(client, server, opts);

  const updated = await client.mcpServer.connect(
    create(ConnectInputSchema, {
      mcpServerId: server.metadata?.id ?? "",
      org: opts.org,
      runtimeEnv: buildRuntimeEnv(server, opts.envOverrides),
    }),
  );
  return { server, capabilities: updated.status?.discoveredCapabilities, updated };
}

// Resolve a reference (id, org/slug, or bare slug) to an McpServer. Mirrors Go's
// GetFromBackend.
async function resolveMcpServer(client: Stigmer, reference: string, org: string): Promise<McpServer> {
  const idPrefix = defaultRegistry().getByAlias("mcp-server")?.idPrefix ?? "";
  const parsed = parseReference(reference, org, idPrefix);
  if (parsed.kind === "id") return client.mcpServer.get(parsed.id);
  return client.mcpServer.getByReference({ org: parsed.org, slug: parsed.slug });
}

// Ensure an OAuth grant exists before connecting an auth-configured server that
// was given no --env credentials. On an interactive terminal, run the browser
// flow and wait for the grant; otherwise stop with actionable guidance so
// scripted callers get a clean, stable failure instead of a 5-minute block.
async function ensureOAuthSatisfied(client: Stigmer, server: McpServer, opts: ConnectOptions): Promise<void> {
  if (!oauthRequired(server) || opts.envOverrides.length > 0) return;

  const status = await client.mcpServer.getOAuthGrantStatus(
    create(GetOAuthGrantStatusInputSchema, {
      resourceId: server.metadata?.id ?? "",
      org: opts.org,
    }),
  );
  if (status.connected) return;

  if (!opts.interactive) throw oauthGuidanceError(server, opts.reference);

  const { runOAuthFlow } = await import("./oauth.js");
  await runOAuthFlow({ client, server, org: opts.org, backendType: opts.backendType });
}

// Turn a strict-resolution failure into actionable guidance. A declared-but-unset
// variable is the user's to provide; an undeclared one is a bug in the server
// definition. Both are far clearer than the cryptic subprocess crash (ENOENT on a
// literal "${VAR}" path) that motivated issue #141.
function unresolvedEnvError(server: McpServer, err: PlaceholderResolutionError): UsageError {
  const slug = server.metadata?.slug ?? server.metadata?.name ?? server.metadata?.id ?? "this server";
  const decl = server.spec?.env?.[err.variableName];
  if (decl) {
    const hint = decl.description !== "" ? ` (${decl.description})` : "";
    return new UsageError(
      `MCP server '${slug}' needs environment variable ${err.variableName}${hint}, but it is not set.\n` +
        `Provide it with --env ${err.variableName}=<value> or export it in your shell before running --dry-run.`,
    );
  }
  const where = err.context !== undefined ? ` in its ${err.context}` : "";
  return new UsageError(
    `MCP server '${slug}' references \${${err.variableName}}${where} but does not declare ${err.variableName} under spec.env.\n` +
      `This is a problem with the server definition — declare ${err.variableName} in the server's env, or remove the placeholder.`,
  );
}

function oauthGuidanceError(server: McpServer, reference: string): UsageError {
  const slug = server.metadata?.slug ?? server.metadata?.name ?? reference;
  return new UsageError(
    `MCP server '${slug}' requires OAuth authentication, which needs an interactive terminal.\n\n` +
      "To connect, choose one of:\n" +
      "  - Re-run this command in an interactive terminal to complete OAuth in your browser\n" +
      `  - Provide credentials directly: stigmer connect mcp-server ${slug} --env TOKEN=...`,
  );
}

function oauthRequired(server: McpServer): boolean {
  return (server.spec?.auth?.targetEnvVar ?? "") !== "";
}
