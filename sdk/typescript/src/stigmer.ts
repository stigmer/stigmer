import { GeneratedClient } from "./gen/client";
import { SearchClient } from "./search";
import { createStigmerTransport } from "./transport";
import { validateConfig, type StigmerConfig } from "./config";
import type { AgentClient } from "./gen/agent";
import type { AgentExecutionClient } from "./gen/agentexecution";
import type { AgentInstanceClient } from "./gen/agentinstance";
import type { ApiKeyClient } from "./gen/apikey";
import type { EnvironmentClient } from "./gen/environment";
import type { ExecutionContextClient } from "./gen/executioncontext";
import type { IamPolicyClient } from "./gen/iampolicy";
import type { IdentityAccountClient } from "./gen/identityaccount";
import type { IdentityProviderClient } from "./gen/identityprovider";
import type { McpServerClient } from "./gen/mcpserver";
import type { OrganizationClient } from "./gen/organization";
import type { ProjectClient } from "./gen/project";
import type { SessionClient } from "./gen/session";
import type { SkillClient } from "./gen/skill";
import type { WorkflowClient } from "./gen/workflow";
import type { WorkflowExecutionClient } from "./gen/workflowexecution";
import type { WorkflowInstanceClient } from "./gen/workflowinstance";

/**
 * Top-level Stigmer API client.
 *
 * Provides typed access to all Stigmer platform resources and a cross-resource
 * search client. Create one with `new Stigmer({ ... })`.
 *
 * @example
 * ```typescript
 * const stigmer = new Stigmer({
 *   baseUrl: "https://api.stigmer.io",
 *   apiKey: "sk_live_abc123",
 * });
 *
 * const agent = await stigmer.agent.get("agent-id");
 * ```
 */
export class Stigmer {
  readonly agent: AgentClient;
  readonly agentExecution: AgentExecutionClient;
  readonly agentInstance: AgentInstanceClient;
  readonly apiKey: ApiKeyClient;
  readonly environment: EnvironmentClient;
  readonly executionContext: ExecutionContextClient;
  readonly iamPolicy: IamPolicyClient;
  readonly identityAccount: IdentityAccountClient;
  readonly identityProvider: IdentityProviderClient;
  readonly mcpServer: McpServerClient;
  readonly organization: OrganizationClient;
  readonly project: ProjectClient;
  readonly session: SessionClient;
  readonly skill: SkillClient;
  readonly workflow: WorkflowClient;
  readonly workflowExecution: WorkflowExecutionClient;
  readonly workflowInstance: WorkflowInstanceClient;
  readonly search: SearchClient;

  constructor(config: StigmerConfig) {
    validateConfig(config);
    const transport = createStigmerTransport(config);
    const client = new GeneratedClient(transport);

    this.agent = client.agent;
    this.agentExecution = client.agentExecution;
    this.agentInstance = client.agentInstance;
    this.apiKey = client.apiKey;
    this.environment = client.environment;
    this.executionContext = client.executionContext;
    this.iamPolicy = client.iamPolicy;
    this.identityAccount = client.identityAccount;
    this.identityProvider = client.identityProvider;
    this.mcpServer = client.mcpServer;
    this.organization = client.organization;
    this.project = client.project;
    this.session = client.session;
    this.skill = client.skill;
    this.workflow = client.workflow;
    this.workflowExecution = client.workflowExecution;
    this.workflowInstance = client.workflowInstance;
    this.search = new SearchClient(transport);
  }
}
