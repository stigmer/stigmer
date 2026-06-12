// Connect-RPC client factory for the conformance suite.
// Domain: conformance harness (transport + clients).
//
// The suite drives the server through the raw generated @stigmer/protos
// controllers (no SDK) so it tests the proto contract directly, independent of
// any client convenience layer that could drift from it.
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { ProjectQueryController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/query_pb";

export interface ConformanceClients {
  projectCommand: Client<typeof ProjectCommandController>;
  projectQuery: Client<typeof ProjectQueryController>;
  organizationCommand: Client<typeof OrganizationCommandController>;
  organizationQuery: Client<typeof OrganizationQueryController>;
  workflowCommand: Client<typeof WorkflowCommandController>;
  workflowQuery: Client<typeof WorkflowQueryController>;
  agentCommand: Client<typeof AgentCommandController>;
  agentQuery: Client<typeof AgentQueryController>;
  environmentCommand: Client<typeof EnvironmentCommandController>;
  environmentQuery: Client<typeof EnvironmentQueryController>;
  executionContextCommand: Client<typeof ExecutionContextCommandController>;
  executionContextQuery: Client<typeof ExecutionContextQueryController>;
  mcpServerCommand: Client<typeof McpServerCommandController>;
  mcpServerQuery: Client<typeof McpServerQueryController>;
  sessionCommand: Client<typeof SessionCommandController>;
  sessionQuery: Client<typeof SessionQueryController>;
  skillCommand: Client<typeof SkillCommandController>;
  skillQuery: Client<typeof SkillQueryController>;
}

export function createTransport(baseUrl: string): Transport {
  // Plain gRPC over h2c: createGrpcTransport always speaks HTTP/2, matching the
  // OSS server, which serves native gRPC on a single insecure port (no auth in
  // local mode).
  return createGrpcTransport({ baseUrl });
}

export function makeClients(transport: Transport): ConformanceClients {
  return {
    projectCommand: createClient(ProjectCommandController, transport),
    projectQuery: createClient(ProjectQueryController, transport),
    organizationCommand: createClient(OrganizationCommandController, transport),
    organizationQuery: createClient(OrganizationQueryController, transport),
    workflowCommand: createClient(WorkflowCommandController, transport),
    workflowQuery: createClient(WorkflowQueryController, transport),
    agentCommand: createClient(AgentCommandController, transport),
    agentQuery: createClient(AgentQueryController, transport),
    environmentCommand: createClient(EnvironmentCommandController, transport),
    environmentQuery: createClient(EnvironmentQueryController, transport),
    executionContextCommand: createClient(ExecutionContextCommandController, transport),
    executionContextQuery: createClient(ExecutionContextQueryController, transport),
    mcpServerCommand: createClient(McpServerCommandController, transport),
    mcpServerQuery: createClient(McpServerQueryController, transport),
    sessionCommand: createClient(SessionCommandController, transport),
    sessionQuery: createClient(SessionQueryController, transport),
    skillCommand: createClient(SkillCommandController, transport),
    skillQuery: createClient(SkillQueryController, transport),
  };
}
