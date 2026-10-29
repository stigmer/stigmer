/**
 * The one data migration both store drivers run when the Stigmer harness
 * takes the first word of its label as its one word: an identity account whose default
 * harness preference holds a word the platform no longer takes has it
 * rewritten, so the account can be updated again. The drivers own the SQL;
 * this module owns what one row becomes.
 *
 * Why a stored account needs it. An identity account's update validates the
 * whole merged stored message, so a `default_harness` outside the field's
 * `in:` list refuses every update of the account, including one that names
 * only another preference (the memory toggle). Two words left the list:
 *   - `native`, the Stigmer harness's word before it took `stigmer`, becomes
 *     `stigmer`, the same choice under its one word;
 *   - `cursor`, the retired Cursor harness's word, is cleared: that choice
 *     names no harness the platform runs, so the account falls to the
 *     platform default, as an unset preference does.
 * The words are frozen here, as the step knew them; every other value is
 * left as it is.
 *
 * A row the step rewrites is stamped with its etag again when it carried
 * one, as a write would stamp it (eval-kinds-retired.ts, the precedent).
 * Every other field, unknown ones included, rides through the decode and
 * the encode. A row whose default holds neither word is left byte for byte
 * as it is. `updated_at` is left alone: the list keys are unchanged.
 *
 * An undecodable row fails the step: the driver's transaction rolls back
 * and the boot stops on the row it names.
 *
 * Pinned by __tests__/harness-word-renamed.test.ts and both drivers'
 * migration arms.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import { stampEtag, storedEtagOf } from "./etag.js";

/** The `kind` column value of the rows the step rewrites. */
export const HARNESS_WORD_KIND = "identity_account";

/** How many identity account rows the step decodes per page. */
export const HARNESS_WORD_PAGE_SIZE = 100;

/** Each word the step rewrites in a stored default harness, and what it becomes ("" clears it). */
const RENAMED_DEFAULT_HARNESS: ReadonlyMap<string, string> = new Map([
  ["native", "stigmer"],
  ["cursor", ""],
]);

/**
 * The bytes of one identity account row with its default harness rewritten,
 * or undefined when the default holds neither retired word (the driver
 * then leaves its bytes as they are). Throws when the bytes do not decode.
 */
export function migrateHarnessWordRow(data: Uint8Array): Uint8Array | undefined {
  const account = fromBinary(IdentityAccountSchema, data);
  const preferences = account.spec?.preferences;
  const renamed = preferences === undefined ? undefined : RENAMED_DEFAULT_HARNESS.get(preferences.defaultHarness);
  if (preferences === undefined || renamed === undefined) {
    return undefined;
  }
  preferences.defaultHarness = renamed;
  if ((storedEtagOf(IdentityAccountSchema, account) ?? "") !== "") {
    stampEtag(IdentityAccountSchema, account);
  }
  return toBinary(IdentityAccountSchema, account);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableHarnessWordError(id: string, error: unknown): Error {
  return new Error(
    `${HARNESS_WORD_KIND} '${id}' cannot be read to rewrite its default harness: ${String(error)}`,
    { cause: error },
  );
}
