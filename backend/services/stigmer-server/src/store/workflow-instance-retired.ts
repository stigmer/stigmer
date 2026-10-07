/**
 * The one data migration both store drivers run when the workflow instance
 * kind is removed: the instance rows leave the store, with every grant that
 * names one. The drivers own the SQL (which rows to read, in what pages,
 * how to delete them, the transaction); this module owns what is edition-
 * and driver-neutral: which grant names a retired instance. It is the twin
 * of agent-instance-retired.ts.
 *
 * What leaves with the instances. Every instance's `environment_refs` and
 * run visibility are dropped with it. Every IamPolicy row whose resource or
 * principal is an instance leaves too (`policyNamesRetiredWorkflowInstance`):
 * a grant on an object that no longer exists would only linger in grant
 * listings. Such a row leaves the way the store deletes a policy, with its
 * list keys and with its history kept. The list keys of the removed rows go
 * with them, and their search entries are boot's rebuild's to drop.
 *
 * 2026-10-07: this step no longer rewrites the workflow runs that started
 * through an instance. The workflow product was removed, and the later
 * step in workflow-retired.ts deletes every workflow, workflow run and grant
 * naming one, so nothing the run rewrite wrote survives the chain: a store
 * replayed from before this step reaches the state the full step would
 * have left.
 *
 * An undecodable grant fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/** The `kind` column value of the rows the step removes. */
export const RETIRED_WORKFLOW_INSTANCE_KIND = "workflow_instance";
/** The `kind` column value of the grant rows the step reads. */
export const WORKFLOW_RETIREMENT_POLICY_KIND = "iam_policy";

/** How many grant rows the step decodes per page. */
export const WORKFLOW_RETIREMENT_PAGE_SIZE = 500;

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
