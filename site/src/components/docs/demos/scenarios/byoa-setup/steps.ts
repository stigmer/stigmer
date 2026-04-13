/**
 * BYOA setup flow — walkthrough of overriding the platform's OAuth app
 * with an org-owned registration on a vendor-approval-blocked MCP server:
 *
 * Slack detail (vendor approval pending, sign-in disabled) → cursor
 * clicks "Use your own OAuth app" → BYOA dialog with OAuthAppForm →
 * cursor clicks Save → detail showing "Using your OAuth app" → connected
 * with tools discovered.
 *
 * Fixture data modeled after the real Slack MCP server seedpack entry
 * (vendor OAuth, HTTP transport, marketplace approval pending).
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
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/demo";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  GetOAuthGrantStatusOutput,
  GetOrgOAuthAppOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "mcp-server-slack";

// ---------------------------------------------------------------------------
// McpServer fixtures — Slack (from seedpack, vendor OAuth)
// ---------------------------------------------------------------------------

function buildSlackBase(): McpServer {
  const server = samples.mcpServer({
    name: "mcp-server-slack",
    org: DEMO_ORG,
    description:
      "Slack MCP server for searching channels, sending messages, managing canvases, and interacting with workspace data.",
  });

  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    iconUrl:
      "https://raw.githubusercontent.com/stigmer/stigmer/main/seedpack/icons/mcp-servers/slack.svg",
    tags: ["slack", "messaging", "communication", "collaboration"],
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.slack.com/mcp",
        headers: { Authorization: "Bearer ${SLACK_ACCESS_TOKEN}" },
      }),
    },
    env: {
      SLACK_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description:
          "Slack user OAuth token (requires a registered Slack app with appropriate scopes)",
      }),
    },
    auth: create(McpServerAuthSchema, {
      oauthAppRef: {
        org: "stigmer",
        kind: ApiResourceKind.oauth_app,
        slug: "slack-oauth",
      },
      targetEnvVar: "SLACK_ACCESS_TOKEN",
      tokenLifetimeHint: "never",
      scopeHints: ["channels:read", "chat:write", "users:read", "search:read"],
    }),
  });

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    oauthStatus: create(OAuthStatusSchema, {
      vendorApprovalStatus: VendorApprovalStatus.PENDING,
      vendorApprovalDocsUrl: "https://api.slack.com/authentication/oauth-v2",
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
      effectiveOauthAppId: "oauthapp_slack_platform",
    }),
  });

  return server;
}

function buildSlackOrgApp(): McpServer {
  const server = buildSlackBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    oauthStatus: create(OAuthStatusSchema, {
      vendorApprovalStatus: VendorApprovalStatus.APPROVED,
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_ORG_OVERRIDE,
      effectiveOauthAppId: "oauthapp_acme_slack",
    }),
  });

  return server;
}

function buildSlackConnected(): McpServer {
  const server = buildSlackOrgApp();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, {
          name: "send_message",
          description:
            "Send a message to a Slack channel or direct message conversation.",
        }),
        create(DiscoveredToolSchema, {
          name: "list_channels",
          description:
            "List public and private channels in the workspace with optional filtering.",
        }),
        create(DiscoveredToolSchema, {
          name: "search_messages",
          description:
            "Search for messages across channels matching a query string.",
        }),
        create(DiscoveredToolSchema, {
          name: "add_reaction",
          description: "Add an emoji reaction to a message in a channel.",
        }),
        create(DiscoveredToolSchema, {
          name: "get_channel_history",
          description:
            "Retrieve recent messages from a channel with pagination support.",
        }),
      ],
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "send_message",
        message: "Send message to {{args.channel}}",
      }),
      create(ToolApprovalPolicySchema, {
        toolName: "add_reaction",
        message: "React with :{{args.emoji}}: in {{args.channel}}",
      }),
    ],
    oauthStatus: create(OAuthStatusSchema, {
      vendorApprovalStatus: VendorApprovalStatus.APPROVED,
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_ORG_OVERRIDE,
      effectiveOauthAppId: "oauthapp_acme_slack",
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

const HEALTHY_GRANT = create(GetOAuthGrantStatusOutputSchema, {
  connected: true,
  targetEnvVar: "SLACK_ACCESS_TOKEN",
  authMethod: "vendor_oauth",
  connectionHealth:
    OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
});

// ---------------------------------------------------------------------------
// Org OAuth app fixtures
// ---------------------------------------------------------------------------

export const NO_ORG_OVERRIDE = create(GetOrgOAuthAppOutputSchema, {
  hasOverride: false,
});

export const HAS_ORG_OVERRIDE = create(GetOrgOAuthAppOutputSchema, {
  hasOverride: true,
  oauthAppId: "oauthapp_acme_slack",
  clientId: "7892341056.apps",
});

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type ByoaSetupStep =
  | { view: "detail-blocked"; server: McpServer; grant: GetOAuthGrantStatusOutput; orgApp: GetOrgOAuthAppOutput }
  | { view: "click-byoa-cta"; server: McpServer; grant: GetOAuthGrantStatusOutput; orgApp: GetOrgOAuthAppOutput }
  | { view: "byoa-dialog" }
  | { view: "click-save" }
  | { view: "detail-org-app"; server: McpServer; grant: GetOAuthGrantStatusOutput; orgApp: GetOrgOAuthAppOutput }
  | { view: "detail-connected"; server: McpServer; grant: GetOAuthGrantStatusOutput; orgApp: GetOrgOAuthAppOutput };

const blockedServer = buildSlackBase();
const orgAppServer = buildSlackOrgApp();
const connectedServer = buildSlackConnected();

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const byoaSetupSteps: ScenarioStep<ByoaSetupStep>[] = [
  {
    delayMs: 0,
    data: {
      view: "detail-blocked",
      server: blockedServer,
      grant: NO_GRANT,
      orgApp: NO_ORG_OVERRIDE,
    },
    caption:
      "Slack's OAuth sign-in is pending vendor approval",
    narration:
      "This MCP server uses vendor OAuth, but the platform's OAuth app is still waiting for Slack's marketplace approval. The sign-in button is disabled.",
  },
  {
    delayMs: 3500,
    data: {
      view: "click-byoa-cta",
      server: blockedServer,
      grant: NO_GRANT,
      orgApp: NO_ORG_OVERRIDE,
    },
    caption: "Click \"Use your own OAuth app\" to bypass the block",
  },
  {
    delayMs: 2500,
    data: { view: "byoa-dialog" },
    caption: "Enter your Slack app's client ID and secret",
    narration:
      "Register an OAuth app with Slack, then enter your client credentials here. Stigmer clones the endpoint URLs and scopes from the platform template — you only provide the client ID and secret.",
  },
  {
    delayMs: 3500,
    data: { view: "click-save" },
    caption: "Save to override the platform app for your Organization",
  },
  {
    delayMs: 2500,
    data: {
      view: "detail-org-app",
      server: orgAppServer,
      grant: NO_GRANT,
      orgApp: HAS_ORG_OVERRIDE,
    },
    caption: "\"Using your OAuth app\" — sign-in is now enabled",
    narration:
      "Your Organization's OAuth app replaces the platform default. The status shows \"Using your OAuth app\" and sign-in is enabled with your own credentials.",
  },
  {
    delayMs: 3500,
    data: {
      view: "detail-connected",
      server: connectedServer,
      grant: HEALTHY_GRANT,
      orgApp: HAS_ORG_OVERRIDE,
    },
    caption: "Connected — 5 tools discovered, 2 approval policies classified",
    narration:
      "After signing in with your own app, Stigmer connects to Slack, discovers its tools, and classifies approval policies. Read-only operations like searching and listing pass through automatically.",
  },
];
