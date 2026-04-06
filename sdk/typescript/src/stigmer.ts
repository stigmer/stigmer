import { GeneratedClient } from "./gen/client";
import { GitHubClient } from "./github";
import { SearchClient } from "./search";
import { createStigmerTransport } from "./transport";
import {
  validateConfig,
  type StigmerConfig,
  type TokenProvider,
} from "./config";
import type { AgentClient } from "./gen/agent";
import type { AgentExecutionClient } from "./gen/agentexecution";
import type { AgentInstanceClient } from "./gen/agentinstance";
import type { ApiKeyClient } from "./gen/apikey";
import type { EnvironmentClient } from "./gen/environment";
import type { ExecutionContextClient } from "./gen/executioncontext";
import type { IamPolicyClient } from "./gen/iampolicy";
import type { IdentityAccountClient } from "./gen/identityaccount";
import type { IdentityProviderClient } from "./gen/identityprovider";
import type { InvitationClient } from "./gen/invitation";
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
 *   baseUrl: "https://api.stigmer.ai",
 *   apiKey: "sk_live_abc123",
 * });
 *
 * const agent = await stigmer.agent.get("agent-id");
 * ```
 */
export class Stigmer {
  /**
   * Base URL of the connected Stigmer API server.
   *
   * Exposed so downstream code (e.g., system env var resolution) can
   * derive the gRPC address for MCP server subprocesses without
   * requiring the host application to pass it separately.
   */
  readonly baseUrl: string;

  readonly agent: AgentClient;
  readonly agentExecution: AgentExecutionClient;
  readonly agentInstance: AgentInstanceClient;
  readonly apiKey: ApiKeyClient;
  readonly environment: EnvironmentClient;
  readonly executionContext: ExecutionContextClient;
  readonly iamPolicy: IamPolicyClient;
  readonly identityAccount: IdentityAccountClient;
  readonly identityProvider: IdentityProviderClient;
  readonly invitation: InvitationClient;
  readonly mcpServer: McpServerClient;
  readonly organization: OrganizationClient;
  readonly project: ProjectClient;
  readonly session: SessionClient;
  readonly skill: SkillClient;
  readonly workflow: WorkflowClient;
  readonly workflowExecution: WorkflowExecutionClient;
  readonly workflowInstance: WorkflowInstanceClient;
  readonly search: SearchClient;
  readonly github: GitHubClient;

  private readonly _tokenProvider: TokenProvider;

  constructor(config: StigmerConfig) {
    validateConfig(config);

    this.baseUrl = config.baseUrl;
    this._tokenProvider = config.apiKey
      ? () => config.apiKey!
      : config.getAccessToken!;

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
    this.invitation = client.invitation;
    this.mcpServer = client.mcpServer;
    this.organization = client.organization;
    this.project = client.project;
    this.session = client.session;
    this.skill = client.skill;
    this.workflow = client.workflow;
    this.workflowExecution = client.workflowExecution;
    this.workflowInstance = client.workflowInstance;
    this.search = new SearchClient(transport);
    this.github = new GitHubClient(transport);
  }

  /**
   * Retrieve the current authentication credential.
   *
   * Returns the static API key or calls the dynamic token provider,
   * depending on how the client was configured. Returns `null` when
   * the token provider signals "no auth for this request."
   *
   * Used by system env var resolution to derive `STIGMER_API_KEY`
   * for MCP server subprocesses without prompting the user.
   */
  async getAuthCredential(): Promise<string | null> {
    return await this._tokenProvider();
  }
}
