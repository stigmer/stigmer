/**
 * The one data migration both store drivers run when agent executions
 * became runs: the kind's stored name and the rows that spell it. The
 * drivers own the SQL (which rows to read, in what pages, how to write
 * them, the transaction); this module owns what is driver-neutral: what
 * one row becomes. It is the twin of workflow-instance-retired.ts.
 *
 * What changes, and why each row must.
 *
 *   - The `kind` column. A kind's stored name is its enum value name
 *     (proto-fields.ts `apiResourceKindName`), and the kind was renamed
 *     with its number and id prefix kept: `agent_execution` became
 *     `agent_run`. Every table that keys a row by kind follows
 *     (`RUN_KIND_TABLES`). The search index is not among them: boot's
 *     rebuild clears it and indexes every registered kind before the port
 *     binds.
 *   - A run row's `kind` string. Every stored run carries its kind's
 *     display name in its bytes (`AgentExecution`), which a read returns
 *     and an update of a fetched run must send back under the contract's
 *     const (`AgentRun`), so the row is rewritten. Field and enum value
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
 *
 * 2026-10-07: this step no longer renames workflow runs, their event log's
 * types or the run keys in workflow steps. The workflow product was
 * removed, and the later step in workflow-retired.ts deletes every
 * workflow, workflow run (under either kind name) and grant naming one,
 * and drops the event log, so nothing those arms wrote survives the chain:
 * a store replayed from before this step reaches the state the full step
 * would have left.
 *
 * A row this migration does not change is left byte for byte as it is. An
 * undecodable row fails the step, the rule the other data migrations keep
 * (public-visibility-retired.ts): the driver's transaction rolls back and
 * the boot stops on the row it names.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { policyIdFor } from "../domain/iampolicy/constants.js";

/** The run kind's stored name before the rename. */
export const RETIRED_AGENT_RUN_KIND = "agent_execution";

/** The run kind's stored name before and after the rename. */
export const RUN_KIND_RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  [RETIRED_AGENT_RUN_KIND, "agent_run"],
];

/** The tables that key a row by kind. */
export const RUN_KIND_TABLES: ReadonlyArray<string> = [
  "resources",
  "resource_audit",
  "resource_list_keys",
  "resource_names",
];

/** The `kind` column value of the grant rows the step reads. */
export const RUN_RENAME_POLICY_KIND = "iam_policy";

/** How many rows of a kind the step decodes per page. */
export const RUN_RENAME_PAGE_SIZE = 500;

/** The run kind's display name in a row's bytes, before and after. */
const RUN_KIND_STRINGS: ReadonlyMap<string, string> = new Map([
  ["AgentExecution", "AgentRun"],
]);

/**
 * The migrated bytes of one agent run row, or undefined when its kind
 * string is already current. Throws when the bytes do not decode.
 */
export function renamedAgentRunRow(data: Uint8Array): Uint8Array | undefined {
  const run = fromBinary(RunSchema, data);
  const kind = RUN_KIND_STRINGS.get(run.kind);
  if (kind === undefined) {
    return undefined;
  }
  run.kind = kind;
  return toBinary(RunSchema, run);
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
