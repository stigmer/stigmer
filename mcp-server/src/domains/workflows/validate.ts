// The validate_workflow_yaml tool.
// Go parity: mcp-server/internal/domains/workflows/validate.go.
//
// The YAML is parsed to a Workflow proto locally (string task kinds are checked
// against the accepted set), then validated server-side via
// WorkflowCommandController.validateSpec — the same Temporal-based pipeline used
// by workflow create/update.
//
// Parity note (Go D4): the Go server's taskKindNameToEnum map is an identity map
// that omits `eval`, so Go rejects valid `eval` tasks. We derive the accepted
// set directly from the WorkflowTaskKind enum's value names instead — identical
// behavior for the other 19 kinds AND correct for `eval`. Flagged for the Go
// side as a T03 follow-up.

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Workflow, WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ServerlessWorkflowValidationSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

import { resolveToken, withClient, type BackendTarget } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";
import { textOrError } from "../toolresult.js";

/**
 * The task kinds the YAML may declare, derived from the proto enum (every value
 * except the unspecified zero value). Deriving from the enum keeps this in lock
 * step with the contract and avoids a hand-maintained list.
 */
const acceptedTaskKinds: ReadonlySet<string> = new Set(
  Object.values(WorkflowTaskKind).filter(
    (v): v is string => typeof v === "string" && v !== "workflow_task_kind_unspecified",
  ),
);

/** Register the validate_workflow_yaml tool; returns the registered tool names. */
export function registerValidateWorkflowYamlTool(
  server: McpServer,
  target: BackendTarget,
): string[] {
  server.registerTool(
    "validate_workflow_yaml",
    {
      description:
        "Validate a Stigmer workflow YAML for structural and semantic correctness. " +
        "Uses the same Temporal-based validation pipeline as workflow create/update. " +
        "Returns validation state (VALID/INVALID/FAILED), errors, warnings, and the generated internal YAML.",
      inputSchema: {
        yaml: z
          .string()
          .describe(
            "Complete Stigmer workflow YAML content to validate (apiVersion, kind, metadata, spec).",
          ),
      },
    },
    (args, extra) =>
      textOrError(() =>
        validateWorkflowYaml(target.serverAddress, resolveToken(extra, target.apiKey), args.yaml),
      ),
  );

  return ["validate_workflow_yaml"];
}

/** Parse the YAML to a Workflow proto, then validate it server-side. */
async function validateWorkflowYaml(
  serverAddress: string,
  token: string,
  yamlContent: string,
): Promise<string> {
  if (yamlContent.trim() === "") {
    throw new Error("yaml is required");
  }

  let workflow: Workflow;
  try {
    workflow = parseWorkflowYaml(yamlContent);
  } catch (err) {
    throw new Error(`failed to parse workflow YAML: ${errMessage(err)}`);
  }

  return withClient(WorkflowCommandController, serverAddress, token, async (client, callOptions) => {
    try {
      const validation = await client.validateSpec(workflow, callOptions);
      return toProtoJson(ServerlessWorkflowValidationSchema, validation);
    } catch (err) {
      throw rpcError(err, "workflow validation");
    }
  });
}

/**
 * Convert a Stigmer workflow YAML string to a Workflow proto. The YAML has an
 * apiVersion/kind/metadata/spec shape; task kinds are validated against the
 * accepted set. task_config is a google.protobuf.Struct and round-trips through
 * JSON naturally.
 */
function parseWorkflowYaml(yamlContent: string): Workflow {
  let raw: unknown;
  try {
    raw = parseYaml(yamlContent);
  } catch (err) {
    throw new Error(`invalid YAML syntax: ${errMessage(err)}`);
  }

  if (!isObject(raw)) {
    throw new Error("missing or invalid 'spec' field");
  }
  const spec = raw.spec;
  if (!isObject(spec)) {
    throw new Error("missing or invalid 'spec' field");
  }

  const tasks = spec.tasks;
  if (Array.isArray(tasks)) {
    tasks.forEach((task, i) => {
      if (!isObject(task)) {
        return;
      }
      const kind = task.kind;
      if (typeof kind === "string" && kind !== "" && !acceptedTaskKinds.has(kind)) {
        throw new Error(`unknown task kind "${kind}" at tasks[${i}]`);
      }
    });
  }

  try {
    return fromJson(WorkflowSchema, raw as JsonValue, { ignoreUnknownFields: true });
  } catch (err) {
    throw new Error(`failed to unmarshal into Workflow proto: ${errMessage(err)}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
