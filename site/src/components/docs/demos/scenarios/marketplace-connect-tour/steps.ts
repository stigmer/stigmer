/**
 * Marketplace connect tour for "Connect from the marketplace".
 *
 * 6-step sequence: Library grid of MCP servers → cursor selects
 * PostgreSQL → detail view → cursor clicks Connect → tools
 * discovered → policies tab showing approval classifications.
 *
 * Fixture data drawn from real seedpack entries to give the
 * demo an authentic marketplace feel.
 */

import { create } from "@bufbuild/protobuf";
import {
  McpServerSpecSchema,
  StdioServerConfigSchema,
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
import { samples } from "@stigmer/react/demo";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "mcp-server-postgres";

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
    name: "PostgreSQL",
    slug: "mcp-server-postgres",
    description:
      "Database exploration, schema inspection, query execution, index tuning, and performance analysis.",
    iconUrl: `${SEEDPACK_ICON_BASE}/postgresql.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000004",
    kind: ApiResourceKind.mcp_server,
    name: "Playwright",
    slug: "mcp-server-playwright",
    description:
      "Browser automation, web testing, page navigation, element interaction, and screenshot capture.",
    iconUrl: `${SEEDPACK_ICON_BASE}/playwright.svg`,
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000005",
    kind: ApiResourceKind.mcp_server,
    name: "Fetch",
    slug: "mcp-server-fetch",
    description:
      "Retrieve web content and convert it to formats optimized for LLM consumption.",
    iconUrl: `${SEEDPACK_ICON_BASE}/curl.svg`,
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
// McpServer detail fixture — PostgreSQL (from seedpack)
// ---------------------------------------------------------------------------

function buildPostgresBase(): McpServer {
  const server = samples.mcpServer({
    name: "mcp-server-postgres",
    org: DEMO_ORG,
    description:
      "PostgreSQL MCP server for database exploration, schema inspection, query execution, index tuning, and performance analysis.",
  });

  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    iconUrl: `${SEEDPACK_ICON_BASE}/postgresql.svg`,
    serverType: {
      case: "stdio",
      value: create(StdioServerConfigSchema, {
        command: "uvx",
        args: ["postgres-mcp", "--url", "${POSTGRES_CONNECTION_URL}"],
      }),
    },
    env: {
      POSTGRES_CONNECTION_URL: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description:
          "PostgreSQL connection URL (e.g., postgresql://user:password@localhost:5432/dbname)",
      }),
    },
  });

  return server;
}

function buildPostgresConnected(): McpServer {
  const server = buildPostgresBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, {
          name: "query",
          description:
            "Execute a read-only SQL query against the connected PostgreSQL database and return results.",
        }),
        create(DiscoveredToolSchema, {
          name: "list_tables",
          description:
            "List all tables in the database with their schemas, row counts, and sizes.",
        }),
        create(DiscoveredToolSchema, {
          name: "describe_table",
          description:
            "Show column definitions, types, constraints, and indexes for a specific table.",
        }),
        create(DiscoveredToolSchema, {
          name: "explain_query",
          description:
            "Run EXPLAIN ANALYZE on a query and return the execution plan with timing data.",
        }),
        create(DiscoveredToolSchema, {
          name: "execute_sql",
          description:
            "Execute a read-write SQL statement (INSERT, UPDATE, DELETE, DDL) against the database.",
        }),
      ],
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "execute_sql",
        message:
          "Execute SQL: {{args.sql}}",
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

const baseServer = buildPostgresBase();
const connectedServer = buildPostgresConnected();

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const marketplaceConnectSteps: ScenarioStep<MarketplaceConnectStep>[] = [
  {
    delayMs: 0,
    data: { view: "grid-browse", servers: MARKETPLACE_SERVERS },
    caption: "The tool library shows available MCP servers",
    narration:
      "The tool library is a curated catalog of MCP servers — from GitHub and Slack to databases, monitoring, and design tools.",
  },
  {
    delayMs: 3000,
    data: {
      view: "grid-select",
      servers: MARKETPLACE_SERVERS,
      targetSlug: "mcp-server-postgres",
    },
    caption: "Select a server to see its details",
  },
  {
    delayMs: 2500,
    data: { view: "detail-view", server: baseServer },
    caption: "The detail view shows transport and environment requirements",
    narration:
      "PostgreSQL uses stdio transport — Stigmer launches the server locally and communicates over stdin and stdout. It needs a connection URL to reach your database.",
    interactions: [
      { atPercent: 0.4, type: "scroll_to", target: "capabilities-bottom" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "click-connect", server: baseServer },
    caption: 'Click "Connect" to discover tools',
  },
  {
    delayMs: 3000,
    data: { view: "connected-tools", server: connectedServer },
    caption: "5 tools discovered, approval policies classified",
    narration:
      "Stigmer connected to the server, discovered five tools, and classified each one. Read operations like query and list_tables pass through automatically.",
    interactions: [
      { atPercent: 0.3, type: "scroll_to", target: "capabilities-bottom" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "connected-policies", server: connectedServer },
    caption: "execute_sql requires human approval",
    narration:
      "Write operations get flagged for human approval. The agent will pause and ask before running any SQL that modifies your database.",
  },
];
