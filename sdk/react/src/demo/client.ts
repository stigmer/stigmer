import type { Transport } from "@connectrpc/connect";
import type { Stigmer } from "@stigmer/sdk";
import {
  AgentClient,
  AgentExecutionClient,
  AgentInstanceClient,
  ApiKeyClient,
  EnvironmentClient,
  ExecutionContextClient,
  GitHubClient,
  IamPolicyClient,
  IdentityAccountClient,
  IdentityProviderClient,
  McpServerClient,
  OrganizationClient,
  ProjectClient,
  SearchClient,
  SessionClient,
  SkillClient,
  WorkflowClient,
  WorkflowExecutionClient,
  WorkflowInstanceClient,
} from "@stigmer/sdk";
import { DemoTransport } from "./transport";
import type { DemoScenario } from "./types";

/**
 * Create a `Stigmer`-compatible client backed by in-memory fixture data.
 *
 * The returned object is structurally identical to a real {@link Stigmer}
 * instance — all 17 resource clients plus `search` and `github` — but
 * every RPC resolves through a {@link DemoTransport} instead of a network
 * connection. Pass it to `<StigmerProvider client={...}>` and all
 * descendant hooks and components work without a live backend.
 *
 * RPCs that have no registered fixture throw a descriptive error
 * identifying the missing key. Register fixtures in the
 * {@link DemoScenario} to cover the RPCs your components need.
 *
 * @example
 * ```tsx
 * import { StigmerProvider } from "@stigmer/react";
 * import { createDemoClient } from "@stigmer/react/demo";
 *
 * const client = createDemoClient({ fixtures: myScenarioFixtures });
 *
 * <StigmerProvider client={client}>
 *   <App />
 * </StigmerProvider>
 * ```
 */
export function createDemoClient(scenario: DemoScenario): Stigmer {
  const transport = new DemoTransport(
    scenario.fixtures,
  ) as unknown as Transport;

  return {
    agent: new AgentClient(transport),
    agentExecution: new AgentExecutionClient(transport),
    agentInstance: new AgentInstanceClient(transport),
    apiKey: new ApiKeyClient(transport),
    environment: new EnvironmentClient(transport),
    executionContext: new ExecutionContextClient(transport),
    iamPolicy: new IamPolicyClient(transport),
    identityAccount: new IdentityAccountClient(transport),
    identityProvider: new IdentityProviderClient(transport),
    mcpServer: new McpServerClient(transport),
    organization: new OrganizationClient(transport),
    project: new ProjectClient(transport),
    session: new SessionClient(transport),
    skill: new SkillClient(transport),
    workflow: new WorkflowClient(transport),
    workflowExecution: new WorkflowExecutionClient(transport),
    workflowInstance: new WorkflowInstanceClient(transport),
    search: new SearchClient(transport),
    github: new GitHubClient(transport),
  } as Stigmer;
}
