// MCP tools for the Skill domain.
// Go parity: mcp-server/internal/domains/skills/tools.go.
//
// Skills are read-only over MCP (search/get/delete); creation/update happens via
// `stigmer skill push` (content hashing, diffing, tag management). `version` is
// optional — omit it for the latest version.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { deleteSkill } from "./delete.js";
import { fetchSkill } from "./fetch.js";
import { listSkillVersions } from "./versions.js";

/** Register every Skill-domain tool; returns the registered tool names. */
export function registerSkillTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_skill",
    {
      description:
        "Get full details of a Stigmer skill by org and slug, optionally at a specific version. " +
        "Omit 'version' for the latest.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the skill."),
        slug: z.string().describe("Skill slug — unique identifier within the org."),
        version: z
          .string()
          .optional()
          .describe("Version to retrieve: tag name (e.g. stable) or SHA-256 hash. Omit for latest."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        // Empty string means "latest", matching the Go handler passing input.Version.
        fetchSkill(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.org,
          args.slug,
          args.version ?? "",
        ),
      ),
  );

  server.registerTool(
    "delete_skill",
    {
      description:
        "Delete a Stigmer skill and all its versions by org and slug. To create or update skills, use the 'stigmer skill push' CLI command. Returns the deleted skill.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the skill (e.g. stigmer)."),
        slug: z
          .string()
          .describe(
            "Skill slug — the unique identifier within the org (e.g. code-review-best-practices). Deletes the skill and all its versions.",
          ),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteSkill(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "list_skill_versions",
    {
      description:
        "List a skill's version history (newest first): version hash, tag, who pushed it and " +
        "when, and which version is current. Fetch one version's full content with get_skill and " +
        "its hash or tag.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the skill."),
        slug: z.string().describe("Skill slug — unique identifier within the org."),
        page_size: z
          .number()
          .int()
          .optional()
          .describe("Maximum versions per page (default 50)."),
        page_token: z
          .string()
          .optional()
          .describe("Pagination token from a previous response's next_page_token."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        listSkillVersions(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          slug: args.slug,
          pageSize: args.page_size,
          pageToken: args.page_token,
        }),
      ),
  );

  return ["get_skill", "delete_skill", "list_skill_versions"];
}
