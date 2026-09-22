/**
 * ValidateAgentCallReferences — the second collector for the reference rule
 * (pipeline/steps/references.ts): a workflow's `agent_call` tasks name their
 * agent as a STRING, `"slug"` or `"org/slug"`, inside a `google.protobuf.Struct`
 * config the generic spec walker cannot see, so the rule would never meet
 * them. This step parses each task's config through the converter's own
 * strict decoder (`unmarshalTaskConfig`, the one reader of a task config),
 * walks nested control-flow tasks exactly as the constraint validator does,
 * turns every `agent` string into a reference with the workflow as parent,
 * and asks the rule's one function — same clauses, same copy. It lives in
 * the workflow domain and not inside `InProcessValidator` because the
 * validator is pure over the spec by design and a rule that reads the
 * target's row cannot be.
 *
 * The parser here is STRICT: exactly `slug` or `org/slug`, both segments
 * non-empty, anything else refused at write naming the task. Two lenient
 * readers of the same string exist downstream and disagree with each other
 * (the runner's `parseAgentReference` in activities/call-agent.ts splits on
 * the first `/` and drops a third segment; the CLI's `parseReference` in
 * client-apps/cli/src/resources/reference.ts refuses a leading slash);
 * refusing every malformed shape here means neither ever meets one. The
 * three cannot share code — the packages share only the protos — so the
 * execution conformance suite is where their agreement is proven.
 *
 * Runs after NormalizeReferences and ValidateReferences on the workflow
 * create and update chains, so the org the walk sees is the workflow's own
 * for a bare slug. Proven by __tests__/agent-call-references.test.ts and
 * the workflow conformance suite's reference arm.
 */
import type { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type {
  ReferenceParent,
  SpecReference,
} from "../../pipeline/steps/references.js";
import { checkReferences } from "../../pipeline/steps/references.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import { unmarshalTaskConfig } from "./converter/unmarshal.js";
import { nestedTasks } from "./validation/task-config-constraints.js";

/** The one sentence for an `agent` string that is neither `slug` nor `org/slug`. */
export function malformedAgentReferenceMessage(
  taskName: string,
  agent: string,
): string {
  return `task '${taskName}': agent '${agent}' is not a reference; write 'slug' for an agent of this organization or 'org/slug' for another organization's.`;
}

/**
 * `slug` or `org/slug` → the reference, with `org` empty for the bare form
 * (the caller fills the parent's). Returns undefined for any other shape.
 */
export function parseAgentReference(
  agent: string,
): { readonly org: string; readonly slug: string } | undefined {
  const parts = agent.split("/");
  if (parts.length === 1) {
    return parts[0] === "" ? undefined : { org: "", slug: parts[0]! };
  }
  if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") {
    return { org: parts[0]!, slug: parts[1]! };
  }
  return undefined;
}

/**
 * Every `agent_call` task's agent as a reference, nested tasks included in
 * declaration order, the bare form resolved to `parentOrg`. Throws
 * INVALID_ARGUMENT on the first malformed string. A config that does not
 * decode is skipped: the spec validation step has already refused the
 * workflow for it, and this collector never double-reports.
 */
export function collectAgentCallReferences(
  spec: WorkflowSpec | undefined,
  parentOrg: string,
): SpecReference[] {
  const refs: SpecReference[] = [];
  if (spec === undefined) {
    return refs;
  }
  const visit = (task: WorkflowTask): void => {
    if (task.taskConfig !== undefined) {
      let config;
      try {
        config = unmarshalTaskConfig(task.kind, task.taskConfig);
      } catch {
        config = undefined;
      }
      if (config !== undefined) {
        if (task.kind === WorkflowTaskKind.agent_call) {
          const agent = (config as AgentCallTaskConfig).agent;
          const parsed = parseAgentReference(agent);
          if (parsed === undefined) {
            throw invalidArgumentError(
              malformedAgentReferenceMessage(task.name, agent),
            );
          }
          refs.push({
            kind: ApiResourceKind.agent,
            org: parsed.org === "" ? parentOrg : parsed.org,
            slug: parsed.slug,
          });
        }
        for (const nested of nestedTasks(config)) {
          visit(nested);
        }
      }
    }
    for (const compensate of task.compensate) {
      visit(compensate);
    }
  };
  for (const task of spec.tasks) {
    visit(task);
  }
  return refs;
}

export function newValidateAgentCallReferencesStep(
  store: Store,
): PipelineStep<typeof WorkflowSchema> {
  return {
    name: "ValidateAgentCallReferences",
    async execute(ctx: RequestContext<typeof WorkflowSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(
          new Error("resource metadata is nil"),
          "validate agent_call references",
        );
      }
      const refs = collectAgentCallReferences(ctx.newState.spec, metadata.org);
      if (refs.length === 0) {
        return;
      }
      const parent: ReferenceParent = {
        org: metadata.org,
        visibility: metadata.visibility,
      };
      const refusal = await checkReferences(store, parent, refs);
      if (refusal !== undefined) {
        throw refusal;
      }
    },
  };
}
