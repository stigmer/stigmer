/**
 * Marketplace connect tour for "Connect from the marketplace".
 *
 * 6-step sequence: Library grid of MCP servers → cursor selects
 * Neon → detail view → cursor clicks Connect → tools
 * discovered → policies tab showing approval classifications.
 *
 * Fixture data drawn from real seedpack entries to give the
 * demo an authentic marketplace feel. The catalog is HTTP-only
 * (stdio MCP servers are local-runner-only and not shipped in
 * the marketplace), so every fixture uses the http transport.
 */

import { create } from "@bufbuild/protobuf";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/test";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "mcp-server-neon";

// ---------------------------------------------------------------------------
// Grid fixtures — drawn from real seedpack entries
// ---------------------------------------------------------------------------

const SEEDPACK_ICON_BASE =
  "https://raw.githubusercontent.com/stigmer/stigmer/main/seedpack/icons/mcp-servers";

export const MARKETPLACE_SERVERS: readonly SearchResult[] = [
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.mcp_server,
    name: "GitHub",
    slug: "mcp-server-github",
    description:
      "Repository management, code search, issue and PR workflows, branch operations, and team collaboration.",
    iconUrl: `${SEEDPACK_ICON_BASE}/github.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.mcp_server,
    name: "Slack",
    slug: "mcp-server-slack",
    description:
      "Search channels, send messages, manage canvases, and interact with workspace data.",
    iconUrl: `${SEEDPACK_ICON_BASE}/slack.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000003",
    kind: ApiResourceKind.mcp_server,
    name: "Neon",
    slug: "mcp-server-neon",
    description:
      "Serverless PostgreSQL management — branch creation, database provisioning, schema inspection, and SQL execution.",
    iconUrl: `${SEEDPACK_ICON_BASE}/neon.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000004",
    kind: ApiResourceKind.mcp_server,
    name: "Linear",
    slug: "mcp-server-linear",
    description:
      "Issue tracking, project management, sprint planning, and team workflow automation.",
    iconUrl: `${SEEDPACK_ICON_BASE}/linear.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000005",
    kind: ApiResourceKind.mcp_server,
    name: "Tavily",
    slug: "mcp-server-tavily",
    description:
      "Web search and content extraction optimized for AI agents and research workflows.",
    iconUrl: `${SEEDPACK_ICON_BASE}/tavily.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000006",
    kind: ApiResourceKind.mcp_server,
    name: "Sentry",
    slug: "mcp-server-sentry",
    description:
      "Access error reports, performance data, project configuration, and AI-powered issue analysis.",
    iconUrl: `${SEEDPACK_ICON_BASE}/sentry.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000007",
    kind: ApiResourceKind.mcp_server,
    name: "Stripe",
    slug: "mcp-server-stripe",
    description:
      "Payment processing, customer management, subscription operations, and financial data access.",
    iconUrl: `${SEEDPACK_ICON_BASE}/stripe.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000008",
    kind: ApiResourceKind.mcp_server,
    name: "Figma",
    slug: "mcp-server-figma",
    description:
      "Access design files, inspect components, extract design tokens, and navigate project structures.",
    iconUrl: `${SEEDPACK_ICON_BASE}/figma.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000009",
    kind: ApiResourceKind.mcp_server,
    name: "Notion",
    slug: "mcp-server-notion",
    description:
      "Search pages, read content, manage databases, and organize workspace information.",
    iconUrl: `${SEEDPACK_ICON_BASE}/notion.svg`,
  }),
];

// ---------------------------------------------------------------------------
// McpServer detail fixture — Neon (from seedpack)
// ---------------------------------------------------------------------------

function buildNeonBase(): McpServer {
  const server = samples.mcpServer({
    name: "mcp-server-neon",
    org: DEMO_ORG,
    description:
      "Neon MCP server for serverless PostgreSQL management including branch creation, database provisioning, schema inspection, and SQL execution.",
  });

  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    iconUrl: `${SEEDPACK_ICON_BASE}/neon.svg`,
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.neon.tech/mcp",
        headers: {
          Authorization: "Bearer ${NEON_API_KEY}",
        },
      }),
    },
    env: {
      NEON_API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description:
          "Neon API key (generate at console.neon.tech/app/settings/api-keys)",
      }),
    },
  });

  return server;
}

function buildNeonConnected(): McpServer {
  const server = buildNeonBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, {
          name: "list_projects",
          description:
            "List all Neon projects in your account with their branches and databases.",
        }),
        create(DiscoveredToolSchema, {
          name: "get_database_tables",
          description:
            "List all tables in a database with their schemas and row counts.",
        }),
        create(DiscoveredToolSchema, {
          name: "describe_table_schema",
          description:
            "Show column definitions, types, constraints, and indexes for a specific table.",
        }),
        create(DiscoveredToolSchema, {
          name: "explain_sql_statement",
          description:
            "Run EXPLAIN ANALYZE on a query and return the execution plan with timing data.",
        }),
        create(DiscoveredToolSchema, {
          name: "run_sql",
          description:
            "Execute a SQL statement (including INSERT, UPDATE, DELETE, DDL) against a database.",
        }),
      ],
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "run_sql",
        message:
          "Run SQL: {{args.sql}}",
      }),
    ],
  });

  return server;
}

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type MarketplaceConnectStep =
  | { view: "grid-browse"; servers: readonly SearchResult[] }
  | {
      view: "grid-select";
      servers: readonly SearchResult[];
      targetSlug: string;
    }
  | { view: "detail-view"; server: McpServer }
  | { view: "click-connect"; server: McpServer }
  | { view: "connected-tools"; server: McpServer }
  | { view: "connected-policies"; server: McpServer };

const baseServer = buildNeonBase();
const connectedServer = buildNeonConnected();

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const marketplaceConnectSteps: ScenarioStep<MarketplaceConnectStep>[] = [
  {
    delayMs: 0,
    data: { view: "grid-browse", servers: MARKETPLACE_SERVERS },
    narration:
      "The tool library is a curated catalog of remote MCP servers — from GitHub and Slack to databases, monitoring, and design tools.",
  },
  {
    delayMs: 3000,
    data: {
      view: "grid-select",
      servers: MARKETPLACE_SERVERS,
      targetSlug: "mcp-server-neon",
    },
  },
  {
    delayMs: 2500,
    data: { view: "detail-view", server: baseServer },
    narration:
      "Neon is a remote MCP server — Stigmer talks to Neon's hosted endpoint over HTTP. It needs an API key to authenticate.",
    interactions: [
      { atPercent: 0.4, type: "scroll_to", target: "capabilities-bottom" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "click-connect", server: baseServer },
  },
  {
    delayMs: 3000,
    data: { view: "connected-tools", server: connectedServer },
    narration:
      "Stigmer connected to the server, discovered five tools, and classified each one. Read operations like list_projects and describe_table_schema pass through automatically.",
    interactions: [
      { atPercent: 0.3, type: "scroll_to", target: "capabilities-bottom" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "connected-policies", server: connectedServer },
    narration:
      "Write operations get flagged for human approval. The agent will pause and ask before running any SQL that modifies your database.",
  },
];
