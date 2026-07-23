// MCP tools for the Workflow domain (CRUD: get, apply, delete) plus the
// versioning surface (version param on get, list_workflow_versions,
// tag_workflow_version). The CRUD names/descriptions are part of the original
// Go-parity contract (mcp-server/internal/domains/workflows/tools.go).
//
// The workflow-specific tools (validate_workflow_yaml, task-kind registry) live
// in sibling files.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkflowInputShape } from "../../gen/workflow.js";
import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { applyWorkflow } from "./apply.js";
import { deleteWorkflow } from "./delete.js";
import { fetchWorkflow } from "./fetch.js";
import { fetchWorkflowVersion, listWorkflowVersions, tagWorkflowVersion } from "./versions.js";

/** Register the Workflow CRUD tools; returns the registered tool names. */
export function registerWorkflowTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_workflow",
    {
      description:
        "Get full details of a Stigmer workflow by its org and slug. Pass 'version' (a full " +
        "SHA-256 version hash from list_workflow_versions) to fetch a historical version instead — " +
        "that returns the version entry with its validated YAML rather than the live workflow. " +
        "Tags are not accepted here; resolve a tag to its hash via list_workflow_versions first.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow."),
        slug: z.string().describe("Workflow slug — unique identifier within the org."),
        version: z
          .string()
          .optional()
          .describe(
            "Full 64-character SHA-256 version hash of a historical version. Omit for the live workflow.",
          ),
      },
    },
    (args, extra) =>
      textOrError(() => {
        const token = resolveToken(extra, target.apiKey);
        return args.version !== undefined && args.version !== ""
          ? fetchWorkflowVersion(target.serverAddress, token, args.org, args.slug, args.version)
          : fetchWorkflow(target.serverAddress, token, args.org, args.slug);
      }),
  );

  server.registerTool(
    "apply_workflow",
    {
      description:
        "Create or update a Stigmer workflow (idempotent). Provide identity fields (name, org) and workflow configuration (document, tasks, env, etc.).",
      inputSchema: WorkflowInputShape,
    },
    (args, extra) =>
      textOrError(() =>
        applyWorkflow(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "delete_workflow",
    {
      description: "Delete a Stigmer workflow by its org and slug. Returns the deleted workflow.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow."),
        slug: z.string().describe("Workflow slug — unique identifier within the org."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteWorkflow(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.org,
          args.slug,
        ),
      ),
  );

  server.registerTool(
    "list_workflow_versions",
    {
      description:
        "List a workflow's version history (newest first): version hash, tag, who applied it and " +
        "when, and which version is current. Every apply that changes the workflow creates a new " +
        "immutable version identified by its content hash. Entries omit the version YAML — fetch " +
        "one version's full content with get_workflow and its hash.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow."),
        slug: z.string().describe("Workflow slug — unique identifier within the org."),
        page_size: z
          .number()
          .int()
          .optional()
          .describe("Maximum versions per page (default 50, max 100)."),
        page_token: z
          .string()
          .optional()
          .describe("Pagination token from a previous response's next_page_token."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        listWorkflowVersions(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          slug: args.slug,
          pageSize: args.page_size,
          pageToken: args.page_token,
        }),
      ),
  );

  server.registerTool(
    "tag_workflow_version",
    {
      description:
        "Assign a tag (e.g. stable, production) to a specific workflow version. Tags are mutable " +
        "pointers: re-tagging with an existing name moves it from its previous version, and a " +
        "version holds at most one tag. Get version hashes from list_workflow_versions. Returns " +
        "the updated workflow.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow."),
        slug: z.string().describe("Workflow slug — unique identifier within the org."),
        version: z.string().describe("Full 64-character SHA-256 hash of the version to tag."),
        tag: z
          .string()
          .describe("Tag to assign: alphanumeric with dots, hyphens, or underscores (e.g. stable, v1.0)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        tagWorkflowVersion(target.serverAddress, resolveToken(extra, target.apiKey), {
          org: args.org,
          slug: args.slug,
          versionHash: args.version,
          tag: args.tag,
        }),
      ),
  );

  return [
    "get_workflow",
    "apply_workflow",
    "delete_workflow",
    "list_workflow_versions",
    "tag_workflow_version",
  ];
}
