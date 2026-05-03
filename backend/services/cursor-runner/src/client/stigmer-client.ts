/**
 * Connect-RPC client for communicating with the Stigmer server.
 *
 * Provides typed wrappers around the generated service stubs for the RPCs
 * the cursor-runner needs: execution queries, status updates, session
 * reads/writes, and blueprint resolution (agent, skill, MCP server).
 *
 * Auth: Bearer token from STIGMER_TOKEN, same pattern as the Python
 * agent-runner's channel.py.
 */

import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { GetArtifactResponse } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

export interface StigmerClientOptions {
  endpoint: string;
  token: string | null;
}

/**
 * Typed client for Stigmer server RPCs used by the cursor-runner.
 *
 * Each method corresponds to a gRPC call the cursor-runner makes during
 * execution. The client handles transport setup and auth header injection.
 */
export class StigmerClient {
  readonly transport: Transport;
  private readonly executionQuery: Client<typeof AgentExecutionQueryController>;
  private readonly executionCommand: Client<typeof AgentExecutionCommandController>;
  private readonly sessionQuery: Client<typeof SessionQueryController>;
  private readonly sessionCommand: Client<typeof SessionCommandController>;
  private readonly agentQuery: Client<typeof AgentQueryController>;
  private readonly agentInstanceQuery: Client<typeof AgentInstanceQueryController>;
  private readonly mcpServerQuery: Client<typeof McpServerQueryController>;
  private readonly skillQuery: Client<typeof SkillQueryController>;

  constructor(options: StigmerClientOptions) {
    const token = options.token;
    this.transport = createGrpcTransport({
      baseUrl: options.endpoint,
      interceptors: token
        ? [
            (next) => async (req) => {
              req.header.set("authorization", `Bearer ${token}`);
              return next(req);
            },
          ]
        : [],
    });

    this.executionQuery = createClient(AgentExecutionQueryController, this.transport);
    this.executionCommand = createClient(AgentExecutionCommandController, this.transport);
    this.sessionQuery = createClient(SessionQueryController, this.transport);
    this.sessionCommand = createClient(SessionCommandController, this.transport);
    this.agentQuery = createClient(AgentQueryController, this.transport);
    this.agentInstanceQuery = createClient(AgentInstanceQueryController, this.transport);
    this.mcpServerQuery = createClient(McpServerQueryController, this.transport);
    this.skillQuery = createClient(SkillQueryController, this.transport);
  }

  async getExecution(executionId: string): Promise<AgentExecution> {
    return this.executionQuery.get({ value: executionId });
  }

  async updateStatus(
    executionId: string,
    status: AgentExecutionStatus,
  ): Promise<AgentExecution> {
    const input = create(AgentExecutionUpdateStatusInputSchema, {
      executionId,
      status,
    });
    return this.executionCommand.updateStatus(input);
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.sessionQuery.get({ value: sessionId });
  }

  async updateSession(session: Session): Promise<Session> {
    return this.sessionCommand.update(session);
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.agentQuery.get({ value: agentId });
  }

  async getAgentInstance(instanceId: string): Promise<AgentInstance> {
    return this.agentInstanceQuery.get({ value: instanceId });
  }

  async getMcpServer(serverId: string): Promise<McpServer> {
    return this.mcpServerQuery.get({ value: serverId });
  }

  async getMcpServerByReference(ref: ApiResourceReference): Promise<McpServer> {
    return this.mcpServerQuery.getByReference(ref);
  }

  async getSkill(skillId: string): Promise<Skill> {
    return this.skillQuery.get({ value: skillId });
  }

  async getSkillByReference(ref: ApiResourceReference): Promise<Skill> {
    return this.skillQuery.getByReference(ref);
  }

  async getSkillArtifact(artifactStorageKey: string): Promise<GetArtifactResponse> {
    return this.skillQuery.getArtifact({ artifactStorageKey });
  }
}
