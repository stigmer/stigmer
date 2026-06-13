// `connect mcp-server` orchestration. Mirrors Go's mcpserver.Connect (connect.go):
// resolve the server, then either push to the backend (the Connect RPC runs
// discovery server-side and persists capabilities + tool-approval policies) or,
// for --dry-run, discover locally and return without persisting.
//
// OAuth: the interactive browser flow is deferred (out of scope this round). When
// a server requires OAuth, has no existing grant, and no --env was supplied, we
// stop with actionable guidance instead of failing deep in the runner. Audit
// identity (reviewer) and token acquisition stay server-side by design.

import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema, GetOAuthGrantStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { DiscoveredCapabilities } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { defaultRegistry } from "../../registry/index.js";
import { buildRuntimeEnv } from "../mcp/runtime-env.js";
import { parseReference } from "../reference.js";
import { localDiscover } from "./discover.js";

export interface ConnectOptions {
  readonly reference: string;
  readonly org: string;
  readonly timeoutMs: number;
  readonly dryRun: boolean;
  readonly envOverrides: readonly string[];
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
    const capabilities = await localDiscover(server.spec, opts.envOverrides, opts.timeoutMs);
    return { server, capabilities, updated: undefined };
  }

  await ensureOAuthSatisfied(client, server, opts);

  const updated = await client.mcpServer.connect(
    create(ConnectInputSchema, {
      mcpServerId: server.metadata?.id ?? "",
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

// Stop with guidance when OAuth is required but unsatisfiable in this CLI: an
// auth-configured server with no existing grant and no --env credentials. The
// interactive browser flow is deferred, so we point the user at the alternatives.
async function ensureOAuthSatisfied(client: Stigmer, server: McpServer, opts: ConnectOptions): Promise<void> {
  if (!oauthRequired(server) || opts.envOverrides.length > 0) return;

  const status = await client.mcpServer.getOAuthGrantStatus(
    create(GetOAuthGrantStatusInputSchema, {
      resourceId: server.metadata?.id ?? "",
      org: opts.org,
    }),
  );
  if (status.connected) return;

  const slug = server.metadata?.slug ?? server.metadata?.name ?? opts.reference;
  throw new UsageError(
    `MCP server '${slug}' requires OAuth authentication, which is not yet available in this CLI.\n\n` +
      "To connect, choose one of:\n" +
      "  - Complete OAuth in the web console, then re-run this command\n" +
      `  - Provide credentials directly: stigmer connect mcp-server ${slug} --env TOKEN=...`,
  );
}

function oauthRequired(server: McpServer): boolean {
  return (server.spec?.auth?.targetEnvVar ?? "") !== "";
}
