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
      id: "postgresql",
      name: "PostgreSQL",
      description:
        "Connect to a PostgreSQL database for querying, schema inspection, and data management.",
      category: "integration",
      tags: ["postgres", "postgresql", "database", "sql", "data"],
      data: {
        name: "PostgreSQL",
        description:
          "PostgreSQL database connection for querying, schema inspection, and data management.",
        transportType: "stdio",
        stdioCommand: "npx",
        stdioArgs: "-y @modelcontextprotocol/server-postgres",
        env: [
          {
            key: "DATABASE_URL",
            description:
              "PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db).",
            isSecret: true,
            optional: false,
          },
        ],
      },
    },
    {
      id: "filesystem",
      name: "Filesystem",
      description:
        "Provide read and write access to a local directory for file management and content operations.",
      category: "general",
      tags: ["filesystem", "files", "local", "directory"],
      data: {
        name: "Filesystem",
        description:
          "Local filesystem access for reading, writing, and managing files within a directory.",
        transportType: "stdio",
        stdioCommand: "npx",
        stdioArgs:
          "-y @modelcontextprotocol/server-filesystem /path/to/directory",
      },
    },
  ];
