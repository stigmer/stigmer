import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type {
  WorkflowInput,
  WorkflowDocumentInput,
  WorkflowTaskInput,
} from "@stigmer/sdk";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

interface EnvVarDeclarationInput {
  isSecret?: boolean;
  description?: string;
  optional?: boolean;
}

/**
 * Converts a fetched Workflow proto to the WorkflowInput shape expected
 * by `stigmer.workflow.update()`. Enables inline field editing: read the
 * current resource, modify one field, and re-submit the full input.
 *
 * Must be kept exhaustive -- any spec field not mapped here will be
 * cleared on the next update (the backend does full spec replacement).
 */
export function workflowToInput(workflow: Workflow): WorkflowInput {
  const meta = workflow.metadata;
  const spec = workflow.spec;
  const doc = spec?.document;

  const document: WorkflowDocumentInput = {
    dsl: doc?.dsl || "1.0.0",
    namespace: doc?.namespace ?? "",
    name: doc?.name ?? "",
    version: doc?.version ?? "",
    description: doc?.description || undefined,
  };

  const tasks: WorkflowTaskInput[] | undefined =
    spec?.tasks?.map(convertTask);

  let env: Record<string, EnvVarDeclarationInput> | undefined;
  if (spec?.env && Object.keys(spec.env).length > 0) {
    env = {};
    for (const [key, decl] of Object.entries(spec.env)) {
      env[key] = {
        isSecret: decl.isSecret || undefined,
        description: decl.description || undefined,
        optional: decl.optional || undefined,
      };
    }
  }

  let budget: WorkflowInput["budget"];
  if (spec?.budget) {
    const b = spec.budget;
    if (
      Number(b.maxCostMicros ?? 0) > 0 ||
      Number(b.maxTotalTokens ?? 0) > 0 ||
      (b.maxDurationSeconds ?? 0) > 0
    ) {
      budget = {
        maxCostMicros: b.maxCostMicros || undefined,
        maxTotalTokens: b.maxTotalTokens || undefined,
        maxDurationSeconds: b.maxDurationSeconds || undefined,
        onExceeded: b.onExceeded || undefined,
      };
    }
  }

  return {
    name: meta?.name ?? "",
    org: meta?.org ?? "",
    slug: meta?.slug,
    labels:
      meta?.labels && Object.keys(meta.labels).length > 0
        ? { ...meta.labels }
        : undefined,
    visibility: meta?.visibility || undefined,
    description: spec?.description || undefined,
    document,
    tasks: tasks?.length ? tasks : undefined,
    env,
    budget,
  };
}

function convertTask(task: WorkflowTask): WorkflowTaskInput {
  return {
    name: task.name || undefined,
    kind: task.kind,
    taskConfig: task.taskConfig ?? {},
    export: task.export?.as ? { as: task.export.as } : undefined,
    flow: task.flow?.then ? { then: task.flow.then } : undefined,
    compensate: task.compensate?.length
      ? task.compensate.map(convertTask)
      : undefined,
  };
}
