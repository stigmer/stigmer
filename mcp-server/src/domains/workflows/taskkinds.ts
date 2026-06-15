// Task-kind registry tools (get_task_kind_registry, get_task_kind).
// Go parity: mcp-server/internal/domains/workflows/task_registry.go.
//
// Both tools read the same registry via TaskKindRegistryQueryController;
// get_task_kind fetches the full registry then selects one descriptor by name
// (case-insensitive), exactly as the Go server does — there is no single-kind
// RPC.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  GetTaskKindRegistryResponseSchema,
  TaskKindDescriptorSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/task_kind_descriptor_pb";
import { TaskKindRegistryQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/task_kind_registry_query_pb";
import { z } from "zod";

import { resolveToken, withClient, type BackendTarget } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";
import { textOrError } from "../toolresult.js";

/** Register the task-kind registry tools; returns the registered tool names. */
export function registerTaskKindTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_task_kind_registry",
    {
      description:
        "Get the complete workflow task kind registry with all 20 task kind descriptors, field schemas, JSON Schemas, categories, examples, and output shapes.",
      inputSchema: {},
    },
    (_args, extra) =>
      textOrError(() => getTaskKindRegistry(target.serverAddress, resolveToken(extra, target.apiKey))),
  );

  server.registerTool(
    "get_task_kind",
    {
      description:
        "Get a single workflow task kind descriptor by name with field schemas, JSON Schema, examples, and output shape.",
      inputSchema: {
        kind: z
          .string()
          .describe(
            "Task kind name (one of: set_vars, http_call, grpc_call, activity_call, switch_case, for_each, fork, try_catch, listen, wait, raise_error, run_workflow, agent_call, llm_call, transform, human_input, validate, emit_event, notification, eval).",
          ),
      },
    },
    (args, extra) =>
      textOrError(() =>
        getTaskKind(target.serverAddress, resolveToken(extra, target.apiKey), args.kind),
      ),
  );

  return ["get_task_kind_registry", "get_task_kind"];
}

/** Fetch and marshal the full task-kind registry. */
async function getTaskKindRegistry(serverAddress: string, token: string): Promise<string> {
  return withClient(
    TaskKindRegistryQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const resp = await client.getTaskKindRegistry({}, callOptions);
        return toProtoJson(GetTaskKindRegistryResponseSchema, resp);
      } catch (err) {
        throw rpcError(err, "task kind registry");
      }
    },
  );
}

/** Fetch the registry and return the single descriptor matching `kind`. */
async function getTaskKind(serverAddress: string, token: string, kind: string): Promise<string> {
  if (kind === "") {
    throw new Error("kind is required");
  }
  return withClient(
    TaskKindRegistryQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      let resp;
      try {
        resp = await client.getTaskKindRegistry({}, callOptions);
      } catch (err) {
        throw rpcError(err, "task kind registry");
      }

      const normalized = kind.trim().toLowerCase();
      for (const desc of resp.descriptors) {
        if ((WorkflowTaskKind[desc.kind] ?? "").toLowerCase() === normalized) {
          return toProtoJson(TaskKindDescriptorSchema, desc);
        }
      }
      throw new Error(
        `task kind "${kind}" not found in registry; use get_task_kind_registry to see all available kinds`,
      );
    },
  );
}
