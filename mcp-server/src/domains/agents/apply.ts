// Agent apply path: create-or-update via the AgentCommandController.apply RPC.
// The flat MCP input is projected into a fully-formed Agent proto by the
// generated agentInputToProto bridge (codegen, src/gen/agent.ts) before the call.
// Go parity: mcp-server/internal/domains/agents/apply.go.

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";

import { agentInputToProto, type AgentInput } from "../../gen/agent.js";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Create or update an agent, returning the persisted agent as protojson. */
export async function applyAgent(
  serverAddress: string,
  token: string,
  input: AgentInput,
): Promise<string> {
  const agent = agentInputToProto(input);
  const desc = `agent "${agent.metadata?.slug ?? ""}" in org "${agent.metadata?.org ?? ""}"`;
  return withClient(AgentCommandController, serverAddress, token, async (client, callOptions) => {
    try {
      const result = await client.apply(agent, callOptions);
      return toProtoJson(AgentSchema, result);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
