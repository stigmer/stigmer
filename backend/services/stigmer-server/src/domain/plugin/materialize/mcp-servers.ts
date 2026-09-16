/**
 * MCP servers from a plugin: one `McpServer` per `mcpServers` entry of the
 * portable `mcp.json`, layered with the plugin's Stigmer overlay for that
 * server when the author wrote one (`ai.stigmer/mcp-servers/<name>.yaml`).
 *
 * The portable file owns what every client reads: the transport (`http`
 * url and headers, or `stdio` command and args) and the variables the
 * server references, which become `EnvVarDeclaration`s the runner resolves
 * from the user's Environment. The overlay owns what only Stigmer reads:
 * OAuth (`auth`), scope hints, default and pinned tools, the icon, tags,
 * the repository link, and a richer description. An overlay that sets the
 * transport or declares env is refused: the portable file is the one home
 * of both, so a Cursor or Claude user installing the same plugin sees the
 * same server.
 *
 * The server's name is the `mcpServers` key and its slug `generateSlug`
 * of it (the platform's one slug rule: lowercase, dots and spaces to
 * hyphens, every other symbol dropped, so `my_server` becomes `myserver`);
 * sub-agents and the agent's usages reference the slug.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginMcpServer, PluginPackage } from "@stigmer/plugin-package";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  HttpServerConfigSchema,
  McpServerSpecSchema,
  StdioServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";

import { generateSlug } from "../../../pipeline/steps/slug.js";
import { memberMetadata } from "./identity.js";
import type { PluginIdentity } from "./identity.js";

export interface PlannedMcpServer {
  readonly name: string;
  readonly slug: string;
  readonly resource: McpServer;
}

/** A refused overlay, phrased for the author. */
export class McpServerOverlayError extends Error {
  constructor(server: string, reason: string) {
    super(`overlay for MCP server '${server}': ${reason}`);
    this.name = "McpServerOverlayError";
  }
}

export function mcpServerSlugOf(server: PluginMcpServer): string {
  return generateSlug(server.name);
}

export function planMcpServers(
  plugin: PluginPackage,
  overlays: ReadonlyMap<string, McpServer>,
  identity: PluginIdentity,
): PlannedMcpServer[] {
  const env = declaredVariables(plugin);
  return plugin.mcpServers.map((server) => {
    const overlay = overlays.get(server.name);
    const spec = create(McpServerSpecSchema, {
      description: plugin.description ?? "",
      env: Object.fromEntries(
        server.env.map((name) => [name, env.get(name) ?? inferredSecret()]),
      ),
    });
    switch (server.transport) {
      case "http":
        spec.serverType = {
          case: "http",
          value: create(HttpServerConfigSchema, {
            url: server.url,
            headers: { ...server.headers },
          }),
        };
        break;
      case "stdio":
        spec.serverType = {
          case: "stdio",
          value: create(StdioServerConfigSchema, {
            command: server.command,
            args: [...server.args],
          }),
        };
        break;
      default: {
        const exhaustive: never = server;
        throw new Error(`unknown transport ${JSON.stringify(exhaustive)}`);
      }
    }

    if (overlay !== undefined) {
      layerOverlay(server.name, spec, overlay);
    }

    const slug = mcpServerSlugOf(server);
    return {
      name: server.name,
      slug,
      resource: create(McpServerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "McpServer",
        metadata: memberMetadata(
          identity,
          { name: server.name, slug },
          overlay?.metadata,
        ),
        spec,
      }),
    };
  });
}

/** Every declared variable, by name, as the runner's declaration shape. */
function declaredVariables(
  plugin: PluginPackage,
): Map<string, EnvVarDeclaration> {
  return new Map(
    plugin.variables.map((variable) => [
      variable.name,
      create(EnvVarDeclarationSchema, {
        isSecret: variable.isSecret,
        description: variable.description ?? "",
        optional: variable.optional,
      }),
    ]),
  );
}

/**
 * A reference the library did not declare cannot happen — it infers every
 * undeclared `${VAR}` as a required secret — so this arm is the honest
 * default for a name the declaration list somehow lacks.
 */
function inferredSecret(): EnvVarDeclaration {
  return create(EnvVarDeclarationSchema, { isSecret: true, optional: false });
}

/** The overlay's Stigmer-only fields over the portable spec; the portable owner's fields stay. */
function layerOverlay(
  serverName: string,
  spec: McpServerSpec,
  overlay: McpServer,
): void {
  const authored = overlay.spec;
  if (authored === undefined) {
    return;
  }
  if (authored.serverType.case !== undefined) {
    throw new McpServerOverlayError(
      serverName,
      "the transport (http or stdio) lives in mcp.json, where every client reads it; the overlay may not redefine it",
    );
  }
  if (Object.keys(authored.env).length > 0) {
    throw new McpServerOverlayError(
      serverName,
      "variables are declared where mcp.json references them (the plugin's variables or userConfig); the overlay may not declare env",
    );
  }
  if (authored.description !== "") spec.description = authored.description;
  if (authored.iconUrl !== "") spec.iconUrl = authored.iconUrl;
  if (authored.tags.length > 0) spec.tags = [...authored.tags];
  if (authored.defaultEnabledTools.length > 0)
    spec.defaultEnabledTools = [...authored.defaultEnabledTools];
  if (authored.pinnedToolApprovals.length > 0)
    spec.pinnedToolApprovals = [...authored.pinnedToolApprovals];
  if (authored.repositoryUrl !== "")
    spec.repositoryUrl = authored.repositoryUrl;
  if (authored.auth !== undefined) spec.auth = authored.auth;
}
