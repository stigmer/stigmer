import { GeneratedClient } from "./gen/client.js";
import { SearchClient } from "./search.js";
import { createStigmerTransport } from "./transport.js";
import { validateConfig, type StigmerConfig } from "./config.js";
import type { AgentClient } from "./gen/agent.js";
import type { AgentExecutionClient } from "./gen/agentexecution.js";
import type { AgentInstanceClient } from "./gen/agentinstance.js";
import type { ApiKeyClient } from "./gen/apikey.js";
import type { EnvironmentClient } from "./gen/environment.js";
import type { ExecutionContextClient } from "./gen/executioncontext.js";
import type { IamPolicyClient } from "./gen/iampolicy.js";
import type { IdentityAccountClient } from "./gen/identityaccount.js";
import type { IdentityProviderClient } from "./gen/identityprovider.js";
import type { McpServerClient } from "./gen/mcpserver.js";
import type { OrganizationClient } from "./gen/organization.js";
import type { ProjectClient } from "./gen/project.js";
import type { SessionClient } from "./gen/session.js";
import type { SkillClient } from "./gen/skill.js";
import type { WorkflowClient } from "./gen/workflow.js";
import type { WorkflowExecutionClient } from "./gen/workflowexecution.js";
import type { WorkflowInstanceClient } from "./gen/workflowinstance.js";

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
