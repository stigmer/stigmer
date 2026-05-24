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
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { CreateArtifactInput } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
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
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import type { WorkflowExecution, WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { assertCreateRequirements, assertReferenceRequirements } from "./server-contracts.js";

/**
 * A shared mutable token reference. When provided, the interceptor
 * reads from this on every request, enabling token updates to
 * propagate to all clients sharing the same ref.
 */
export interface TokenRef {
  current: string | null;
}

export interface StigmerClientOptions {
  endpoint: string;
  token: string | null;
  tokenRef?: TokenRef;
}

export class StigmerClient {
  readonly transport: Transport;
  private currentToken: string | null;
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
  private readonly artifactCommand: Client<typeof ArtifactCommandController>;
  readonly workflowExecutionCommand: Client<typeof WorkflowExecutionCommandController>;
  private readonly workflowExecutionQuery: Client<typeof WorkflowExecutionQueryController>;
  private readonly workflowQuery: Client<typeof WorkflowQueryController>;
  private readonly workflowInstanceQuery: Client<typeof WorkflowInstanceQueryController>;

  private readonly tokenRef: TokenRef | null;

  constructor(options: StigmerClientOptions) {
    this.currentToken = options.token;
    this.tokenRef = options.tokenRef ?? null;
    this.transport = createGrpcTransport({
      baseUrl: options.endpoint,
      interceptors: [
        (next) => async (req) => {
          const token = this.tokenRef?.current ?? this.currentToken;
          if (token) {
            req.header.set("authorization", `Bearer ${token}`);
          }
          return next(req);
        },
      ],
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
    this.artifactCommand = createClient(ArtifactCommandController, this.transport);
    this.workflowExecutionCommand = createClient(WorkflowExecutionCommandController, this.transport);
    this.workflowExecutionQuery = createClient(WorkflowExecutionQueryController, this.transport);
    this.workflowQuery = createClient(WorkflowQueryController, this.transport);
    this.workflowInstanceQuery = createClient(WorkflowInstanceQueryController, this.transport);
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
    runtimeEnv?: Record<string, { value: string; isSecret: boolean }>,
  ): Promise<McpServer> {
    const input = create(ConnectInputSchema, {
      mcpServerId,
      org,
    });
    if (runtimeEnv) {
      for (const [key, entry] of Object.entries(runtimeEnv)) {
        input.runtimeEnv[key] = create(ExecutionValueSchema, {
          value: entry.value,
          isSecret: entry.isSecret,
        });
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

  async createArtifact(input: CreateArtifactInput): Promise<Artifact> {
    return this.artifactCommand.create(input);
  }

  async recordLlmCallUsage(input: RecordLlmCallUsageInput): Promise<RecordLlmCallUsageResponse> {
    return this.billingCommand.recordLlmCallUsage(input);
  }

  async getAgentByReference(ref: ApiResourceReference): Promise<Agent> {
    assertReferenceRequirements(ref, "Agent", "getAgentByReference");
    return this.agentQuery.getByReference(ref);
  }

  async createSession(session: Session): Promise<Session> {
    assertCreateRequirements(session, "Session", "createSession");
    return this.sessionCommand.create(session);
  }

  async applySession(session: Session): Promise<Session> {
    assertCreateRequirements(session, "Session", "applySession");
    return this.sessionCommand.apply(session);
  }

  async createAgentExecution(execution: AgentExecution): Promise<AgentExecution> {
    assertCreateRequirements(execution, "AgentExecution", "createAgentExecution");
    return this.executionCommand.create(execution);
  }

  async updateWorkflowExecutionStatus(
    executionId: string,
    status: WorkflowExecutionStatus,
    options?: { updatePendingApprovals?: boolean },
  ): Promise<WorkflowExecution> {
    const input = create(WorkflowExecutionUpdateStatusInputSchema, {
      executionId,
      status,
      updatePendingApprovals: options?.updatePendingApprovals ?? false,
    });
    return this.workflowExecutionCommand.updateStatus(input);
  }

  async getWorkflowExecution(executionId: string): Promise<WorkflowExecution> {
    return this.workflowExecutionQuery.get({ value: executionId });
  }

  async getWorkflow(workflowId: string): Promise<Workflow> {
    return this.workflowQuery.get({ value: workflowId });
  }

  async getWorkflowInstance(instanceId: string): Promise<WorkflowInstance> {
    return this.workflowInstanceQuery.get({ value: instanceId });
  }

  updateToken(token: string | null): void {
    this.currentToken = token;
  }
}
