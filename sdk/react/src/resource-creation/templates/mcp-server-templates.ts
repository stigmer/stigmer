import type { McpServerWizardData } from "../../mcp-server/steps/types.js";
import type { ResourceTemplate } from "./types.js";

/**
 * Built-in MCP server templates shipped with the SDK.
 *
 * Each template pre-fills the MCP server creation wizard with a
 * curated transport configuration, environment variable declarations,
 * and descriptive metadata. Users can customize every field after
 * selection.
 *
 * Platform builders can pass their own template arrays to the
 * gallery; these built-in templates are a convenience default.
 */
export const MCP_SERVER_TEMPLATES: readonly ResourceTemplate<McpServerWizardData>[] =
  [
    {
      id: "github",
      name: "GitHub",
      description:
        "Connect to the GitHub API for repository management, issue tracking, pull requests, and code search.",
      category: "integration",
      tags: ["github", "git", "repository", "api", "code"],
      data: {
        name: "GitHub",
        description:
          "GitHub API integration for repository management, issues, pull requests, and code search.",
        transportType: "http",
        httpUrl: "https://api.githubcopilot.com",
        env: [
          {
            key: "GITHUB_TOKEN",
            description:
              "GitHub personal access token with appropriate scopes.",
            isSecret: true,
            optional: false,
          },
        ],
      },
    },
    {
      id: "slack",
      name: "Slack",
      description:
        "Connect to the Slack API for sending messages, managing channels, and reading conversation history.",
      category: "integration",
      tags: ["slack", "messaging", "chat", "communication"],
      data: {
        name: "Slack",
        description:
          "Slack API integration for messaging, channel management, and conversation history.",
        transportType: "http",
        httpUrl: "https://slack.com/api/mcp",
        env: [
          {
            key: "SLACK_BOT_TOKEN",
            description: "Slack Bot User OAuth token (xoxb-...).",
            isSecret: true,
            optional: false,
          },
        ],
      },
    },
    {
      id: "neon",
      name: "Neon",
      description:
        "Connect to Neon's hosted MCP endpoint for serverless PostgreSQL — querying, schema inspection, and branch management.",
      category: "integration",
      tags: ["neon", "postgres", "postgresql", "database", "sql", "data"],
      data: {
        name: "Neon",
        description:
          "Neon serverless PostgreSQL — querying, schema inspection, database provisioning, and branch management.",
        transportType: "http",
        httpUrl: "https://mcp.neon.tech/mcp",
        env: [
          {
            key: "NEON_API_KEY",
            description:
              "Neon API key (generate at console.neon.tech/app/settings/api-keys).",
            isSecret: true,
            optional: false,
          },
        ],
      },
    },
    // Deliberately stdio: the canonical example of a tool that must run on
    // the user's own machine. Stdio servers are local-runner-only — the
    // wizard's transport step states this, and cloud-targeted sessions
    // refuse them at execution create.
    {
      id: "filesystem",
      name: "Filesystem (local runners)",
      description:
        "Provide read and write access to a local directory for file management and content operations. Runs on local runners only.",
      category: "general",
      tags: ["filesystem", "files", "local", "directory"],
      data: {
        name: "Filesystem",
        description:
          "Local filesystem access for reading, writing, and managing files within a directory. Stdio transport — runs on local runners only.",
        transportType: "stdio",
        stdioCommand: "npx",
        stdioArgs:
          "-y @modelcontextprotocol/server-filesystem /path/to/directory",
      },
    },
  ];
