/**
 * RecordRunnerLineageLabels — the agent-execution create chain's
 * lineage-label vouching step (the Java
 * AgentExecutionCreateHandler.RecordRunnerLineageLabelsStep port,
 * cloud#386; parity entry 20260830.05, C5 readout finding F3).
 *
 * The workflow runner's CallAgent activity
 * (backend/services/runner/src/activities/call-agent.ts) stamps
 * `stigmer.ai/workflow-execution-id` and `stigmer.ai/workflow-task` on
 * every child execution it creates — the lineage the agent_call
 * environment resolution keys on. GuardReservedLabels would reject that
 * create outright (the guard predates the runner sender and never got
 * the matching exemption — in OSS the permissive default Authorizer
 * masks this; a composition with a real Authorizer refuses).
 *
 * The step records EXACTLY the two lineage keys through
 * server-stamped-reserved-labels.ts, and only when the composed
 * RunnerCredentialProvider's vouchRunnerLineageLabels capability vouches
 * for the caller — the capability owns both caller classification (its
 * own token-type vocabulary; no caller class expresses "runner" and OSS
 * must not learn another edition's lane names) and the binding rule (a
 * workflow-bound credential may only stamp its own workflow execution;
 * the capability REFUSES a mismatch by throwing). With no capability
 * composed nothing is vouched, which is byte-identical OSS behavior.
 *
 * Placement: after BuildNewState (the labels inspected are the ones the
 * guard will diff), immediately before GuardReservedLabels. Non-runner
 * callers vouch nothing and stay fully subject to the guard — a client
 * sending these same keys itself is still rejected.
 */
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { recordServerStampedReservedLabels } from "../../pipeline/steps/server-stamped-reserved-labels.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";

/**
 * The lineage label keys, byte-pinned on three sides: the runner's
 * CallAgent stamp, the Java ExecutionEnvironmentComposer's resolution
 * read, and this vouching step.
 */
export const WORKFLOW_EXECUTION_ID_LABEL = "stigmer.ai/workflow-execution-id";
export const WORKFLOW_TASK_LABEL = "stigmer.ai/workflow-task";

export function newRecordRunnerLineageLabelsStep(
  provider: RunnerCredentialProvider,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "RecordRunnerLineageLabels",
    execute(ctx: RequestContext<typeof AgentExecutionSchema>): void {
      const vouch = provider.vouchRunnerLineageLabels;
      if (vouch === undefined) {
        return;
      }
      const labels = metadataOf(ctx.newState)?.labels ?? {};
      const workflowExecutionId = labels[WORKFLOW_EXECUTION_ID_LABEL] ?? "";
      const taskName = labels[WORKFLOW_TASK_LABEL] ?? "";
      if (workflowExecutionId === "" && taskName === "") {
        return;
      }
      // The capability throws its own byte-pinned refusal on a binding
      // violation; false means "not a runner credential" — vouch nothing.
      if (!vouch.call(provider, ctx.callerIdentity, workflowExecutionId)) {
        return;
      }
      if (workflowExecutionId !== "") {
        recordServerStampedReservedLabels(ctx, WORKFLOW_EXECUTION_ID_LABEL);
      }
      if (taskName !== "") {
        recordServerStampedReservedLabels(ctx, WORKFLOW_TASK_LABEL);
      }
    },
  };
}
