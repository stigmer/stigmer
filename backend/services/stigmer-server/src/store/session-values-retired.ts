/**
 * The one data migration both store drivers run when a conversation's own
 * secrets and logins leave the contract: every stored session is rewritten
 * without them. The drivers own the SQL (the pages, the writes, the
 * transaction); this module owns what one row becomes.
 *
 * A session stored before the release may hold SessionSpec field 16
 * (secrets) and field 17 (connections), which the contract now reserves,
 * so the current schema decodes them as unknown fields (protobuf-es keeps
 * unknown fields through `fromBinary` and writes them back through
 * `toBinary`). Left alone, every sealed key handed to a conversation would
 * stay in its row, rewritten on every turn and readable by nothing, until
 * the conversation or its organization is purged. They are read by wire
 * number, never through a schema that no longer exists
 * (execution-config-retired.ts, the precedent), and dropped. Nothing is
 * carried: a value held only on a conversation is gone, and its holder
 * saves it in a vault.
 *
 * The values were sealed by codecs that keep the ciphertext in the row
 * (pipeline/steps/secret-cleanup.ts: destroying their backing state is a
 * no-op), so dropping the bytes leaves nothing behind. A repository's own
 * token (GitRepoSource.token) stays: it is still part of the contract.
 *
 * A row without either field is left byte for byte as it is. Only the live
 * rows are rewritten; sessions write no audit snapshots. Their
 * `updated_at` is left alone: the session list keys are read from the
 * agent reference (domain/session/list-index.ts), which the step does not
 * touch, so the list index stays proven, and the stamp keeps meaning the
 * conversation's last activity.
 *
 * Agent rows keep the retired AgentSpec.vaults (field 15) as unknown
 * bytes: they are references, not keys, as the retired environment
 * references were left (environment-retired.ts).
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep: the driver's transaction rolls back and the boot stops on the row
 * it names.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

/** The `kind` column value of the rows the step rewrites. */
export const SESSION_VALUES_KIND = "session";

/** How many session rows the step decodes per page. */
export const SESSION_VALUES_PAGE_SIZE = 100;

/** The retired SessionSpec fields: a conversation's own secrets and connections. */
const RETIRED_SPEC_FIELDS: ReadonlySet<number> = new Set([16, 17]);

/**
 * The migrated bytes of one session row, or undefined when it holds
 * neither retired field (the driver then leaves its bytes as they are).
 * Throws when the bytes do not decode.
 */
export function migrateSessionValuesRow(data: Uint8Array): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const spec = session.spec;
  const unknown = spec?.$unknown ?? [];
  const kept = unknown.filter((field) => !RETIRED_SPEC_FIELDS.has(field.no));
  if (spec === undefined || kept.length === unknown.length) {
    return undefined;
  }
  if (kept.length === 0) {
    delete spec.$unknown;
  } else {
    spec.$unknown = kept;
  }
  return toBinary(SessionSchema, session);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableSessionValuesError(id: string, error: unknown): Error {
  return new Error(
    `${SESSION_VALUES_KIND} '${id}' cannot be read to drop its retired secrets and connections: ${String(error)}`,
    { cause: error },
  );
}
