/**
 * When a credential was last used: the one rule the two credential kinds
 * that carry `status.last_used_at` share. An API key is stamped by the
 * identity verifier that accepts it (domain/apikey/verifier.ts), a
 * PlatformClient by a successful mint (domain/platformclient/mint.ts). It
 * lives here, beside the other infrastructure the credential lanes share,
 * because neither domain owns the other (stigmer/stigmer#1255).
 *
 * The stamp is status the platform writes on its own, so it follows the
 * house rule for such writes: an atomic read-modify-write on the row
 * (`Store.updateResource`; the PlatformClient port's `modifyById`), the
 * narrow status-audit bump (pipeline/steps/defaults.ts), and best-effort
 * with a loud log, as `stampLastFireAt` records a schedule's manual fire
 * (domain/schedule/trigger.ts). Never a load-then-save of the whole row:
 * the credential's own update chains replace the row whole, and a stale
 * copy written back by a stamp would undo them (a rotated PlatformClient
 * secret would work again).
 *
 * The resolution keeps a credential that rides every request from costing
 * a write per request, and it needs no state: the caller already holds the
 * row it just verified, so "stamped less than a resolution ago" is one
 * comparison with the stored value, the same answer on every replica and
 * after every restart. Callers that pass the check at the same instant
 * each write once; every write only moves the stamp forward, so the extra
 * writes change nothing.
 */
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";

import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../boot/logger.js";
import { bumpStatusAudit } from "../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../store/interface.js";

/**
 * How stale a stored last use may be before a new use records again: one
 * minute. Fresh enough that the console's "Used 3m" is true to the minute;
 * coarse enough that a key behind every request costs at most one write a
 * minute per replica. Both fields' proto comments state it.
 */
export const LAST_USED_RESOLUTION_MS = 60_000;

/** The status shape both credential kinds share. */
export interface CredentialUseStatus {
  lastUsedAt?: Timestamp;
  audit?: ApiResourceAudit;
}

/** True when a use at `now` should be recorded over the stored `lastUsedAt`. */
export function lastUseIsStale(
  lastUsedAt: Timestamp | undefined,
  now: Date,
): boolean {
  return (
    lastUsedAt === undefined ||
    now.getTime() - timestampDate(lastUsedAt).getTime() >=
      LAST_USED_RESOLUTION_MS
  );
}

/**
 * Records a use at `usedAt`, forward only: a stored stamp at or after it (a
 * replica whose clock runs ahead, a racing caller that wrote first) is
 * kept, and the audit is left alone. Returns whether it wrote. Synchronous,
 * because it runs inside an atomic write's `modify`.
 */
export function stampLastUsed(
  status: CredentialUseStatus,
  usedAt: Date,
): boolean {
  const stored = status.lastUsedAt;
  if (
    stored !== undefined &&
    timestampDate(stored).getTime() >= usedAt.getTime()
  ) {
    return false;
  }
  status.lastUsedAt = timestampFromDate(usedAt);
  bumpStatusAudit(status);
  return true;
}

export interface CredentialUse {
  /** What the log calls the credential ("api key", "platform client"). */
  readonly credential: string;
  /** The credential's resource id: logged, never the secret. */
  readonly id: string;
  /** The stored stamp, as the caller read the row it just verified. */
  readonly lastUsedAt: Timestamp | undefined;
  readonly now: Date;
  readonly logger: Logger;
  /**
   * The kind's atomic write: applies `stamp` to the row's status (created
   * when absent) inside one read-modify-write. A row deleted since the
   * caller read it is a typed not-found or a write that finds nothing.
   */
  readonly write: (
    stamp: (status: CredentialUseStatus) => void,
  ) => Promise<unknown>;
}

/**
 * Records the use when the stored stamp is stale. Never throws: the
 * credential already did its job, and a bookkeeping failure must not turn
 * an accepted request or a minted token into an error. A row deleted
 * meanwhile has nothing to record; any other failure is logged.
 */
export async function recordCredentialUse(use: CredentialUse): Promise<void> {
  if (!lastUseIsStale(use.lastUsedAt, use.now)) {
    return;
  }
  try {
    await use.write((status) => {
      stampLastUsed(status, use.now);
    });
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return;
    }
    use.logger.warn(
      "Credential last_used_at not recorded (best-effort — the request is unaffected)",
      {
        credential: use.credential,
        id: use.id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
