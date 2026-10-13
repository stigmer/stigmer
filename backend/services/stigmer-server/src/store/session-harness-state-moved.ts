/**
 * The one data migration both store drivers run when a session's harness
 * state moves from its spec to its status: the harness's conversation id
 * and the ids it replaced are the runner's to write (through the session's
 * bindHarnessState door), so they left SessionSpec, as fields 3
 * (harness_state_id) and 13 (harness_state_id_history), for SessionStatus
 * fields 4 and 5. The drivers own the SQL; this module owns what one row
 * becomes.
 *
 * A session stored before the move holds the two spec fields, which the
 * contract now reserves, so the current schema decodes them as unknown
 * fields. They are read by wire number, never through a schema that no
 * longer exists (session-values-retired.ts, the precedent), and carried to
 * the status: a laptop's Cursor sessions resume from the id, so dropping it
 * would start every conversation over. A status that already holds a value
 * keeps it (no release wrote both). A repeated id keeps the last one, as
 * protobuf does for a scalar.
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
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";

/** The `kind` column value of the rows the step rewrites. */
export const SESSION_HARNESS_KIND = "session";

/** How many session rows the step decodes per page. */
export const SESSION_HARNESS_PAGE_SIZE = 100;

/** SessionSpec's retired harness_state_id. */
const RETIRED_ID_FIELD = 3;

/** SessionSpec's retired harness_state_id_history. */
const RETIRED_HISTORY_FIELD = 13;

/**
 * The migrated bytes of one session row, or undefined when its spec holds
 * neither retired field (the driver then leaves its bytes as they are).
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
  let harnessStateId = "";
  const history: string[] = [];
  for (const field of unknown) {
    if (!isRetired(field.no) || field.wireType !== WireType.LengthDelimited) {
      continue;
    }
    const value = new BinaryReader(field.data).string();
    if (field.no === RETIRED_ID_FIELD) {
      harnessStateId = value;
    } else {
      history.push(value);
    }
  }
  const kept = unknown.filter((field) => !isRetired(field.no));
  if (kept.length === 0) {
    delete spec.$unknown;
  } else {
    spec.$unknown = kept;
  }
  const status = (session.status ??= create(SessionStatusSchema));
  if (status.harnessStateId === "") {
    status.harnessStateId = harnessStateId;
  }
  if (status.harnessStateIdHistory.length === 0) {
    status.harnessStateIdHistory = history;
  }
  return toBinary(SessionSchema, session);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableSessionHarnessError(id: string, error: unknown): Error {
  return new Error(
    `${SESSION_HARNESS_KIND} '${id}' cannot be read to move its harness state to its status: ${String(error)}`,
    { cause: error },
  );
}
