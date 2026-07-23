// Agent-execution start path for the run_agent tool.
//
// Mirrors the CLI's run stack (client-apps/cli/src/resources/run/create.ts):
// starting an agent is a single AgentExecutionCommandController.create call —
// the server bootstraps the session, resolves the agent's default instance
// (auto-creating if missing), and dispatches the message. The MCP layer only
// resolves the org/slug reference to the agent ID first, over the same
// transport (the two-step pattern the delete tools use).
//
// The tool is deliberately asynchronous: it returns the created execution
// (with its aex_* ID) immediately and the run continues in the background.
// Observation happens through get_agent_execution polling — MCP tools are
// request/response, so there is no streaming path here by design.

import { createClient } from "@connectrpc/connect";
import { create as createMessage } from "@bufbuild/protobuf";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  ExecutionValueSchema,
  type ExecutionValue,
} from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** apiVersion stamped on created executions; mirrors the CLI's run stack. */
const API_VERSION = "agentic.stigmer.ai/v1";

export interface RunAgentArgs {
  readonly org: string;
  readonly agent: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly runtimeEnv?: Record<string, string>;
}

/**
 * Start an agent execution: resolve org/slug → agent ID, then create the
 * execution. Returns the created execution as protojson (small at creation
 * time — status is empty until the runner picks it up).
 */
export async function runAgent(
  serverAddress: string,
  token: string,
  args: RunAgentArgs,
): Promise<string> {
  const desc = `agent "${args.agent}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(AgentQueryController, transport);
    let agentId: string;
    try {
      const agent = await query.getByReference(
        { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
        callOptions,
      );
      agentId = agent.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const execution = createMessage(AgentExecutionSchema, {
      apiVersion: API_VERSION,
      kind: "AgentExecution",
      metadata: createMessage(ApiResourceMetadataSchema, { name: executionName(), org: args.org }),
      spec: createMessage(AgentExecutionSpecSchema, {
        // Empty message means "just run" — the CLI applies the same default.
        message: args.message === "" ? "execute" : args.message,
        runtimeEnv: toExecutionValues(args.runtimeEnv),
        sessionId: args.sessionId ?? "",
        agentId,
      }),
    });

    const command = createClient(AgentExecutionCommandController, transport);
    try {
      const created = await command.create(execution, callOptions);
      return toProtoJson(AgentExecutionSchema, created);
    } catch (err) {
      throw rpcError(err, `execution of ${desc}`);
    }
  });
}

/**
 * Convert the tool's plain string map to the proto ExecutionValue map. Values
 * arriving through an MCP tool call have already passed through the model's
 * context, so they are never secrets by definition — secrets reach executions
 * through Environments, not through this tool.
 */
export function toExecutionValues(
  env: Record<string, string> | undefined,
): Record<string, ExecutionValue> {
  const out: Record<string, ExecutionValue> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    out[key] = createMessage(ExecutionValueSchema, { value, isSecret: false });
  }
  return out;
}

/**
 * Unique-enough placeholder name; the backend owns final identity. Mirrors the
 * CLI's executionName (Go's fmt.Sprintf("execution-%d", UnixMicro())).
 */
export function executionName(): string {
  return `execution-${Date.now() * 1000}`;
}
