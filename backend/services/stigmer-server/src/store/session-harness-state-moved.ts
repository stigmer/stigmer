/**
 * The one data migration both store drivers run for a session's retired
 * harness state: SessionSpec fields 3 (harness_state_id) and 13
 * (harness_state_id_history), the harness's own conversation id and the ids
 * it replaced. They first moved to SessionStatus fields 5 and 6; their only
 * writer was the retired Cursor harness, and the status fields are reserved
 * too, so nothing reads them anywhere. A session stored before the move has
 * them dropped from its spec, so the row reads as the current release
 * writes it. The drivers own the SQL; this module owns what one row
 * becomes.
 *
 * The retired fields are recognised by wire number, never through a schema
 * that no longer exists (session-values-retired.ts, the precedent). A spec
 * field no release defined is kept.
 *
 * A row without either field is left byte for byte as it is. Only the live
 * rows are rewritten; sessions write no audit snapshots. `updated_at` is
 * left alone: the list keys the session feeds are unchanged.
 *
 * An undecodable row fails the step: the driver's transaction rolls back
 * and the boot stops on the row it names.
 *
 * Pinned by __tests__/session-harness-state-moved.test.ts and both
 * drivers' migration arms.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

/** The `kind` column value of the rows the step rewrites. */
export const SESSION_HARNESS_KIND = "session";

/** How many session rows the step decodes per page. */
export const SESSION_HARNESS_PAGE_SIZE = 100;

/** SessionSpec's retired harness_state_id. */
const RETIRED_ID_FIELD = 3;

/** SessionSpec's retired harness_state_id_history. */
const RETIRED_HISTORY_FIELD = 13;

/**
 * The bytes of one session row without the retired fields, or undefined
 * when its spec holds neither (the driver then leaves its bytes as they are).
 * Throws when the bytes do not decode.
 */
export function migrateSessionHarnessRow(data: Uint8Array): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const spec = session.spec;
  const unknown = spec?.$unknown ?? [];
  const isRetired = (no: number) => no === RETIRED_ID_FIELD || no === RETIRED_HISTORY_FIELD;
  if (spec === undefined || !unknown.some((field) => isRetired(field.no))) {
    return undefined;
  }
  const kept = unknown.filter((field) => !isRetired(field.no));
  if (kept.length === 0) {
    delete spec.$unknown;
  } else {
    spec.$unknown = kept;
  }
  return toBinary(SessionSchema, session);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableSessionHarnessError(id: string, error: unknown): Error {
  return new Error(
    `${SESSION_HARNESS_KIND} '${id}' cannot be read to drop its retired harness state: ${String(error)}`,
    { cause: error },
  );
}
