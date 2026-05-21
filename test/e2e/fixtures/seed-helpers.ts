import type { Stigmer } from "@stigmer/sdk";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

const DEFAULT_ORG = "default";

export interface TestAgentResult {
  id: string;
  slug: string;
  org: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestAgentOpts {
  name?: string;
  instructions?: string;
  org?: string;
}

export async function createTestAgent(
  client: Stigmer,
  opts?: CreateTestAgentOpts,
): Promise<TestAgentResult> {
  const name = opts?.name ?? `e2e-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  const agent = await client.agent.create({
    name,
    org,
    instructions: opts?.instructions ?? "You are a helpful test assistant. Keep responses under 20 words.",
  });

  const id = agent.metadata!.id;
  const slug = agent.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.agent.delete(id).catch(() => {});
    },
  };
}

export interface TestWorkflowResult {
  id: string;
  slug: string;
  org: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestWorkflowOpts {
  name?: string;
  org?: string;
  tasks?: Array<{ name: string; variables: Record<string, string> }>;
}

export async function createTestWorkflow(
  client: Stigmer,
  opts?: CreateTestWorkflowOpts,
): Promise<TestWorkflowResult> {
  const name = opts?.name ?? `e2e-wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  const tasks = opts?.tasks ?? [
    { name: "step-one", variables: { greeting: "hello-from-e2e" } },
    { name: "step-two", variables: { farewell: "goodbye-from-e2e" } },
  ];

  const workflow = await client.workflow.apply({
    name,
    org,
    description: "E2E test workflow with deterministic set_vars tasks",
    document: {
      dsl: "1.0.0",
      namespace: org,
      name,
      version: "1.0.0",
    },
    tasks: tasks.map((t) => ({
      name: t.name,
      kind: WorkflowTaskKind.set_vars,
      taskConfig: { variables: t.variables },
      export: { as: "${ . }" },
    })),
  });

  const id = workflow.metadata!.id;
  const slug = workflow.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

export interface TestWorkflowExecutionResult {
  id: string;
  workflowId: string;
  cleanup: () => Promise<void>;
}

export async function createTestWorkflowExecution(
  client: Stigmer,
  workflowId: string,
  opts?: { org?: string; triggerMessage?: string },
): Promise<TestWorkflowExecutionResult> {
  const org = opts?.org ?? DEFAULT_ORG;
  const name = `e2e-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const execution = await client.workflowExecution.create({
    name,
    org,
    workflowId,
    triggerMessage: opts?.triggerMessage,
  });

  const id = execution.metadata!.id;

  return {
    id,
    workflowId,
    cleanup: async () => {
      await client.workflowExecution.delete(id).catch(() => {});
    },
  };
}
