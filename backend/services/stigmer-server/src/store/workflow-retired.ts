/**
 * The one data migration both store drivers run when workflows, workflow
 * runs and the artifact kind leave the platform: their rows leave the
 * store, with every grant that names one and the two tables only workflows
 * wrote, and every agent run is left with nothing that points at a
 * workflow. The drivers own the SQL (which rows to read, in what pages, how
 * to write and delete them, the transaction); this module owns what is
 * edition- and driver-neutral: which kinds go, which grant names one, and
 * what one agent run row becomes. It is the third of its line, after
 * agent-instance-retired.ts and workflow-instance-retired.ts.
 *
 * What leaves. Every row of the retired kinds (`RETIRED_WORKFLOW_KINDS`:
 * a workflow, a workflow run under either name it was stored under, and an
 * artifact, whose only producer was a workflow step's output) leaves every
 * table that keys a row by kind (run-rename.ts `RUN_KIND_TABLES`): the live
 * rows, their history, their list keys and the names they held. No data of
 * those kinds is kept. Every IamPolicy row whose resource or principal is
 * one of those kinds leaves too (`policyNamesRetiredWorkflowKind`): a grant
 * on an object that no longer exists would only linger in grant listings.
 * Such a row leaves the way the store deletes a policy, with its list keys
 * and with its history kept. The workflow run event log
 * (`workflow_execution_events`) and the signal idempotency ledger
 * (`signal_dedupe`) are dropped; nothing else wrote or read them. Search
 * entries of the removed rows are boot's rebuild's to drop.
 *
 * What an agent run becomes. A run a workflow step started holds its link
 * to the step in AgentRunSpec fields the contract now reserves: as every
 * release through 3.41 wrote it, field 6 (`callback_token`, the step's task
 * token), 8 (`parent_workflow_id`) and 11 (`activity_task_queue`, the
 * parent's sandbox queue); as builds between the run rename and this
 * removal wrote it, field 17 (`parent`). It may also hold the step's task
 * token in AgentRunStatus field 10 (`callback_token`). The current schema
 * decodes each as an unknown field (protobuf-es keeps unknown fields
 * through `fromBinary`); they are read by wire number, never through a
 * schema that no longer exists, and dropped, with the two lineage labels
 * the workflow runner stamped (`stigmer.ai/workflow-execution-id`,
 * `stigmer.ai/workflow-task`). A run carrying any of the spec fields or the
 * workflow-execution label was started by a workflow step. Every
 * other field is kept, and a run that carries none of them is left byte
 * for byte as it is. A run a workflow step started that had not finished
 * cannot resume (its parent leaves with this step, and its Temporal history
 * replays only under code that signals that parent), so it ends here:
 * FAILED, with `WORKFLOW_CHILD_ENDED_ERROR` saying why and `completed_at`
 * the step's time (a run with no status gets one saying so), which also lets its run credential lapse after the
 * terminal grace (runnerauth/bound-execution.ts). A finished run keeps its
 * phase. Its `updated_at` is left alone: no list key of a run reads what
 * changes (the run index keys the session only), so the list index stays
 * proven. Audit rows of a run are not read: runs are not versioned.
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/**
 * The `kind` column values of the rows the step deletes: the workflow kind,
 * the workflow run kind under the name a store before the run rename holds
 * it by and the name after, and the artifact kind.
 */
export const RETIRED_WORKFLOW_KINDS: ReadonlyArray<string> = [
  "workflow",
  "workflow_execution",
  "workflow_run",
  "artifact",
];

/** The `kind` column value of the agent run rows the step rewrites. */
export const AGENT_RUN_KIND = "agent_run";
/** The `kind` column value of the grant rows the step reads. */
export const WORKFLOW_RETIRED_POLICY_KIND = "iam_policy";

/** The tables the step drops. */
export const RETIRED_WORKFLOW_TABLES: ReadonlyArray<string> = [
  "workflow_execution_events",
  "signal_dedupe",
];

/** How many grant rows the step decodes per page. */
export const WORKFLOW_RETIRED_PAGE_SIZE = 500;
/**
 * How many agent run rows the step decodes per page: fewer than the
 * grants', because a run's row carries its whole transcript.
 */
export const AGENT_RUN_RETIRED_PAGE_SIZE = 100;

/**
 * The retired AgentRunSpec fields that tied a run to the workflow step that
 * started it: 6 (`callback_token`), 8 (`parent_workflow_id`) and 11
 * (`activity_task_queue`) as every release through 3.41 wrote them, and 17
 * (`parent`) as the builds after the run rename wrote it.
 */
const RUN_SPEC_WORKFLOW_FIELDS: ReadonlySet<number> = new Set([6, 8, 11, 17]);
/** The retired AgentRunStatus field that held the workflow step's task token. */
const RUN_STATUS_CALLBACK_TOKEN_FIELD = 10;
/** The lineage label a workflow step's run carried naming its workflow run. */
const WORKFLOW_EXECUTION_LABEL = "stigmer.ai/workflow-execution-id";
/** The lineage labels the workflow runner stamped on a run it started. */
const WORKFLOW_LINEAGE_LABELS: ReadonlyArray<string> = [
  "stigmer.ai/workflow-execution-id",
  "stigmer.ai/workflow-task",
];

/**
 * The phases a run had finished in when this step shipped, held here rather
 * than read from the live domain so the step does what it did whatever
 * phases a later release adds.
 */
const FINISHED_RUN_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/** The error an unfinished run a workflow step started ends with. */
export const WORKFLOW_CHILD_ENDED_ERROR =
  "This run was started by a workflow step. Workflows were removed from Stigmer, so it cannot resume.";

/**
 * The migrated bytes of one agent run row, or undefined when it carries
 * neither retired field and neither lineage label (the driver then leaves
 * its bytes as they are). `endedAt` is the step's time (RFC 3339), stamped
 * as `completed_at` on an unfinished run a workflow step started. Throws
 * when the bytes do not decode.
 */
export function migrateAgentRunRow(data: Uint8Array, endedAt: string): Uint8Array | undefined {
  const run = fromBinary(RunSchema, data);
  const spec = run.spec;
  const status = run.status;
  const labels = run.metadata?.labels;
  const specHeld = (spec?.$unknown ?? []).some((f) =>
    RUN_SPEC_WORKFLOW_FIELDS.has(f.no),
  );
  const tokenHeld = (status?.$unknown ?? []).some(
    (f) => f.no === RUN_STATUS_CALLBACK_TOKEN_FIELD,
  );
  const lineage = WORKFLOW_LINEAGE_LABELS.filter(
    (key) => labels !== undefined && Object.hasOwn(labels, key),
  );
  if (!specHeld && !tokenHeld && lineage.length === 0) {
    return undefined;
  }
  const workflowStarted = specHeld || lineage.includes(WORKFLOW_EXECUTION_LABEL);
  if (workflowStarted && !FINISHED_RUN_PHASES.has(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    const ended = run.status ?? create(RunStatusSchema);
    ended.phase = RunPhase.RUN_FAILED;
    ended.error = WORKFLOW_CHILD_ENDED_ERROR;
    ended.completedAt = endedAt;
    run.status = ended;
  }
  if (spec !== undefined && specHeld) {
    spec.$unknown = (spec.$unknown ?? []).filter(
      (f) => !RUN_SPEC_WORKFLOW_FIELDS.has(f.no),
    );
    if (spec.$unknown.length === 0) {
      delete spec.$unknown;
    }
  }
  if (status !== undefined && tokenHeld) {
    status.$unknown = (status.$unknown ?? []).filter(
      (f) => f.no !== RUN_STATUS_CALLBACK_TOKEN_FIELD,
    );
    if (status.$unknown.length === 0) {
      delete status.$unknown;
    }
  }
  if (labels !== undefined) {
    for (const key of lineage) {
      delete labels[key];
    }
  }
  return toBinary(RunSchema, run);
}

/**
 * Whether a stored IamPolicy row names a retired kind as its resource or
 * its principal (an `ApiResourceRef.kind` is the enum member name, the
 * string the kind's rows were stored under). Read through the live schema:
 * the policy's own fields are unchanged. Throws when the bytes do not
 * decode.
 */
export function policyNamesRetiredWorkflowKind(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    RETIRED_WORKFLOW_KINDS.includes(spec?.resource?.kind ?? "") ||
    RETIRED_WORKFLOW_KINDS.includes(spec?.principal?.kind ?? "")
  );
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRetiredWorkflowRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the workflow kinds: ${String(error)}`,
    { cause: error },
  );
}
