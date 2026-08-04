/**
 * The cadence model behind {@link CadenceField} — a pure, dependency-free
 * bridge between human-friendly schedule presets and the 5-field cron
 * grammar the Schedule spec stores.
 *
 * Deliberately NOT a cron parser. The platform owns no cron parsing in
 * either edition — calendar and DST semantics live in the Temporal server
 * (see stigmer-server's schedule/controller/cron.go, DD-008 D2). This
 * module only:
 *
 *   1. GENERATES cron strings from presets (`cadenceToCron`) — trivial
 *      string construction, always valid by construction.
 *   2. RECOGNIZES the exact shapes the builder emits (`cronToCadence`)
 *      so a stored cron round-trips back into the preset UI; anything
 *      else falls back to the `custom` preset showing the raw string.
 *   3. MIRRORS the server's purely lexical validation (`validateCron`,
 *      `validateTimeZone`) with the same user-facing wording, so the
 *      form can reject bad input instantly. The server remains the
 *      authority — its errors surface verbatim on submit.
 */

// ---------------------------------------------------------------------------
// Preset model
// ---------------------------------------------------------------------------

/** A human-friendly cadence, convertible to/from a cron expression. */
export type CadencePreset =
  | { readonly kind: "hourly"; readonly minute: number }
  | { readonly kind: "daily"; readonly hour: number; readonly minute: number }
  | {
      readonly kind: "weekly";
      /** Days of week, cron numbering: 0 = Sunday … 6 = Saturday. */
      readonly days: readonly number[];
      readonly hour: number;
      readonly minute: number;
    }
  | {
      readonly kind: "monthly";
      /** Day of month, 1–31. Days 29–31 skip months without that day. */
      readonly day: number;
      readonly hour: number;
      readonly minute: number;
    }
  | { readonly kind: "custom"; readonly cron: string };

/** Discriminant of {@link CadencePreset}. */
export type CadenceKind = CadencePreset["kind"];

/** Day-of-week labels indexed by cron numbering (0 = Sunday). */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ---------------------------------------------------------------------------
// Preset → cron
// ---------------------------------------------------------------------------

/**
 * Build the 5-field cron expression for a preset.
 *
 * Output is always valid by construction: numeric fields only,
 * day-of-week in cron numbering (0 = Sunday). For `custom`, the raw
 * string is returned as-is — validate it with {@link validateCron}.
 */
export function cadenceToCron(preset: CadencePreset): string {
  switch (preset.kind) {
    case "hourly":
      return `${preset.minute} * * * *`;
    case "daily":
      return `${preset.minute} ${preset.hour} * * *`;
    case "weekly": {
      // Sorted, deduplicated day list keeps the output canonical so
      // cronToCadence round-trips regardless of selection order.
      const days = [...new Set(preset.days)].sort((a, b) => a - b);
      return `${preset.minute} ${preset.hour} * * ${days.join(",")}`;
    }
    case "monthly":
      return `${preset.minute} ${preset.hour} ${preset.day} * *`;
    case "custom":
      return preset.cron;
  }
}

// ---------------------------------------------------------------------------
// Cron → preset (recognition, not parsing)
// ---------------------------------------------------------------------------

const HOURLY_RE = /^(\d{1,2}) \* \* \* \*$/;
const DAILY_RE = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKLY_RE = /^(\d{1,2}) (\d{1,2}) \* \* (\d(?:,\d)*)$/;
const MONTHLY_RE = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/;

/**
 * Recognize a cron expression as one of the builder's presets.
 *
 * Only the exact shapes {@link cadenceToCron} emits (plus the
 * calendar shorthands `@hourly`/`@daily`/`@weekly`/`@monthly`) map to a
 * structured preset. Everything else — ranges, steps, names, `@yearly`
 * — is a perfectly valid schedule that this UI simply cannot decompose,
 * so it round-trips as `custom` with the raw string intact.
 */
export function cronToCadence(cron: string): CadencePreset {
  const normalized = cron.trim().replace(/\s+/g, " ");

  switch (normalized) {
    case "@hourly":
      return { kind: "hourly", minute: 0 };
    case "@daily":
      return { kind: "daily", hour: 0, minute: 0 };
    case "@weekly":
      return { kind: "weekly", days: [0], hour: 0, minute: 0 };
    case "@monthly":
      return { kind: "monthly", day: 1, hour: 0, minute: 0 };
  }

  let m = HOURLY_RE.exec(normalized);
  if (m) {
    const minute = Number(m[1]);
    if (isMinute(minute)) return { kind: "hourly", minute };
  }

  m = DAILY_RE.exec(normalized);
  if (m) {
    const minute = Number(m[1]);
    const hour = Number(m[2]);
    if (isMinute(minute) && isHour(hour)) return { kind: "daily", hour, minute };
  }

  m = WEEKLY_RE.exec(normalized);
  if (m) {
    const minute = Number(m[1]);
    const hour = Number(m[2]);
    const days = m[3].split(",").map(Number);
    if (
      isMinute(minute) &&
      isHour(hour) &&
      days.length > 0 &&
      days.every((d) => d >= 0 && d <= 6) &&
      new Set(days).size === days.length
    ) {
      return { kind: "weekly", days: [...days].sort((a, b) => a - b), hour, minute };
    }
  }

  m = MONTHLY_RE.exec(normalized);
  if (m) {
    const minute = Number(m[1]);
    const hour = Number(m[2]);
    const day = Number(m[3]);
    if (isMinute(minute) && isHour(hour) && day >= 1 && day <= 31) {
      return { kind: "monthly", day, hour, minute };
    }
  }

  return { kind: "custom", cron };
}

function isMinute(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 59;
}

function isHour(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 23;
}

// ---------------------------------------------------------------------------
// Plain-English summary
// ---------------------------------------------------------------------------

/**
 * Human-readable summary of a cadence, e.g.
 * `"Every day at 09:00 (Asia/Kolkata)"`.
 *
 * This is a description of the chosen preset, not a computed fire-time
 * forecast — the platform's next fire time is published by the server
 * as `status.next_fire_at` after apply.
 */
export function describeCadence(
  preset: CadencePreset,
  timeZone?: string,
): string {
  const zone = timeZone ? ` (${timeZone})` : "";
  switch (preset.kind) {
    case "hourly":
      return `Every hour at minute ${preset.minute}${zone}`;
    case "daily":
      return `Every day at ${formatTime(preset.hour, preset.minute)}${zone}`;
    case "weekly": {
      const days = [...new Set(preset.days)].sort((a, b) => a - b);
      const names =
        days.length === 7
          ? "day"
          : listWithAnd(days.map((d) => WEEKDAY_LABELS[d]));
      return `Every ${names} at ${formatTime(preset.hour, preset.minute)}${zone}`;
    }
    case "monthly":
      return `On day ${preset.day} of every month at ${formatTime(preset.hour, preset.minute)}${zone}`;
    case "custom":
      return `Cron “${preset.cron.trim()}”${zone}`;
  }
}

/** `9, 5` → `"09:05"` (24-hour clock, zero-padded). */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function listWithAnd(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Lexical validation — mirrors stigmer-server schedule/controller/cron.go
// ---------------------------------------------------------------------------

// The accepted @-shorthands, the field character set, the rejection
// cases AND the message wording below mirror the server byte-for-byte
// (Go: cron.go / cron_test.go; Java: ValidateScheduleSpec). A change on
// any side must change all three, or the instant client feedback drifts
// from what the server enforces on submit.

const CRON_SHORTHANDS = new Set([
  "@hourly",
  "@daily",
  "@weekly",
  "@monthly",
  "@yearly",
]);

const CRON_FIELD_PATTERN = /^[0-9A-Za-z*,/-]+$/;

/**
 * Validate a cron expression against the platform's lexical grammar.
 *
 * Returns the user-facing error message (identical wording to the
 * server's) or `null` when the expression is acceptable. Purely
 * lexical — it does not evaluate calendar semantics.
 */
export function validateCron(cron: string): string | null {
  if (cron.startsWith("CRON_TZ=") || cron.startsWith("TZ=")) {
    return "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority";
  }

  if (cron.includes("#")) {
    return "spec.cron must not contain a comment (#)";
  }

  if (cron.startsWith("@")) {
    if (cron.startsWith("@every")) {
      return "spec.cron must be a calendar expression — @every intervals are not supported";
    }
    if (!CRON_SHORTHANDS.has(cron)) {
      return `spec.cron shorthand "${cron}" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression`;
    }
    return null;
  }

  // Matches Go's strings.Fields: split on runs of whitespace, so
  // surrounding/duplicate whitespace never produces empty fields.
  const fields = cron.split(/\s+/).filter((f) => f.length > 0);
  if (fields.length !== 5) {
    return `spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got ${fields.length}`;
  }

  for (const field of fields) {
    if (!CRON_FIELD_PATTERN.test(field)) {
      return `spec.cron field "${field}" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`;
    }
  }

  return null;
}

/**
 * Validate an IANA time zone name using the runtime's own tz database
 * (`Intl`), mirroring the server's check against the platform tz
 * database. Returns the user-facing error message or `null`.
 *
 * `"Local"` is rejected explicitly for the same reason the server
 * rejects it: it is host-dependent, not a zone.
 */
export function validateTimeZone(timeZone: string): string | null {
  const invalid = `spec.time_zone "${timeZone}" is not a valid IANA time zone (e.g. "Asia/Kolkata")`;
  if (timeZone === "Local") return invalid;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return null;
  } catch {
    return invalid;
  }
}
