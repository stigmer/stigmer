/**
 * Connect tour for "Connect an MCP Server" (the scenario id keeps its
 * historical name; the docs inventory keys the embed by it).
 *
 * A server lives in a plugin, so connecting one is opening the plugin
 * that holds it. Five beats: the Library's Plugins grid → cursor selects
 * Neon → the plugin's page, its one MCP server and the key it reads →
 * cursor on "Check tools" → the tools the server lists now, one of them
 * marked destructive by the server.
 *
 * Fixture data is modeled after real public MCP servers, so the Library
 * reads like one an organization would hold. The Neon server is an HTTP
 * server that reads one key, which the reader's My vault holds (by name;
 * a read never returns a value), so "Check tools" reaches it as the
 * person looking, the way the console does.
 */

import { create } from "@bufbuild/protobuf";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginDialect, PluginSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  PluginStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  ListPluginToolsOutputSchema,
  PluginToolSchema,
  type ListPluginToolsOutput,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { samples } from "@stigmer/react/test";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "neon";

/** The key Neon's server reads, which My vault holds by name. */
export const NEON_KEY = "NEON_API_KEY";

// ---------------------------------------------------------------------------
// Grid fixtures — plugins modeled after real public MCP servers
// ---------------------------------------------------------------------------

// The tour's own icons, served by the docs site from its public assets.
const ICON_BASE = "/tours/icons";

function pluginCard(index: number, name: string, slug: string, description: string): SearchResult {
  return samples.searchResult({
    id: `plg-00000000-0000-0000-0000-00000000000${index}`,
    org: DEMO_ORG,
    kind: ApiResourceKind.plugin,
    name,
    slug,
    description,
    iconUrl: `${ICON_BASE}/${slug}.svg`,
  });
}

export const MARKETPLACE_PLUGINS: readonly SearchResult[] = [
  pluginCard(1, "GitHub", "github", "Repository management, code search, issue and PR workflows, branch operations, and team collaboration."),
  pluginCard(2, "Slack", "slack", "Search channels, send messages, manage canvases, and interact with workspace data."),
  pluginCard(3, "Neon", "neon", "Serverless PostgreSQL management — branch creation, database provisioning, schema inspection, and SQL execution."),
  pluginCard(4, "Linear", "linear", "Issue tracking, project management, sprint planning, and team workflow automation."),
  pluginCard(5, "Tavily", "tavily", "Web search and content extraction optimized for AI agents and research workflows."),
  pluginCard(6, "Sentry", "sentry", "Access error reports, performance data, project configuration, and AI-powered issue analysis."),
  pluginCard(7, "Stripe", "stripe", "Payment processing, customer management, subscription operations, and financial data access."),
  pluginCard(8, "Figma", "figma", "Access design files, inspect components, extract design tokens, and navigate project structures."),
  pluginCard(9, "Notion", "notion", "Search pages, read content, manage databases, and organize workspace information."),
];

// ---------------------------------------------------------------------------
// Plugin fixture — Neon, one MCP server that reads one key
// ---------------------------------------------------------------------------

/** The Neon plugin as installed: one HTTP server, its key declared by name. */
export const NEON_PLUGIN: Plugin = create(PluginSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Plugin",
  metadata: create(ApiResourceMetadataSchema, {
    id: "plg-00000000-0000-0000-0000-000000000003",
    name: "neon",
    slug: DEMO_SLUG,
    org: DEMO_ORG,
  }),
  spec: create(PluginSpecSchema, {
    name: "neon",
    version: "1.2.0",
    description:
      "Neon's MCP server for serverless PostgreSQL: branch creation, database provisioning, schema inspection, and SQL execution.",
    homepage: "https://neon.tech",
    license: "MIT",
    dialect: PluginDialect.CLAUDE,
  }),
  status: create(PluginStatusSchema, {
    mcpServers: [
      create(McpServerEntrySchema, {
        name: "neon",
        transport: {
          case: "http",
          value: create(HttpMcpServerSchema, {
            url: "https://mcp.neon.tech/mcp",
            headers: { Authorization: `Bearer \${${NEON_KEY}}` },
          }),
        },
        env: [NEON_KEY],
      }),
    ],
    env: {
      [NEON_KEY]: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "Neon API key (generate at console.neon.tech/app/settings/api-keys)",
      }),
    },
  }),
});

/** What "Check tools" answers: the server's five tools, one marked destructive. */
export const NEON_TOOLS: ListPluginToolsOutput = create(ListPluginToolsOutputSchema, {
  tools: [
    create(PluginToolSchema, {
      name: "list_projects",
      description: "List all Neon projects in your account with their branches and databases.",
    }),
    create(PluginToolSchema, {
      name: "get_database_tables",
      description: "List all tables in a database with their schemas and row counts.",
    }),
    create(PluginToolSchema, {
      name: "describe_table_schema",
      description: "Show column definitions, types, constraints, and indexes for a specific table.",
    }),
    create(PluginToolSchema, {
      name: "explain_sql_statement",
      description: "Run EXPLAIN ANALYZE on a query and return the execution plan with timing data.",
    }),
    create(PluginToolSchema, {
      name: "run_sql",
      description: "Execute a SQL statement (including INSERT, UPDATE, DELETE, DDL) against a database.",
      destructive: true,
    }),
  ],
});

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type MarketplaceConnectStep =
  | { view: "grid-browse"; plugins: readonly SearchResult[] }
  | { view: "grid-select"; plugins: readonly SearchResult[]; targetSlug: string }
  | { view: "plugin-detail" }
  | { view: "click-check-tools" }
  | { view: "tools-listed" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const marketplaceConnectSteps: ScenarioStep<MarketplaceConnectStep>[] = [
  {
    delayMs: 0,
    data: { view: "grid-browse", plugins: MARKETPLACE_PLUGINS },
    narration:
      "Your Library lists every plugin your organization installed. A plugin is what you install and use whole: its skills, its agents and its MCP servers come with it.",
  },
  {
    delayMs: 3000,
    data: { view: "grid-select", plugins: MARKETPLACE_PLUGINS, targetSlug: DEMO_SLUG },
  },
  {
    delayMs: 2500,
    data: { view: "plugin-detail" },
    narration:
      "Neon's plugin holds one MCP server, which Stigmer reaches over HTTP at Neon's hosted endpoint. It reads one key, the Neon API key, which your vault holds.",
    interactions: [{ atPercent: 0.4, type: "scroll_to", target: "plugin-bottom" }],
  },
  {
    delayMs: 3500,
    data: { view: "click-check-tools" },
  },
  {
    delayMs: 3000,
    data: { view: "tools-listed" },
    narration:
      "Check tools asks the server for its tools right now. Run SQL is marked destructive, so the agent pauses and asks before it runs; the reads run on their own. A chat or an agent that uses the plugin gets every one of them.",
    interactions: [{ atPercent: 0.3, type: "scroll_to", target: "plugin-bottom" }],
  },
];
