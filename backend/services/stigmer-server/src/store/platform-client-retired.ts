/**
 * The one data migration both store drivers run when the platform client
 * kind leaves the platform: a product now mints its people's tokens with a
 * service account's key, and the sign-in settings a client held live in
 * the organization's embedding settings. The drivers own the SQL (which
 * rows to read, in what pages, how to delete them, the transaction); this
 * module owns what is edition- and driver-neutral: which kind goes and
 * which grant names one. It follows workflow-instance-retired.ts.
 *
 * What leaves. Every platform client row leaves every table that keys a
 * row by kind (run-rename.ts `RUN_KIND_TABLES`): the live rows, their
 * history, their list keys and the names they held. A client's settings
 * are not copied into its organization's embedding settings: an
 * organization could hold several clients with different settings, and
 * which to keep is its admins' choice, made once through updateEmbedding.
 * Every IamPolicy row whose resource or principal is a platform client
 * leaves too (`policyNamesRetiredPlatformClient`): a grant on an object
 * that no longer exists would only linger in grant listings. Such a row
 * leaves the way the store deletes a policy, with its list keys and with
 * its history kept. Search entries are boot's rebuild's to drop; clients
 * were never search-indexed.
 *
 * What stays. The accounts the clients' mints created stay, with their
 * `stgm_pc|` subjects, their roles and everything they wrote: their
 * provisioning mode keeps its number as `app_user`, and their audit's old
 * client id rides as an unknown field no reader asks for. The history
 * entries a client's sign-in grants wrote keep their cause.
 *
 * An undecodable grant fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

/** The `kind` column value of the rows the step removes. */
export const RETIRED_PLATFORM_CLIENT_KIND = "platform_client";
/** The `kind` column value of the grant rows the step reads. */
export const PLATFORM_CLIENT_RETIRED_POLICY_KIND = "iam_policy";

/** How many grant rows the step decodes per page. */
export const PLATFORM_CLIENT_RETIRED_PAGE_SIZE = 500;

/**
 * Whether a stored IamPolicy row names a platform client as its resource
 * or its principal (an `ApiResourceRef.kind` is the enum member name, the
 * string the kind's rows were stored under). Read through the live schema:
 * the policy's own fields are unchanged. Throws when the bytes do not
 * decode.
 */
export function policyNamesRetiredPlatformClient(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    spec?.resource?.kind === RETIRED_PLATFORM_CLIENT_KIND ||
    spec?.principal?.kind === RETIRED_PLATFORM_CLIENT_KIND
  );
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadablePlatformClientRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the platform client kind: ${String(error)}`,
    { cause: error },
  );
}
