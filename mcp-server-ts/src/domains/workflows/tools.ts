// MCP tools for the Workflow domain (CRUD: get, apply, delete).
// Go parity: mcp-server/internal/domains/workflows/tools.go.
//
// The workflow-specific tools (validate_workflow_yaml, task-kind registry) live
// in sibling files.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkflowInputShape } from "../../gen/workflow";
import { resolveToken, type BackendTarget } from "../client";
import { textOrError } from "../toolresult";
import { applyWorkflow } from "./apply";
import { deleteWorkflow } from "./delete";
import { fetchWorkflow } from "./fetch";

/** Register the Workflow CRUD tools; returns the registered tool names. */
export function registerWorkflowTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_workflow",
    {
      description: "Get full details of a Stigmer workflow by its org and slug.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the workflow."),
        slug: z.string().describe("Workflow slug — unique identifier within the org."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchWorkflow(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
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

  return ["get_workflow", "apply_workflow", "delete_workflow"];
}
