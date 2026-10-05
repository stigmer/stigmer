// Agent-execution start path for the run_agent tool.
//
// Mirrors the CLI's run stack (client-apps/cli/src/resources/run/create.ts):
// starting an agent is a single AgentExecutionCommandController.create call
// whose target is either an existing session (by id alone: the session pins
// the agent it started on) or the session_spec of a new conversation naming
// the agent by reference. The server bootstraps that session, pins the
// agent's current version on it, and dispatches the message. For a new
// conversation the MCP layer first resolves the org/slug reference over the
// same transport (the two-step pattern the delete tools use), so a missing
// agent reads as the tool's own not-found error and an empty org on a
// single-organization server lands on the agent's real organization.
//
// A follow-up still names its agent: the tool reads the session first and
// refuses when `agent` is not the agent the session runs (a session on the
// built-in assistant runs none), so a caller naming the wrong agent learns
// it instead of silently running the session's. `org`, when given, must
// name that agent's organization: it is compared with the session's agent
// reference as given, and only when the text differs (a slug against the
// stored id) is the named agent resolved and its organization id compared.
//
// The tool is deliberately asynchronous: it returns the created execution
// (with its aex_* ID) immediately and the run continues in the background.
// Observation happens through get_agent_execution polling — MCP tools are
// request/response, so there is no streaming path here by design.

import {
  createClient,
  type CallOptions,
  type Transport,
} from "@connectrpc/connect";
import { create as createMessage } from "@bufbuild/protobuf";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  type AgentExecutionSpec,
  AgentExecutionSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  ExecutionValueSchema,
  type ExecutionValue,
} from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
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
 * Start an agent execution: a follow-up in an existing session sends the
 * session id alone, once the session is shown to run the named agent; a new
 * conversation resolves org/slug and names the agent by reference. Returns
 * the created execution as protojson (small at creation time — status is
 * empty until the runner picks it up).
 */
export async function runAgent(
  serverAddress: string,
  token: string,
  args: RunAgentArgs,
): Promise<string> {
  const desc = `agent "${args.agent}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const sessionId = args.sessionId ?? "";
    let target: AgentExecutionSpec["target"];
    if (sessionId !== "") {
      await assertSessionRunsAgent(transport, callOptions, sessionId, args);
      target = { case: "sessionId", value: sessionId };
    } else {
      const query = createClient(AgentQueryController, transport);
      try {
        const agent = await query.getByReference(
          { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
          callOptions,
        );
        target = {
          case: "sessionSpec",
          value: createMessage(SessionSpecSchema, {
            agentRef: createMessage(ApiResourceReferenceSchema, {
              kind: ApiResourceKind.agent,
              org: agent.metadata?.org ?? "",
              slug: agent.metadata?.slug ?? "",
            }),
          }),
        };
      } catch (err) {
        throw rpcError(err, desc);
      }
    }

    const execution = createMessage(AgentExecutionSchema, {
      apiVersion: API_VERSION,
      kind: "AgentExecution",
      // `org` names the agent's organization. A follow-up in an existing
      // session belongs to the session's organization, which the server
      // fills in when none is sent (stigmer/stigmer#1580); sending the
      // agent's would refuse a session started with another org's agent.
      metadata: createMessage(ApiResourceMetadataSchema, {
        name: executionName(),
        org: sessionId === "" ? args.org : "",
      }),
      spec: createMessage(AgentExecutionSpecSchema, {
        // Empty message means "just run" — the CLI applies the same default.
        message: args.message === "" ? "execute" : args.message,
        runtimeEnv: toExecutionValues(args.runtimeEnv),
        target,
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
 * Refuse a follow-up whose `agent` (and `org`, when given) is not the agent
 * the session runs (the module header). The named agent is resolved only
 * when `org` and the session's reference differ as text.
 */
async function assertSessionRunsAgent(
  transport: Transport,
  callOptions: CallOptions,
  sessionId: string,
  args: RunAgentArgs,
): Promise<void> {
  let session: Session;
  try {
    session = await createClient(SessionQueryController, transport).get(
      { value: sessionId },
      callOptions,
    );
  } catch (err) {
    throw rpcError(err, `session "${sessionId}"`);
  }
  const ref = session.spec?.agentRef;
  const sessionAgent = ref?.slug ?? "";
  const mismatch = () =>
    new Error(
      `session "${sessionId}" runs ` +
        (sessionAgent === ""
          ? "the built-in assistant"
          : `agent "${sessionAgent}" in org "${ref?.org ?? ""}"`) +
        `, not agent "${args.agent}"${args.org === "" ? "" : ` in org "${args.org}"`}. ` +
        "Name the session's agent, or omit session_id to start a new conversation.",
    );
  if (sessionAgent !== args.agent) {
    throw mismatch();
  }
  if (ref === undefined || args.org === "" || args.org === ref.org) {
    return;
  }
  let agentOrg: string;
  try {
    const agent = await createClient(
      AgentQueryController,
      transport,
    ).getByReference(
      { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
      callOptions,
    );
    agentOrg = agent.metadata?.org ?? "";
  } catch (err) {
    throw rpcError(err, `agent "${args.agent}" in org "${args.org}"`);
  }
  if (agentOrg !== ref.org) {
    throw mismatch();
  }
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
