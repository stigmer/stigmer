/**
 * OAuth connect flow — walkthrough of connecting an OAuth-protected
 * MCP server:
 *
 * MCP server detail (pre-connect, "Sign in to connect") → cursor
 * clicks sign-in → GitHub authorization page → connected detail
 * with tools discovered → credential status showing healthy token.
 *
 * Fixture data modeled after the real GitHub MCP server seedpack
 * entry (vendor OAuth, HTTP transport).
 */

import { create } from "@bufbuild/protobuf";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
  McpServerAuthSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
  OAuthStatusSchema,
  OAuthAppSource,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  GetOrgOAuthAppOutputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/demo";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { GetOAuthGrantStatusOutput, GetOrgOAuthAppOutput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "mcp-server-github";

// ---------------------------------------------------------------------------
// McpServer fixtures — GitHub (from seedpack, vendor OAuth)
// ---------------------------------------------------------------------------

function buildGitHubBase(): McpServer {
  const server = samples.mcpServer({
    name: "mcp-server-github",
    org: DEMO_ORG,
    description:
      "GitHub MCP server for repository management, code search, issue and PR workflows, branch operations, and team collaboration.",
  });

  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    iconUrl:
      "https://raw.githubusercontent.com/stigmer/stigmer/main/seedpack/icons/mcp-servers/github.svg",
    repositoryUrl: "https://github.com/github/github-mcp-server",
    githubStars: 28600,
    tags: ["github", "git", "version-control", "code-review"],
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_ACCESS_TOKEN}" },
      }),
    },
    env: {
      GITHUB_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description:
          "GitHub OAuth token or personal access token (generate at github.com/settings/tokens)",
      }),
    },
    auth: create(McpServerAuthSchema, {
      oauthAppRef: {
        org: "stigmer",
        kind: ApiResourceKind.oauth_app,
        slug: "github-oauth",
      },
      targetEnvVar: "GITHUB_ACCESS_TOKEN",
      tokenLifetimeHint: "8h",
      scopeHints: ["repo", "read:org", "read:user"],
    }),
  });

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    oauthStatus: create(OAuthStatusSchema, {
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
      effectiveOauthAppId: "oauthapp_github_platform",
    }),
  });

  return server;
}

function buildGitHubConnected(): McpServer {
  const server = buildGitHubBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, {
          name: "create_issue",
          description:
            "Create a new issue in a GitHub repository with title, body, labels, and assignees.",
        }),
        create(DiscoveredToolSchema, {
          name: "search_repositories",
          description:
            "Search for GitHub repositories by name, topic, language, or other criteria.",
        }),
        create(DiscoveredToolSchema, {
          name: "create_pull_request",
          description:
            "Open a pull request with a title, body, source branch, and target branch.",
        }),
        create(DiscoveredToolSchema, {
          name: "get_file_contents",
          description:
            "Retrieve the contents of a file or directory from a repository at a specific ref.",
        }),
        create(DiscoveredToolSchema, {
          name: "list_commits",
          description:
            "List commits on a branch with author, date, and message for each entry.",
        }),
        create(DiscoveredToolSchema, {
          name: "push_files",
          description:
            "Create or update multiple files in a repository in a single commit.",
        }),
      ],
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "create_issue",
        message: "Create issue: {{args.title}} in {{args.repo}}",
      }),
      create(ToolApprovalPolicySchema, {
        toolName: "create_pull_request",
        message: "Open PR: {{args.title}} ({{args.head}} → {{args.base}})",
      }),
      create(ToolApprovalPolicySchema, {
        toolName: "push_files",
        message: "Push files to {{args.repo}} on {{args.branch}}",
      }),
    ],
    oauthStatus: create(OAuthStatusSchema, {
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
      effectiveOauthAppId: "oauthapp_github_platform",
    }),
  });

  return server;
}

// ---------------------------------------------------------------------------
// OAuth grant status fixtures
// ---------------------------------------------------------------------------

export const NO_GRANT = create(GetOAuthGrantStatusOutputSchema, {
  connected: false,
  connectionHealth:
    OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
});

const EIGHT_HOURS_FROM_NOW = BigInt(
  Math.floor(Date.now() / 1000) + 8 * 60 * 60,
);

export const HEALTHY_GRANT = create(GetOAuthGrantStatusOutputSchema, {
  connected: true,
  accessTokenExpiresAt: EIGHT_HOURS_FROM_NOW,
  targetEnvVar: "GITHUB_ACCESS_TOKEN",
  authMethod: "vendor_oauth",
  connectionHealth:
    OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
});

// ---------------------------------------------------------------------------
// Org OAuth app fixture (no BYOA override)
// ---------------------------------------------------------------------------

export const NO_ORG_OVERRIDE = create(GetOrgOAuthAppOutputSchema, {
  hasOverride: false,
});

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type OAuthConnectStep =
  | { view: "detail-preconnect"; server: McpServer; grant: GetOAuthGrantStatusOutput }
  | { view: "click-sign-in"; server: McpServer; grant: GetOAuthGrantStatusOutput }
  | { view: "github-authorize" }
  | { view: "detail-connected"; server: McpServer; grant: GetOAuthGrantStatusOutput }
  | { view: "connected-policies"; server: McpServer; grant: GetOAuthGrantStatusOutput };

const baseServer = buildGitHubBase();
const connectedServer = buildGitHubConnected();

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const oauthConnectSteps: ScenarioStep<OAuthConnectStep>[] = [
  {
    delayMs: 0,
    data: {
      view: "detail-preconnect",
      server: baseServer,
      grant: NO_GRANT,
    },
    caption:
      "GitHub requires OAuth — the detail view shows \"Sign in to connect\"",
    narration:
      "This MCP server uses OAuth authentication. Instead of entering a token manually, you sign in through GitHub and Stigmer handles the rest.",
  },
  {
    delayMs: 3500,
    data: {
      view: "click-sign-in",
      server: baseServer,
      grant: NO_GRANT,
    },
    caption: "Click \"Sign in to connect\" to start the OAuth flow",
  },
  {
    delayMs: 2500,
    data: { view: "github-authorize" },
    caption: "Authorize Stigmer in the popup window",
    narration:
      "A popup opens to GitHub's authorization page. You review the requested permissions and authorize. Stigmer never sees your GitHub password.",
  },
  {
    delayMs: 3500,
    data: {
      view: "detail-connected",
      server: connectedServer,
      grant: HEALTHY_GRANT,
    },
    caption: "Connected — 6 tools discovered, 3 approval policies classified",
    narration:
      "After authorization, Stigmer exchanges the code for a token, stores it securely, connects to the server, and discovers its tools. Read-only operations pass through automatically.",
  },
  {
    delayMs: 3500,
    data: {
      view: "connected-policies",
      server: connectedServer,
      grant: HEALTHY_GRANT,
    },
    caption: "Write operations require human approval",
    narration:
      "Operations that modify your repositories — creating issues, opening pull requests, pushing files — are flagged for human approval before execution.",
  },
];
