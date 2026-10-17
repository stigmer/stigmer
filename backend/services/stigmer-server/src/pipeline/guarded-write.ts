/**
 * The guarded write: how a write that builds on a row it read lands
 * without undoing a change made since the read.
 *
 * An update chain loads the row (keeping its exact stored bytes), builds
 * the new state across awaited steps (authorization, reference checks,
 * the version hash), and persists by compare-and-swap against those bytes
 * (Store.swapResource). A status write, a rename or another person's edit
 * that lands in between makes the swap lose; the persist step then throws
 * `writeConflictError`, and runGuardedWrite runs the whole attempt again
 * from a fresh read, so the next attempt builds on the row as it is now.
 *
 * An attempt is the kind's whole chain, with the chain's own failure
 * handler, on a fresh RequestContext built from the same request:
 * authorization runs again and nothing a lost attempt computed carries
 * over. Rebuilding the context is simpler than resetting every step's
 * context keys, and cannot leak a lost attempt's state. Every effect a
 * chain has outside the row before its write therefore runs again on a
 * retry; each such effect repeats harmlessly or moves after the write
 * (the version archive, pipeline/steps/version-archive.ts).
 *
 * Holding a row lock across the chain is not an option: on Postgres it
 * would pin a pool connection through every awaited step, and on SQLite
 * it would hold the only write transaction across an await, which the
 * store's contract forbids (store/interface.ts updateResource).
 *
 * Three attempts, then the last conflict reaches the caller as ABORTED
 * with the reason WRITE_CONFLICT, the same budget the score's
 * replaceUnlessGraded keeps (domain/score/record.ts). Each lost attempt
 * leaves the pipeline's "pipeline step failed" warning, the signal for a
 * row too hot to update.
 *
 * A writer outside a chain that changes named fields of a row kept by a
 * port (a federation issuer's profile update for a federated account)
 * runs the same loop through changeThroughGuardedPort: read, change, swap,
 * and on a lost swap read again.
 *
 * Pinned by __tests__/guarded-write.test.ts (the retry budget and what is
 * retried) and the per-kind races beside each domain.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import type { GuardedWritePort } from "../store/guarded-port.js";
import { kindNoun } from "./apiresource-meta.js";
import { abortedError, ERROR_REASON_DOMAIN } from "./errors.js";

/** The reason a write that lost its compare-and-swap carries. */
export const WRITE_CONFLICT_REASON = "WRITE_CONFLICT";

/** How many times a guarded write runs before its conflict reaches the caller. */
export const GUARDED_WRITE_ATTEMPTS = 3;

/**
 * Runs `attempt` until it lands, at most GUARDED_WRITE_ATTEMPTS times,
 * retrying only a lost compare-and-swap. Any other failure, and the last
 * attempt's conflict, reaches the caller as it was thrown.
 */
export async function runGuardedWrite<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (attemptNumber >= GUARDED_WRITE_ATTEMPTS || !isWriteConflict(error)) {
        throw error;
      }
    }
  }
}

/**
 * The conflict a persist step throws when its swap loses: ABORTED with
 * WRITE_CONFLICT, so runGuardedWrite retries it and a client can tell it
 * from any other abort. `org` is empty for a kind owned by no
 * organization.
 */
export function writeConflictError(
  kind: ApiResourceKind,
  org: string,
  slug: string,
): ConnectError {
  const handle = org === "" ? slug : `${org}/${slug}`;
  const noun = kindNoun(kind);
  return abortedError(
    `${noun.charAt(0).toUpperCase()}${noun.slice(1)} '${handle}' kept changing while this update was being saved; try again`,
    { reason: WRITE_CONFLICT_REASON },
  );
}

/** The reason an update carrying a stale etag is refused with. */
export const ETAG_MISMATCH_REASON = "ETAG_MISMATCH";

/**
 * The refusal of an update whose etag is not the stored one: someone
 * changed the resource since the caller read it. Never retried; the caller
 * reads again and makes its change again.
 */
export function etagMismatchError(
  kind: ApiResourceKind,
  org: string,
  slug: string,
): ConnectError {
  const handle = org === "" ? slug : `${org}/${slug}`;
  const noun = kindNoun(kind);
  return abortedError(
    `${noun.charAt(0).toUpperCase()}${noun.slice(1)} '${handle}' changed since you read it; reload it and make your change again`,
    { reason: ETAG_MISMATCH_REASON },
  );
}

/** Whether `error` is a lost compare-and-swap (writeConflictError). */
export function isWriteConflict(error: unknown): boolean {
  if (!(error instanceof ConnectError) || error.code !== Code.Aborted) {
    return false;
  }
  return error
    .findDetails(ErrorInfoSchema)
    .some(
      (detail) =>
        detail.domain === ERROR_REASON_DOMAIN &&
        detail.reason === WRITE_CONFLICT_REASON,
    );
}

/**
 * Applies `change` to the row a port holds under `id` and stores it through
 * the port's guarded write, reading again and re-applying `change` when a
 * write landed in between, at most GUARDED_WRITE_ATTEMPTS times; the last
 * loss throws writeConflictError. Answers the stored row, or undefined when
 * there is none. `change` must be synchronous and may run more than once.
 */
export async function changeThroughGuardedPort<
  Row extends { metadata?: { org: string; slug: string } },
>(
  port: GuardedWritePort<Row>,
  kind: ApiResourceKind,
  id: string,
  change: (row: Row) => void,
): Promise<Row | undefined> {
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    const read = await port.readForWrite(id);
    if (read === undefined) {
      return undefined;
    }
    change(read.row);
    if (await port.swap(id, read.bytes, read.row)) {
      return read.row;
    }
    if (attemptNumber >= GUARDED_WRITE_ATTEMPTS) {
      throw writeConflictError(
        kind,
        read.row.metadata?.org ?? "",
        read.row.metadata?.slug ?? "",
      );
    }
  }
}
