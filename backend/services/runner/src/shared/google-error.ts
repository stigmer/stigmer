/**
 * What a failed Gemini call says, read off the error LangChain's Google
 * client raises (`RequestError`: the HTTP status as `statusCode`, the
 * response body as `data`).
 *
 * Google's error body is `{ error: { code, message, status, details } }`.
 * The details are typed records, and three of them decide what the runner
 * does with a failure:
 *
 *  - `ErrorInfo.reason` names why a request was refused: `API_KEY_INVALID`
 *    is the key's fault (Google answers a wrong key with 400, not 401).
 *  - `QuotaFailure.violations[].quotaId` names the limit a 429 hit. A limit
 *    per minute passes; a limit per day does not pass within a turn. Google
 *    words both "You exceeded your current quota, please check your plan and
 *    billing details", so the provider billing phrases the runner reads for
 *    the other providers (`model-error.ts` `isProviderBillingMessage`) are
 *    never read for Google: the limit's own name is.
 *  - `RetryInfo.retryDelay` ("31s") is the wait Google asks for.
 */

/** The HTTP status of an error link: the provider SDKs' `status`, or the Google client's `statusCode`. */
export function httpStatusOf(link: unknown): number | undefined {
  if (typeof link !== "object" || link === null) return undefined;
  const { status, statusCode } = link as { status?: unknown; statusCode?: unknown };
  if (typeof status === "number") return status;
  return typeof statusCode === "number" ? statusCode : undefined;
}

/** What one Google failure says. */
export interface GoogleErrorFacts {
  readonly status: number;
  /** Google's own status name (`INVALID_ARGUMENT`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`). */
  readonly rpcStatus: string | undefined;
  /** `ErrorInfo.reason`, when Google sends one. */
  readonly reason: string | undefined;
  /** The limits a 429 hit (`QuotaFailure`), by Google's id. */
  readonly quotaIds: readonly string[];
  /** The wait Google asks for (`RetryInfo`), in milliseconds. */
  readonly retryDelayMs: number | undefined;
}

/** The reasons Google gives for a key it refuses. */
const KEY_REFUSED_REASONS: ReadonlySet<string> = new Set(["API_KEY_INVALID"]);

/** The facts of a Google failure, or `undefined` when `link` is not one. */
export function googleErrorOf(link: unknown): GoogleErrorFacts | undefined {
  if (typeof link !== "object" || link === null) return undefined;
  const { statusCode, data } = link as { statusCode?: unknown; data?: unknown };
  if (typeof statusCode !== "number") return undefined;
  const error = (data as { error?: unknown } | null | undefined)?.error;
  if (typeof error !== "object" || error === null) return undefined;
  const { status, details } = error as { status?: unknown; details?: unknown };
  const records = Array.isArray(details) ? details.filter((detail): detail is Record<string, unknown> => typeof detail === "object" && detail !== null) : [];
  return {
    status: statusCode,
    rpcStatus: typeof status === "string" ? status : undefined,
    reason: records.map((detail) => detail.reason).find((reason): reason is string => typeof reason === "string"),
    quotaIds: records.flatMap(quotaIdsOf),
    retryDelayMs: records.map((detail) => durationMs(detail.retryDelay)).find((ms) => ms !== undefined),
  };
}

/** Whether Google refused the call's key. */
export function isGoogleKeyRefusal(facts: GoogleErrorFacts): boolean {
  return facts.reason !== undefined && KEY_REFUSED_REASONS.has(facts.reason);
}

/** Whether a 429 hit a limit that does not pass within a turn: a daily one. */
export function isGoogleDailyQuota(facts: GoogleErrorFacts): boolean {
  return facts.status === 429 && facts.quotaIds.some((id) => /perday/i.test(id));
}

function quotaIdsOf(detail: Record<string, unknown>): string[] {
  const violations = detail.violations;
  if (!Array.isArray(violations)) return [];
  return violations
    .map((violation) => (violation as { quotaId?: unknown } | null)?.quotaId)
    .filter((id): id is string => typeof id === "string");
}

/** A protobuf duration in its JSON form (`"31s"`, `"1.5s"`), in milliseconds. */
function durationMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}
