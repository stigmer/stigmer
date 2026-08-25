/**
 * Lexical cron and time-zone validation — ports
 * pkg/domain/schedule/controller/cron.go (DD-009 C-4).
 *
 * The platform owns NO cron parsing in either edition — calendar and DST
 * semantics live in the Temporal server (DD-008 D2). This module restricts
 * the accepted GRAMMAR to the subset that is safe to store: the classic
 * 5-field form plus the @daily-family shorthands. Everything rejected here
 * is something Temporal's wider grammar would accept but that must not
 * reach a stored spec (timezone prefixes carry a second timezone authority
 * and fail at artifact-create time; @every bypasses the calendar model;
 * 6/7-field forms defeat the structural one-minute floor; "#" comments are
 * noise).
 *
 * Both server editions and the cloud Java edition mirror these checks with
 * byte-identical messages; the shared rejection matrix is pinned by unit
 * tests on every side. Widening this grammar later is additive; narrowing
 * it would break stored specs — start narrow.
 */
import { invalidArgumentError } from "../../pipeline/errors.js";

/**
 * The accepted @-shorthands — deliberately only the calendar ones Temporal
 * documents (no @every, and none of the nonstandard aliases like @annually
 * or @midnight some cron implementations accept).
 */
const CRON_SHORTHANDS = new Set([
  "@hourly",
  "@daily",
  "@weekly",
  "@monthly",
  "@yearly",
]);

/**
 * Bounds each field to the character set of Temporal's CalendarSpec
 * ranges: digits, month/day names (Jan, MON), '*', ',', '-', '/'.
 * Quartz-isms ('?', 'L', 'W', '#') and anything else are rejected —
 * Temporal does not implement them.
 */
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*,/-]+$/;

/**
 * Enforces the DD-009 C-4 grammar; throws InvalidArgument with the
 * cross-edition byte-pinned copy. Pure and deterministic.
 */
export function validateScheduleCron(cron: string): void {
  if (cron.startsWith("CRON_TZ=") || cron.startsWith("TZ=")) {
    throw invalidArgumentError(
      "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
    );
  }

  if (cron.includes("#")) {
    throw invalidArgumentError("spec.cron must not contain a comment (#)");
  }

  if (cron.startsWith("@")) {
    if (cron.startsWith("@every")) {
      throw invalidArgumentError(
        "spec.cron must be a calendar expression — @every intervals are not supported",
      );
    }
    if (!CRON_SHORTHANDS.has(cron)) {
      throw invalidArgumentError(
        `spec.cron shorthand "${cron}" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression`,
      );
    }
    return;
  }

  // Go strings.Fields: split on any run of whitespace, no empty fields.
  const fields = cron.split(/\s+/).filter((field) => field !== "");
  if (fields.length !== 5) {
    throw invalidArgumentError(
      `spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got ${fields.length}`,
    );
  }

  for (const field of fields) {
    if (!CRON_FIELD_PATTERN.test(field)) {
      throw invalidArgumentError(
        `spec.cron field "${field}" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`,
      );
    }
  }
}

/**
 * Requires a name the platform tz database resolves — Go
 * validateScheduleTimeZone (the Temporal server loads the same database
 * when it evaluates the cron, DD-008 D2).
 *
 * "Local" is rejected explicitly: Go resolves it to the host's zone
 * (nondeterministic across replicas) while Java's ZoneId does not resolve
 * it at all — accepting it would be a cross-edition divergence on top of a
 * correctness bug. The EMPTY string is valid, as in Go: time.LoadLocation("")
 * is UTC (and the artifact's empty TimeZoneName means UTC to Temporal).
 */
export function validateScheduleTimeZone(timeZone: string): void {
  if (timeZone === "Local" || !isLoadableTimeZone(timeZone)) {
    throw invalidArgumentError(
      `spec.time_zone "${timeZone}" is not a valid IANA time zone (e.g. "Asia/Kolkata")`,
    );
  }
}

// The canonical IANA zone list ICU ships (exact case), plus its lowered
// twin for the case-guard below. Built once — the list is immutable for
// the process lifetime.
let canonicalZones: Set<string> | undefined;
let canonicalZonesLowered: Set<string> | undefined;
function zoneSets(): { exact: Set<string>; lowered: Set<string> } {
  if (canonicalZones === undefined || canonicalZonesLowered === undefined) {
    const values = Intl.supportedValuesOf("timeZone");
    canonicalZones = new Set(values);
    canonicalZonesLowered = new Set(values.map((zone) => zone.toLowerCase()));
  }
  return { exact: canonicalZones, lowered: canonicalZonesLowered };
}

/**
 * The TS spelling of Go time.LoadLocation's yes/no answer. ICU (behind
 * Intl) resolves zone names CASE-INSENSITIVELY (and may canonicalize
 * through historical aliases, e.g. asia/kolkata → Asia/Calcutta) while
 * Go's tzdata file lookup is case-sensitive. The guard restores Go's
 * refusal: an input that is a mere case-variant of a canonical zone is
 * rejected; genuine links ("US/Pacific") pass through ICU acceptance as
 * they do in Go. Residual divergence — a case-variant of a LINK name —
 * is a disclosed parity nuance (PR register), not silently absorbed.
 */
export function isLoadableTimeZone(timeZone: string): boolean {
  if (timeZone === "") {
    return true; // Go LoadLocation("") — UTC.
  }
  const { exact, lowered } = zoneSets();
  if (exact.has(timeZone)) {
    return true;
  }
  // A case-variant of a canonical zone: ICU would accept it, Go refuses.
  if (lowered.has(timeZone.toLowerCase())) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
