/**
 * OAuth connect flow: signing in to an MCP server that signs in with
 * OAuth, from the page of the plugin that holds it.
 *
 * The plugin's page (its one server "Not signed in", a Sign in button) →
 * cursor on Sign in → GitHub's authorization page → the page again, the
 * server "Signed in" from the login My vault now holds at its address,
 * and "Check tools" listing what the server offers.
 *
 * Fixture data is modeled after the GitHub MCP server (HTTP, vendor
 * OAuth). Which My vault the page reads is step data: nothing saved before
 * the sign-in, the login at the server's address after it (its token
 * blanked, as every read blanks it).
 */

import { create } from "@bufbuild/protobuf";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginDialect, PluginSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  McpServerSignInSchema,
  PluginStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  ListPluginToolsOutputSchema,
  PluginToolSchema,
  type ListPluginToolsOutput,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "github";

/** The server's name in the plugin: its Sign in button reads "Sign in to github". */
export const SERVER_NAME = "github";

/** The address the login is saved at: the server's URL, normalized as the vault normalizes it. */
export const SERVER_ADDRESS = "https://api.githubcopilot.com/mcp";

// ---------------------------------------------------------------------------
// Plugin fixture — GitHub, one MCP server that signs in
// ---------------------------------------------------------------------------

export const GITHUB_PLUGIN: Plugin = create(PluginSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Plugin",
  metadata: create(ApiResourceMetadataSchema, {
    id: "plg-00000000-0000-0000-0000-000000000001",
    name: "github",
    slug: DEMO_SLUG,
    org: DEMO_ORG,
  }),
  spec: create(PluginSpecSchema, {
    name: "github",
    version: "1.0.0",
    description:
      "GitHub's MCP server for repository management, code search, issue and PR workflows, branch operations, and team collaboration.",
    repository: "https://github.com/github/github-mcp-server",
    license: "MIT",
    dialect: PluginDialect.CLAUDE,
  }),
  status: create(PluginStatusSchema, {
    mcpServers: [
      create(McpServerEntrySchema, {
        name: SERVER_NAME,
        transport: {
          case: "http",
          value: create(HttpMcpServerSchema, { url: "https://api.githubcopilot.com/mcp/" }),
        },
        signIn: create(McpServerSignInSchema, {}),
      }),
    ],
  }),
});

/** What "Check tools" answers once signed in. */
export const GITHUB_TOOLS: ListPluginToolsOutput = create(ListPluginToolsOutputSchema, {
  tools: [
    create(PluginToolSchema, {
      name: "create_issue",
      description: "Create a new issue in a GitHub repository with title, body, labels, and assignees.",
    }),
    create(PluginToolSchema, {
      name: "search_repositories",
      description: "Search for GitHub repositories by name, topic, language, or other criteria.",
    }),
    create(PluginToolSchema, {
      name: "create_pull_request",
      description: "Open a pull request with a title, body, source branch, and target branch.",
    }),
    create(PluginToolSchema, {
      name: "get_file_contents",
      description: "Retrieve the contents of a file or directory from a repository at a specific ref.",
    }),
    create(PluginToolSchema, {
      name: "list_commits",
      description: "List commits on a branch with author, date, and message for each entry.",
    }),
    create(PluginToolSchema, {
      name: "push_files",
      description: "Create or update multiple files in a repository in a single commit.",
      destructive: true,
    }),
  ],
});

// ---------------------------------------------------------------------------
// Step data model
// ---------------------------------------------------------------------------

export type OAuthConnectStep =
  | { view: "detail-signed-out" }
  | { view: "click-sign-in" }
  | { view: "github-authorize" }
  | { view: "detail-signed-in" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const oauthConnectSteps: ScenarioStep<OAuthConnectStep>[] = [
  {
    delayMs: 0,
    data: { view: "detail-signed-out" },
    narration:
      "GitHub's plugin holds one MCP server that signs in with OAuth. Instead of pasting a token, you sign in through GitHub, right from the plugin's page.",
    interactions: [
      { atPercent: 0.4, type: "scroll_to", target: "plugin-bottom" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "click-sign-in" },
  },
  {
    delayMs: 2500,
    data: { view: "github-authorize" },
    narration:
      "A popup opens to GitHub's authorization page. You review the requested permissions and authorize. Stigmer never sees your GitHub password.",
  },
  {
    delayMs: 3500,
    data: { view: "detail-signed-in" },
    narration:
      "The login is saved in your vault at the server's address, so every chat that uses the plugin reaches GitHub as you. Check tools lists what the server offers; only a tool it marks destructive asks for approval before it runs.",
    interactions: [
      { atPercent: 0.35, type: "scroll_to", target: "plugin-bottom" },
    ],
  },
];
