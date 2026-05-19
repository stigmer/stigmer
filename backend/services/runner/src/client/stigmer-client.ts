/**
 * Connect-RPC client for communicating with the Stigmer server.
 *
 * Provides typed wrappers around generated service stubs for RPCs the
 * runner needs: execution queries, status updates, session reads/writes,
 * and blueprint resolution (agent, skill, MCP server).
 *
 * Shared by all activities in the unified runner.
 */

import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import type { RecordLlmCallUsageInput, RecordLlmCallUsageResponse } from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextExecutionIdInputSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionMemory } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { GetArtifactResponse } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { create } from "@bufbuild/protobuf";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

export interface StigmerClientOptions {
  endpoint: string;
  token: string | null;
}

export class StigmerClient {
  readonly transport: Transport;
  private readonly executionQuery: Client<typeof AgentExecutionQueryController>;
  private readonly executionCommand: Client<typeof AgentExecutionCommandController>;
  private readonly executionContextQuery: Client<typeof ExecutionContextQueryController>;
  private readonly sessionQuery: Client<typeof SessionQueryController>;
  private readonly sessionCommand: Client<typeof SessionCommandController>;
  private readonly agentQuery: Client<typeof AgentQueryController>;
  private readonly agentInstanceQuery: Client<typeof AgentInstanceQueryController>;
  private readonly mcpServerQuery: Client<typeof McpServerQueryController>;
  private readonly mcpServerCommand: Client<typeof McpServerCommandController>;
  private readonly skillQuery: Client<typeof SkillQueryController>;
  private readonly billingCommand: Client<typeof BillingCommandController>;

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
    this.executionContextQuery = createClient(ExecutionContextQueryController, this.transport);
    this.sessionQuery = createClient(SessionQueryController, this.transport);
    this.sessionCommand = createClient(SessionCommandController, this.transport);
    this.agentQuery = createClient(AgentQueryController, this.transport);
    this.agentInstanceQuery = createClient(AgentInstanceQueryController, this.transport);
    this.mcpServerQuery = createClient(McpServerQueryController, this.transport);
    this.mcpServerCommand = createClient(McpServerCommandController, this.transport);
    this.skillQuery = createClient(SkillQueryController, this.transport);
    this.billingCommand = createClient(BillingCommandController, this.transport);
  }

  async getExecution(executionId: string): Promise<AgentExecution> {
    return this.executionQuery.get({ value: executionId });
  }

  async updateStatus(
    executionId: string,
    status: AgentExecutionStatus,
  ): Promise<UpdateStatusResponse> {
    const input = create(AgentExecutionUpdateStatusInputSchema, {
      executionId,
      status,
    });
    return this.executionCommand.updateStatus(input);
  }

  async getExecutionContextByExecutionId(executionId: string): Promise<ExecutionContext> {
    return this.executionContextQuery.getByExecutionId(
      create(ExecutionContextExecutionIdInputSchema, { executionId }),
    );
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.sessionQuery.get({ value: sessionId });
  }

  async updateSession(session: Session): Promise<Session> {
    return this.sessionCommand.update(session);
  }

  async updateSessionMemory(sessionId: string, memory: SessionMemory): Promise<Session> {
    return this.sessionCommand.updateSessionMemory({ id: sessionId, sessionMemory: memory });
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

  async connectMcpServer(
    mcpServerId: string,
    org: string,
    runtimeEnv?: Record<string, string>,
  ): Promise<McpServer> {
    const input = create(ConnectInputSchema, {
      mcpServerId,
      org,
    });
    if (runtimeEnv) {
      for (const [key, value] of Object.entries(runtimeEnv)) {
        input.runtimeEnv[key] = { value } as any;
      }
    }
    return this.mcpServerCommand.connect(input);
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

  async recordLlmCallUsage(input: RecordLlmCallUsageInput): Promise<RecordLlmCallUsageResponse> {
    return this.billingCommand.recordLlmCallUsage(input);
  }
}
