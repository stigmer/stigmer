/**
 * The one data migration both store drivers run when agent and workflow
 * executions became runs: the kinds' stored names, the rows that spell
 * them, and the workflow language's two run-named keys. The drivers own
 * the SQL (which rows to read, in what pages, how to write them, the
 * transaction); this module owns what is driver-neutral: what one row
 * becomes. It is the twin of workflow-instance-retired.ts.
 *
 * What changes, and why each row must.
 *
 *   - The `kind` column. A kind's stored name is its enum value name
 *     (proto-fields.ts `apiResourceKindName`), and the kinds were renamed
 *     with their numbers and id prefixes kept: `agent_execution` became
 *     `agent_run`, `workflow_execution` became `workflow_run`. Every table
 *     that keys a row by kind follows (`RUN_KIND_TABLES`). The search index
 *     is not among them: boot's rebuild clears it and indexes every
 *     registered kind before the port binds.
 *   - A run row's `kind` string. Every stored run carries its kind's
 *     display name in its bytes (`AgentExecution`, `WorkflowExecution`),
 *     which a read returns and an update of a fetched run must send back
 *     under the contract's const (`AgentRun`, `WorkflowRun`), so the row is
 *     rewritten. A workflow run's task metadata and agent_call outputs name
 *     the child run `agent_execution_id`; the key is now `agent_run_id`, the
 *     one a workflow reads (`renamedWorkflowRunRow`). Field and enum value
 *     renames need nothing: the rows are binary, by number. A run's audit
 *     rows keep their bytes: only version history decodes audit rows, and
 *     runs are not versioned.
 *   - Grants on a run. An IamPolicy names its subject and object by kind as
 *     a string (`ApiResourceRef.kind`), and its id is derived from that
 *     triple's text (domain/iampolicy/constants.ts `policyIdFor`), so a
 *     policy naming a run is re-keyed to the id its new text derives, or a
 *     revoke would never find it. Its old row leaves the way the store
 *     deletes a policy, with its list keys and with its history kept; the
 *     driver writes the new row unproven, so its list keys are derived on
 *     read (list-index.ts).
 *   - The workflow language. A workflow's step configs are JSON inside the
 *     workflow and inside each of its archived versions, read strictly
 *     (domain/workflow/converter/unmarshal.ts), and the runner runs the
 *     YAML the validator wrote from them (`status.serverless_workflow_validation`).
 *     An emit_event signal target was keyed `execution_id` and is now
 *     `run_id`; an agent_call step's output named the child run
 *     `agent_execution_id` and now names it `agent_run_id`, so expressions
 *     that read it (`${ .triage.agent_execution_id }`) are rewritten too.
 *     A rewritten workflow's YAML is regenerated from its rewritten spec by
 *     the validator's own converter. Version hashes are not rewritten: runs
 *     are pinned to them and their audit rows keep answering, so a changed
 *     head mints one version at its next save (domain/workflow/steps.ts).
 *
 * A row this migration does not change is left byte for byte as it is. An
 * undecodable row fails the step, the rule the other data migrations keep
 * (public-visibility-retired.ts): the driver's transaction rolls back and
 * the boot stops on the row it names.
 */
import { fromBinary, toBinary, type JsonObject, type JsonValue } from "@bufbuild/protobuf";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { policyIdFor } from "../domain/iampolicy/constants.js";
import { protoToYaml } from "../domain/workflow/converter/converter.js";

/** The run kinds' stored names before the rename. */
export const RETIRED_AGENT_RUN_KIND = "agent_execution";
export const RETIRED_WORKFLOW_RUN_KIND = "workflow_execution";

/** Each run kind's stored name before and after the rename. */
export const RUN_KIND_RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  [RETIRED_AGENT_RUN_KIND, "agent_run"],
  [RETIRED_WORKFLOW_RUN_KIND, "workflow_run"],
];

/** The tables whose `kind` column names a run kind. */
export const RUN_KIND_TABLES: ReadonlyArray<string> = [
  "resources",
  "resource_audit",
  "resource_list_keys",
  "resource_names",
];

/** The `kind` column values of the other rows the step reads. */
export const RUN_RENAME_POLICY_KIND = "iam_policy";
export const RUN_RENAME_WORKFLOW_KIND = "workflow";

/** How many rows of a kind the step decodes per page. */
export const RUN_RENAME_PAGE_SIZE = 500;

/** Each run kind's display name in a row's bytes, before and after. */
const RUN_KIND_STRINGS: ReadonlyMap<string, string> = new Map([
  ["AgentExecution", "AgentRun"],
  ["WorkflowExecution", "WorkflowRun"],
]);

/** The agent_call key that names the child run, before and after. */
const RETIRED_AGENT_CALL_RUN_KEY = "agent_execution_id";
const AGENT_CALL_RUN_KEY = "agent_run_id";

/** The emit_event signal target's run key, before and after. */
const RETIRED_SIGNAL_RUN_KEY = "execution_id";
const SIGNAL_RUN_KEY = "run_id";

/** The expression token a workflow reads the child run by, as a whole word. */
const RETIRED_AGENT_CALL_RUN_TOKEN = /\bagent_execution_id\b/g;

/**
 * The migrated bytes of one agent run row, or undefined when its kind
 * string is already current. Throws when the bytes do not decode.
 */
export function renamedAgentRunRow(data: Uint8Array): Uint8Array | undefined {
  const run = fromBinary(AgentRunSchema, data);
  const kind = RUN_KIND_STRINGS.get(run.kind);
  if (kind === undefined) {
    return undefined;
  }
  run.kind = kind;
  return toBinary(AgentRunSchema, run);
}

/**
 * The migrated bytes of one workflow run row, or undefined when nothing in
 * it names a run the old way. Throws when the bytes do not decode.
 */
export function renamedWorkflowRunRow(data: Uint8Array): Uint8Array | undefined {
  const run = fromBinary(WorkflowRunSchema, data);
  let changed = false;
  const kind = RUN_KIND_STRINGS.get(run.kind);
  if (kind !== undefined) {
    run.kind = kind;
    changed = true;
  }
  for (const task of run.status?.tasks ?? []) {
    for (const struct of [task.metadata, task.output]) {
      if (struct !== undefined && renameKey(struct, RETIRED_AGENT_CALL_RUN_KEY, AGENT_CALL_RUN_KEY)) {
        changed = true;
      }
    }
  }
  return changed ? toBinary(WorkflowRunSchema, run) : undefined;
}

/** What the step made of one grant row. */
export interface RekeyedPolicy {
  /** The id the policy's renamed triple derives. */
  readonly id: string;
  /** The row's new bytes, its metadata id the new one. */
  readonly data: Uint8Array;
}

/**
 * The re-keyed grant of one IamPolicy row whose subject or object is a run
 * kind, or undefined when it names neither. Throws when the bytes do not
 * decode.
 */
export function rekeyedRunPolicy(data: Uint8Array): RekeyedPolicy | undefined {
  const policy = fromBinary(IamPolicySchema, data);
  const spec = policy.spec;
  if (spec === undefined) {
    return undefined;
  }
  let changed = false;
  for (const ref of [spec.resource, spec.principal]) {
    const renamed = ref === undefined ? undefined : runKindRename(ref.kind);
    if (ref !== undefined && renamed !== undefined) {
      ref.kind = renamed;
      changed = true;
    }
  }
  if (!changed) {
    return undefined;
  }
  const id = policyIdFor(spec);
  if (policy.metadata !== undefined) {
    policy.metadata.id = id;
  }
  return { id, data: toBinary(IamPolicySchema, policy) };
}

/**
 * The migrated bytes of one workflow row, a head or an archived version,
 * or undefined when its steps name no run the old way. Throws when the
 * bytes do not decode or the rewritten spec does not convert.
 */
export function renamedWorkflowRow(data: Uint8Array): Uint8Array | undefined {
  const workflow = fromBinary(WorkflowSchema, data);
  const spec = workflow.spec;
  if (spec === undefined || !rewriteTasks(spec.tasks)) {
    return undefined;
  }
  const validation = workflow.status?.serverlessWorkflowValidation;
  if (validation !== undefined && validation.yaml !== "") {
    validation.yaml = protoToYaml(spec);
  }
  return toBinary(WorkflowSchema, workflow);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRunRenameRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `the ${kind} row ${id} cannot be read for the rename of executions to runs: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

function runKindRename(kind: string): string | undefined {
  return RUN_KIND_RENAMES.find(([from]) => from === kind)?.[1];
}

function rewriteTasks(tasks: WorkflowTask[]): boolean {
  let changed = false;
  for (const task of tasks) {
    if (task.taskConfig !== undefined && rewriteStepJson(task.taskConfig)) {
      changed = true;
    }
  }
  return changed;
}

/**
 * Rewrites one step config in place, nested steps included: a signal
 * target's run key, and the agent_call run key in every expression.
 * Answers whether anything changed.
 */
function rewriteStepJson(value: JsonObject): boolean {
  let changed = false;
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "signal" &&
      isObject(item) &&
      renameKey(item, RETIRED_SIGNAL_RUN_KEY, SIGNAL_RUN_KEY)
    ) {
      changed = true;
    }
    const next = value[key];
    if (typeof next === "string") {
      const rewritten = rewriteExpression(next);
      if (rewritten !== next) {
        value[key] = rewritten;
        changed = true;
      }
    } else if (next !== undefined && rewriteNested(next)) {
      changed = true;
    }
  }
  return changed;
}

function rewriteNested(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string") {
        const rewritten = rewriteExpression(item);
        if (rewritten !== item) {
          value[i] = rewritten;
          changed = true;
        }
      } else if (item !== undefined && rewriteNested(item)) {
        changed = true;
      }
    }
    return changed;
  }
  return isObject(value) ? rewriteStepJson(value) : false;
}

/** An expression (`${ ... }`) reads the child run by its new key; any other string is left as written. */
function rewriteExpression(text: string): string {
  return text.includes("${")
    ? text.replace(RETIRED_AGENT_CALL_RUN_TOKEN, AGENT_CALL_RUN_KEY)
    : text;
}

/** Renames `from` to `to` in one object, in place, keeping key order. */
function renameKey(value: JsonObject, from: string, to: string): boolean {
  if (!(from in value) || to in value) {
    return false;
  }
  const entries = Object.entries(value);
  for (const key of Object.keys(value)) {
    delete value[key];
  }
  for (const [key, item] of entries) {
    value[key === from ? to : key] = item;
  }
  return true;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
