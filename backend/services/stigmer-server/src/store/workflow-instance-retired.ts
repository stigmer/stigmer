/**
 * The one data migration both store drivers run when the workflow instance
 * kind is removed: every workflow run that started through an instance
 * names the instance's workflow directly, and the instance rows leave the
 * store. The drivers own the SQL (which rows to read, in what pages, how to
 * write them, the transaction); this module owns what is edition- and
 * driver-neutral: how a retired instance row names its workflow, and what
 * one run row becomes. It is the twin of agent-instance-retired.ts.
 *
 * What a run becomes. A run stored before the release holds its instance id
 * in WorkflowExecutionSpec field 1 and may hold the retired callback token
 * in field 7; the contract now reserves both, so the current schema decodes
 * them as unknown fields (protobuf-es keeps unknown fields through
 * `fromBinary`). They are read by wire number, never through a schema that
 * no longer exists, and dropped:
 *
 *   - the run names its workflow already (`spec.workflow_id`): it keeps
 *     that id, whatever its instance names;
 *   - the run names no workflow and its instance survives naming one: the
 *     run names that workflow, the one it ran through the instance;
 *   - the run names no workflow and its instance is gone, or names none:
 *     nothing is left that names the run's workflow, and the run keeps its
 *     history as it is. Recovering it is refused and no workflow lists it;
 *   - a run that carries neither retired field is left byte for byte as it
 *     is.
 *
 * The version a run pinned (`status.workflow_version_hash`) is not touched:
 * it was always the workflow's version, whichever door the run came in by.
 *
 * What leaves with the instances. Every instance's `environment_refs` and
 * run visibility are dropped with it: no row the step writes carries them
 * anywhere, and a workflow's runs start private. Every IamPolicy row whose
 * resource or principal is an instance leaves too
 * (`policyNamesRetiredWorkflowInstance`): a grant on an object that no
 * longer exists would only linger in grant listings. Such a row leaves the
 * way the store deletes a policy, with its list keys and with its history
 * kept.
 *
 * Workflow rows are not rewritten: a workflow's retired default-instance
 * pointer rides as an unknown field no reader decodes. The list keys of the
 * removed rows go with them; a run's own list keys are re-derived by the
 * store, because the run list index's revision changed with its keys
 * (list-index.ts), and their search entries are boot's rebuild's to drop.
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { FrozenWorkflowInstanceEnvelopeSchema } from "./frozen-workflow-instance.js";

/** The `kind` column values the step reads and removes. */
export const RETIRED_WORKFLOW_INSTANCE_KIND = "workflow_instance";
export const WORKFLOW_EXECUTION_KIND = "workflow_execution";
/** The `kind` column value of the grant rows the step reads. */
export const WORKFLOW_RETIREMENT_POLICY_KIND = "iam_policy";

/** How many rows of a kind the step decodes per page. */
export const WORKFLOW_RETIREMENT_PAGE_SIZE = 500;

/** The retired WorkflowExecutionSpec fields: the instance id and the callback token. */
const RUN_SPEC_INSTANCE_FIELD = 1;
const RUN_SPEC_CALLBACK_TOKEN_FIELD = 7;
/** The retired WorkflowInstance fields: spec, and spec.workflow_id within it. */
const INSTANCE_SPEC_FIELD = 4;
const INSTANCE_SPEC_WORKFLOW_FIELD = 1;

/** What the step made of one run row. */
export interface MigratedRun {
  /** The row's new bytes. */
  readonly data: Uint8Array;
  /**
   * Whether the run gained its workflow id, which changes the list key a
   * run is found by, so the driver marks the row for re-derivation.
   */
  readonly workflowIdFilled: boolean;
}

/**
 * The workflow id a retired instance row names (spec.workflow_id), or ""
 * when it names none. Throws when the bytes do not decode.
 */
export function workflowInstanceWorkflowIdOf(data: Uint8Array): string {
  const envelope = fromBinary(FrozenWorkflowInstanceEnvelopeSchema, data);
  const spec = lastLengthDelimited(envelope.$unknown, INSTANCE_SPEC_FIELD);
  if (spec === undefined) {
    return "";
  }
  return stringField(spec, INSTANCE_SPEC_WORKFLOW_FIELD) ?? "";
}

/**
 * The migrated bytes of one run row, or undefined when it carries neither
 * retired field (the driver then leaves its bytes as they are).
 * `workflowOf` answers the workflow id a surviving instance names, or
 * undefined when the instance is gone. Throws when the bytes do not decode.
 */
export function migrateWorkflowExecutionRow(
  data: Uint8Array,
  workflowOf: (instanceId: string) => string | undefined,
): MigratedRun | undefined {
  const run = fromBinary(WorkflowRunSchema, data);
  const spec = run.spec;
  const retired = (no: number): boolean =>
    no === RUN_SPEC_INSTANCE_FIELD || no === RUN_SPEC_CALLBACK_TOKEN_FIELD;
  if (spec === undefined || !(spec.$unknown ?? []).some((f) => retired(f.no))) {
    return undefined;
  }
  const held = lastLengthDelimited(spec.$unknown, RUN_SPEC_INSTANCE_FIELD);
  const instanceId = held === undefined ? "" : new TextDecoder().decode(held);
  spec.$unknown = (spec.$unknown ?? []).filter((f) => !retired(f.no));
  if (spec.$unknown.length === 0) {
    delete spec.$unknown;
  }
  let workflowIdFilled = false;
  if (spec.workflowId === "" && instanceId !== "") {
    const workflowId = workflowOf(instanceId) ?? "";
    if (workflowId !== "") {
      spec.workflowId = workflowId;
      workflowIdFilled = true;
    }
  }
  return { data: toBinary(WorkflowRunSchema, run), workflowIdFilled };
}

/**
 * Whether a stored IamPolicy row names a workflow instance as its resource
 * or its principal (an `ApiResourceRef.kind` is the enum member name, the
 * string the instance kind's rows were stored under). Read through the
 * live schema: the policy's own fields are unchanged. Throws when the
 * bytes do not decode.
 */
export function policyNamesRetiredWorkflowInstance(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    spec?.resource?.kind === RETIRED_WORKFLOW_INSTANCE_KIND ||
    spec?.principal?.kind === RETIRED_WORKFLOW_INSTANCE_KIND
  );
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableWorkflowRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the workflow instance kind: ${String(error)}`,
    { cause: error },
  );
}

type UnknownFields = ReadonlyArray<{
  readonly no: number;
  readonly wireType: WireType;
  readonly data: Uint8Array;
}>;

/**
 * The content of the last occurrence of a length-delimited unknown field
 * (proto's last-one-wins for a singular field), without its length prefix.
 */
function lastLengthDelimited(
  fields: UnknownFields | undefined,
  no: number,
): Uint8Array | undefined {
  const held = (fields ?? []).filter(
    (f) => f.no === no && f.wireType === WireType.LengthDelimited,
  );
  const last = held[held.length - 1];
  return last === undefined ? undefined : new BinaryReader(last.data).bytes();
}

/** A string field of an encoded message, by number; the last one wins. */
function stringField(message: Uint8Array, no: number): string | undefined {
  const reader = new BinaryReader(message);
  let value: string | undefined;
  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === no && wireType === WireType.LengthDelimited) {
      value = reader.string();
    } else {
      reader.skip(wireType, fieldNo);
    }
  }
  return value;
}
