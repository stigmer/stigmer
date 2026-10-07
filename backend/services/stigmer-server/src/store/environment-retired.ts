/**
 * The one data migration both store drivers run when credentials replace
 * environments: the environment kind leaves the store, with every grant
 * that names one, and the OAuth grant table takes its new columns. The
 * drivers own the SQL (which rows to read, in what pages, the
 * transaction); this module owns what is edition- and driver-neutral:
 * which kind goes and which grant names it. It follows
 * workflow-retired.ts.
 *
 * What leaves. Every environment row leaves every table that keys a row
 * by kind (run-rename.ts `RUN_KIND_TABLES`): the live rows, their history,
 * their list keys and the names they held. Nothing is carried into a
 * credential: a person saves their keys again, and the platform has no
 * users to carry them for. Every IamPolicy row whose resource or principal
 * is an environment leaves too (`policyNamesEnvironment`), with its list
 * keys and with its history kept, the way the store deletes a policy.
 * Search entries of the removed rows are boot's rebuild's to drop.
 *
 * The OAuth grants. A sign-in kept its tokens in an environment, which
 * leaves with the rest, so every grant that named one is deleted (its
 * person signs in again, and the sign-in is then a credential). The table
 * then names the credential holding a sign-in's access token
 * (`credential_id`, the old `environment_id` column renamed) and keeps the
 * sealed refresh token itself (`refresh_token`); the column that named the
 * refresh token's variable is dropped.
 *
 * An undecodable grant row fails the step, the rule the other data
 * migrations keep: the driver's transaction rolls back and the boot stops
 * on the row it names.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/** The `kind` column value of the rows the step deletes. */
export const ENVIRONMENT_KIND = "environment";

/** The `kind` column value of the grant rows the step reads. */
export const ENVIRONMENT_RETIRED_POLICY_KIND = "iam_policy";

/** How many grant rows the step decodes per page. */
export const ENVIRONMENT_RETIRED_PAGE_SIZE = 500;

/** Whether an IamPolicy row names an environment as its resource or principal. Throws when the bytes do not decode. */
export function policyNamesEnvironment(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    (spec?.resource?.kind ?? "") === ENVIRONMENT_KIND ||
    (spec?.principal?.kind ?? "") === ENVIRONMENT_KIND
  );
}

/** The step's failure for a row it cannot read. */
export function unreadableEnvironmentRetiredRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the environment kind: ${String(error)}`,
    { cause: error },
  );
}
