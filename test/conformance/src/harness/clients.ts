// Connect-RPC client factory for the conformance suite.
// Domain: conformance harness (transport + clients).
//
// The suite drives the server through the raw generated @stigmer/protos
// controllers (no SDK) so it tests the proto contract directly, independent of
// any client convenience layer that could drift from it.
import {
  createClient,
  type Client,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_query_pb";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_query_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { AgentShareQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/query_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryQueryController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/query_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppQueryController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/query_pb";
import { GitHubService } from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { Health } from "@stigmer/protos/grpc/health/v1/health_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { ProjectQueryController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/query_pb";

export interface ConformanceClients {
  activityQuery: Client<typeof ActivityQueryController>;
  apiKeyCommand: Client<typeof ApiKeyCommandController>;
  apiKeyQuery: Client<typeof ApiKeyQueryController>;
  agentChannelCommand: Client<typeof AgentChannelCommandController>;
  agentChannelQuery: Client<typeof AgentChannelQueryController>;
  agentShareCommand: Client<typeof AgentShareCommandController>;
  agentShareQuery: Client<typeof AgentShareQueryController>;
  artifactCommand: Client<typeof ArtifactCommandController>;
  artifactQuery: Client<typeof ArtifactQueryController>;
  channelAppCommand: Client<typeof ChannelAppCommandController>;
  channelAppQuery: Client<typeof ChannelAppQueryController>;
  channelConversationCommand: Client<
    typeof ChannelConversationCommandController
  >;
  channelConversationQuery: Client<typeof ChannelConversationQueryController>;
  channelMessageCommand: Client<typeof ChannelMessageCommandController>;
  channelMessageQuery: Client<typeof ChannelMessageQueryController>;
  search: Client<typeof SearchService>;
  projectCommand: Client<typeof ProjectCommandController>;
  projectQuery: Client<typeof ProjectQueryController>;
  organizationCommand: Client<typeof OrganizationCommandController>;
  organizationQuery: Client<typeof OrganizationQueryController>;
  workflowCommand: Client<typeof WorkflowCommandController>;
  workflowQuery: Client<typeof WorkflowQueryController>;
  workflowExecutionCommand: Client<typeof WorkflowExecutionCommandController>;
  workflowExecutionQuery: Client<typeof WorkflowExecutionQueryController>;
  workflowInstanceCommand: Client<typeof WorkflowInstanceCommandController>;
  workflowInstanceQuery: Client<typeof WorkflowInstanceQueryController>;
  agentExecutionCommand: Client<typeof AgentExecutionCommandController>;
  agentExecutionQuery: Client<typeof AgentExecutionQueryController>;
  agentInstanceCommand: Client<typeof AgentInstanceCommandController>;
  agentInstanceQuery: Client<typeof AgentInstanceQueryController>;
  agentCommand: Client<typeof AgentCommandController>;
  agentQuery: Client<typeof AgentQueryController>;
  environmentCommand: Client<typeof EnvironmentCommandController>;
  environmentQuery: Client<typeof EnvironmentQueryController>;
  executionContextCommand: Client<typeof ExecutionContextCommandController>;
  executionContextQuery: Client<typeof ExecutionContextQueryController>;
  mcpServerCommand: Client<typeof McpServerCommandController>;
  mcpServerQuery: Client<typeof McpServerQueryController>;
  memoryCommand: Client<typeof MemoryCommandController>;
  memoryQuery: Client<typeof MemoryQueryController>;
  scheduleCommand: Client<typeof ScheduleCommandController>;
  scheduleQuery: Client<typeof ScheduleQueryController>;
  sessionCommand: Client<typeof SessionCommandController>;
  sessionQuery: Client<typeof SessionQueryController>;
  skillCommand: Client<typeof SkillCommandController>;
  skillQuery: Client<typeof SkillQueryController>;
  platformQuery: Client<typeof PlatformQueryController>;
  // The standard gRPC health service — an external proto both editions serve
  // on the RPC port. The authentication suite pins its tokenless reachability
  // (the Kubernetes grpc-probe contract).
  health: Client<typeof Health>;
  github: Client<typeof GitHubService>;
  oauthAppCommand: Client<typeof OAuthAppCommandController>;
  oauthAppQuery: Client<typeof OAuthAppQueryController>;
}

export interface TransportOptions {
  // Attached as `authorization: Bearer <token>` on every RPC. Used by the
  // cloud target, whose service authenticates callers; local targets run
  // without auth and omit it.
  bearerToken?: string;
  // Stamped as the plain lowercase `origin` metadata key on every RPC — the
  // header browsers attach to cross-origin fetches and page script cannot
  // forge. Suites set it to simulate a browser context (the platform-client
  // allowed_origins enforcement arms replay a leaked token from a foreign
  // site this way); leaving it unset mirrors non-browser callers (curl,
  // backend services), whose absence of Origin never refuses.
  origin?: string;
}

export function createTransport(
  baseUrl: string,
  options: TransportOptions = {},
): Transport {
  // Plain gRPC over h2c: createGrpcTransport always speaks HTTP/2, matching
  // both backends — the OSS server and the hermetic cloud service each serve
  // native gRPC on a single insecure local port.
  const interceptors: Interceptor[] = [];
  if (options.bearerToken !== undefined) {
    const authorization = `Bearer ${options.bearerToken}`;
    interceptors.push((next) => (req) => {
      req.header.set("authorization", authorization);
      return next(req);
    });
  }
  if (options.origin !== undefined) {
    const origin = options.origin;
    interceptors.push((next) => (req) => {
      req.header.set("origin", origin);
      return next(req);
    });
  }
  return createGrpcTransport({ baseUrl, interceptors });
}

export function makeClients(transport: Transport): ConformanceClients {
  return {
    activityQuery: createClient(ActivityQueryController, transport),
    agentChannelCommand: createClient(AgentChannelCommandController, transport),
    agentChannelQuery: createClient(AgentChannelQueryController, transport),
    agentShareCommand: createClient(AgentShareCommandController, transport),
    agentShareQuery: createClient(AgentShareQueryController, transport),
    artifactCommand: createClient(ArtifactCommandController, transport),
    artifactQuery: createClient(ArtifactQueryController, transport),
    channelAppCommand: createClient(ChannelAppCommandController, transport),
    channelAppQuery: createClient(ChannelAppQueryController, transport),
    channelConversationCommand: createClient(
      ChannelConversationCommandController,
      transport,
    ),
    channelConversationQuery: createClient(
      ChannelConversationQueryController,
      transport,
    ),
    channelMessageCommand: createClient(
      ChannelMessageCommandController,
      transport,
    ),
    channelMessageQuery: createClient(ChannelMessageQueryController, transport),
    search: createClient(SearchService, transport),
    apiKeyCommand: createClient(ApiKeyCommandController, transport),
    apiKeyQuery: createClient(ApiKeyQueryController, transport),
    projectCommand: createClient(ProjectCommandController, transport),
    projectQuery: createClient(ProjectQueryController, transport),
    organizationCommand: createClient(OrganizationCommandController, transport),
    organizationQuery: createClient(OrganizationQueryController, transport),
    workflowCommand: createClient(WorkflowCommandController, transport),
    workflowQuery: createClient(WorkflowQueryController, transport),
    workflowExecutionCommand: createClient(
      WorkflowExecutionCommandController,
      transport,
    ),
    workflowExecutionQuery: createClient(
      WorkflowExecutionQueryController,
      transport,
    ),
    workflowInstanceCommand: createClient(
      WorkflowInstanceCommandController,
      transport,
    ),
    workflowInstanceQuery: createClient(
      WorkflowInstanceQueryController,
      transport,
    ),
    agentExecutionCommand: createClient(
      AgentExecutionCommandController,
      transport,
    ),
    agentExecutionQuery: createClient(AgentExecutionQueryController, transport),
    agentInstanceCommand: createClient(
      AgentInstanceCommandController,
      transport,
    ),
    agentInstanceQuery: createClient(AgentInstanceQueryController, transport),
    agentCommand: createClient(AgentCommandController, transport),
    agentQuery: createClient(AgentQueryController, transport),
    environmentCommand: createClient(EnvironmentCommandController, transport),
    environmentQuery: createClient(EnvironmentQueryController, transport),
    executionContextCommand: createClient(
      ExecutionContextCommandController,
      transport,
    ),
    executionContextQuery: createClient(
      ExecutionContextQueryController,
      transport,
    ),
    mcpServerCommand: createClient(McpServerCommandController, transport),
    mcpServerQuery: createClient(McpServerQueryController, transport),
    memoryCommand: createClient(MemoryCommandController, transport),
    memoryQuery: createClient(MemoryQueryController, transport),
    scheduleCommand: createClient(ScheduleCommandController, transport),
    scheduleQuery: createClient(ScheduleQueryController, transport),
    sessionCommand: createClient(SessionCommandController, transport),
    sessionQuery: createClient(SessionQueryController, transport),
    skillCommand: createClient(SkillCommandController, transport),
    skillQuery: createClient(SkillQueryController, transport),
    platformQuery: createClient(PlatformQueryController, transport),
    health: createClient(Health, transport),
    github: createClient(GitHubService, transport),
    oauthAppCommand: createClient(OAuthAppCommandController, transport),
    oauthAppQuery: createClient(OAuthAppQueryController, transport),
  };
}
