/**
 * ValidateAgentCallReferences — the second collector for the reference rule
 * (pipeline/steps/references.ts): a workflow's `agent_call` tasks name their
 * agent as a STRING inside a `google.protobuf.Struct` config the generic
 * spec walker cannot see, so the rule would never meet them. This step
 * parses each task's config through the converter's own strict decoder
 * (`unmarshalTaskConfig`, the one reader of a task config), walks nested
 * control-flow tasks exactly as the constraint validator does, turns every
 * `agent` string the write can judge into a reference with the workflow as
 * parent, and asks the rule's one function — same clauses, same copy. It
 * lives in the workflow domain and not inside `InProcessValidator` because
 * the validator is pure over the spec by design and a rule that reads the
 * target's row cannot be.
 *
 * The string has three forms (the `agent` field's contract in
 * agent_call.proto), told apart by `classifyAgentReference`:
 *
 *   - `org/slug`, a LITERAL: judged now, like any stored reference;
 *   - a bare `slug`, RELATIVE: the runner resolves it in the organization
 *     the workflow runs in (`__stigmer_org_id`, the execution's), which is
 *     not the workflow's when a person runs it from another organization by
 *     id. It is judged now in the workflow's own organization with its
 *     floor capped at org (references.ts, "RELATIVE");
 *   - a value holding `${`, fixed only AT RUN: the runner's jq phase
 *     (`${ expr }`, whole or embedded) or its activity phase
 *     (`${.env_vars.KEY}`, `${.secrets.KEY}`) produces the reference when
 *     the task runs. The write collects nothing for it; the run reads the
 *     resolved agent as the person who ran the workflow, as it reads every
 *     id-bound binding. The slug grammar (metadata.proto) can never contain
 *     `${`, so the test is exact. It deliberately does not recognise only
 *     the runner's shapes: that would be a second copy of the runner's
 *     grammar in a package that shares only the protos with it, and a
 *     mistyped expression already fails at run with the read's not-found.
 *
 * Anything else is refused at write naming the task. The runner's own
 * parser (`parseAgentReference` in runner/src/activities/call-agent.ts) is
 * lenient — it splits on the first `/` and drops a third segment — and the
 * CLI's `parseReference` (client-apps/cli/src/resources/reference.ts)
 * refuses a leading slash; refusing every malformed literal here means
 * neither ever meets one. The three cannot share code; the conformance
 * suites are where their agreement is proven.
 *
 * A task's `environment_refs` sit in the same config, so the collector
 * yields them too, as ordinary references to environments: an org-less
 * one in the workflow's own organization, where the run resolves it
 * (agentexecution/create-execution-context-step.ts). The rule then asks
 * them what it asks every environment reference: that the target exists,
 * and that a reference the write introduces names one the writer can view
 * (references.ts, the writer clause).
 *
 * Runs after NormalizeReferences and ValidateReferences on the workflow
 * create and update chains, judged for the request's caller against the
 * stored workflow's own task references, and feeds the workflow's
 * escalation door (controller.ts). Proven by __tests__/agent-call-references.test.ts, the
 * workflow conformance suite's agent_call reference arm, and the
 * runner-as-subject execution arm for a reference fixed only at run.
 */
import type {
  Workflow,
  WorkflowSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { Store } from "../../store/interface.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type {
  ReferenceParent,
  SpecReference,
} from "../../pipeline/steps/references.js";
import { checkReferences } from "../../pipeline/steps/references.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import { unmarshalTaskConfig } from "./converter/unmarshal.js";
import { nestedTasks } from "./validation/task-config-constraints.js";

/** The one sentence for an `agent` string that is none of the three forms. */
export function malformedAgentReferenceMessage(
  taskName: string,
  agent: string,
): string {
  return `task '${taskName}': agent '${agent}' is not a reference; write 'slug' for an agent of this organization or 'org/slug' for another organization's.`;
}

/** What an `agent` string is before the rule reads it (the module header). */
export type AgentReferenceForm =
  | { readonly kind: "literal"; readonly org: string; readonly slug: string }
  | { readonly kind: "relative"; readonly slug: string }
  | { readonly kind: "run-time" }
  | { readonly kind: "malformed" };

/** Opens every runtime expression and placeholder the runner evaluates; never part of a slug. */
const RUNTIME_EXPRESSION_MARKER = "${";

export function classifyAgentReference(agent: string): AgentReferenceForm {
  if (agent.includes(RUNTIME_EXPRESSION_MARKER)) {
    return { kind: "run-time" };
  }
  const parts = agent.split("/");
  if (parts.length === 1 && parts[0] !== "") {
    return { kind: "relative", slug: parts[0]! };
  }
  if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") {
    return { kind: "literal", org: parts[0]!, slug: parts[1]! };
  }
  return { kind: "malformed" };
}

/**
 * Every `agent_call` task's agent the write can judge, as a reference,
 * nested tasks included in declaration order: a literal as written, a
 * relative slug in `parentOrg` and marked relative, a value fixed only at
 * run not at all; then the task's environment references, an org-less one
 * in `parentOrg`. Throws INVALID_ARGUMENT on the first malformed string,
 * unless `malformed` is "skip": the stored side of an update is read that
 * way, so a row saved under looser rules never blocks the edit that fixes
 * it with its own old error. A
 * config that does not decode is skipped: the spec validation step has
 * already refused the workflow for it, and this collector never
 * double-reports.
 */
export function collectAgentCallReferences(
  spec: WorkflowSpec | undefined,
  parentOrg: string,
  malformed: "refuse" | "skip" = "refuse",
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
          const form = classifyAgentReference(agent);
          switch (form.kind) {
            case "literal":
              refs.push({
                kind: ApiResourceKind.agent,
                org: form.org,
                slug: form.slug,
              });
              break;
            case "relative":
              refs.push({
                kind: ApiResourceKind.agent,
                org: parentOrg,
                slug: form.slug,
                resolvesIn: "running-organization",
              });
              break;
            case "run-time":
              break;
            case "malformed":
              if (malformed === "skip") {
                break;
              }
              throw invalidArgumentError(
                malformedAgentReferenceMessage(task.name, agent),
              );
            default: {
              const exhaustive: never = form;
              throw new Error(
                `unknown agent reference form: ${JSON.stringify(exhaustive)}`,
              );
            }
          }
          for (const env of (config as AgentCallTaskConfig).environmentRefs) {
            if (env.slug !== "") {
              refs.push({
                kind: ApiResourceKind.environment,
                org: env.org === "" ? parentOrg : env.org,
                slug: env.slug,
              });
            }
          }
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
  authorizer: Authorizer,
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
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Workflow | undefined;
      const refusal = await checkReferences(store, parent, refs, {
        authorizer,
        caller: ctx.callerIdentity,
        stored:
          existing === undefined
            ? []
            : collectAgentCallReferences(
                existing.spec,
                existing.metadata?.org ?? "",
                "skip",
              ),
      });
      if (refusal !== undefined) {
        throw refusal;
      }
    },
  };
}
