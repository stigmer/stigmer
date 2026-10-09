/**
 * The one data migration both store drivers run when vaults replace the
 * Environment kind: environment rows leave the store, with every grant that
 * names one and the sign-in grant table, and nothing is carried into a
 * vault. The drivers own the SQL (which rows to read, in what pages, how to
 * delete them, the transaction); this module owns what is edition- and
 * driver-neutral: which kind goes, which grant names one, and which table
 * is dropped. It follows workflow-retired.ts, its line's latest.
 *
 * What leaves. Every `environment` row leaves every table that keys a row
 * by kind (run-rename.ts `RUN_KIND_TABLES`): the live rows (a person's
 * personal environment and every OAuth-managed one included), their
 * history, their list keys and the names they held. No value is moved into
 * a vault: a person saves their keys again, and signs in again, into My
 * vault. Every IamPolicy row whose resource or principal is an environment
 * leaves too (`policyNamesRetiredEnvironment`): a grant on an object that no
 * longer exists would only linger in grant listings. Such a row leaves the
 * way the store deletes a policy, with its list keys and with its history
 * kept. The `oauth_grant` table, which held each sign-in's renewal
 * metadata beside its managed environment, is dropped: a sign-in now lives
 * on its vault connection. Search entries of the removed rows are boot's
 * rebuild's to drop.
 *
 * Installed channels lose their provider credentials. A channel
 * integration (a Slack channel's bot token, for one) kept its token in a
 * system-managed environment that `AgentChannelStatus.credentials_environment_id`
 * named; the environment row leaves here and the field is retired, so
 * nothing reads the token again. A composition that stored such tokens
 * moves them into its own credential store before taking this version, or
 * reinstalls each channel after it.
 *
 * What stays. Rows that named an environment (a channel's, a share's, a
 * schedule's and a platform client's `environment_refs`) keep the retired
 * field's bytes as an unknown field no reader decodes, and run with the
 * vaults their owner attaches. The sealed values of a removed row are not
 * destroyed one by one: the built-in codec keeps nothing outside the row,
 * and a codec that does keeps it under the organization's keys, which the
 * organization's purge destroys.
 *
 * An undecodable grant row fails the step, the rule the other data
 * migrations keep (public-visibility-retired.ts): the driver's transaction
 * rolls back and the boot stops on the row it names.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/** The `kind` column value of the rows the step deletes. */
export const RETIRED_ENVIRONMENT_KIND = "environment";

/** The `kind` column value of the grant rows the step reads. */
export const ENVIRONMENT_RETIRED_POLICY_KIND = "iam_policy";

/** The table the step drops. */
export const RETIRED_ENVIRONMENT_TABLES: ReadonlyArray<string> = ["oauth_grant"];

/** How many grant rows the step decodes per page. */
export const ENVIRONMENT_RETIRED_PAGE_SIZE = 500;

/**
 * Whether a stored IamPolicy row names the environment kind as its
 * resource or its principal (an `ApiResourceRef.kind` is the enum member
 * name, the string the kind's rows were stored under). Throws when the
 * bytes do not decode.
 */
export function policyNamesRetiredEnvironment(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    spec?.resource?.kind === RETIRED_ENVIRONMENT_KIND ||
    spec?.principal?.kind === RETIRED_ENVIRONMENT_KIND
  );
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRetiredEnvironmentRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the environment kind: ${String(error)}`,
    { cause: error },
  );
}
