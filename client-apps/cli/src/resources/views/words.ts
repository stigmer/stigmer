// The words the designed `get` views share: a reference as `org/slug`, an
// instant, a span of time, a run's status, a long text's first lines, a
// schedule. Each reads protojson (snake_case names, enums by name, int64 as
// strings, timestamps as RFC 3339) and answers "" or undefined for what the
// resource does not carry, so the renderer leaves that line out.

import type { JsonValue } from "@bufbuild/protobuf";
import { formatElapsed } from "@stigmer/client";
import { RunPhase, RunPhaseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { formatTokenCount } from "../run-format.js";
import { formatAgentPhase, isTerminalAgentPhase } from "../runs.js";
import { type JsonObject, obj, str } from "../render.js";
import { shortVersionHash } from "../version.js";
import type { ViewContext } from "./view.js";

/** How many lines of a long text (instructions, SKILL.md, a message) a view shows. */
export const TEXT_LINES = 12;

const FULL_HASH = /^[a-f0-9]{64}$/;

/**
 * A reference as a person names it: `org/slug`, the organization by the
 * view's label where it is the resource's own and left out on a server that
 * holds one; the id where the reference carries no slug; a pinned version
 * after `@`, a hash by the short form `--version-history` prints.
 */
export function refLabel(ref: JsonObject, metadata: JsonObject, ctx: ViewContext): string {
  const slug = str(ref, "slug") || str(ref, "id");
  if (slug === "") return "";
  const org = str(ref, "org");
  const own = org === str(metadata, "org") ? (ctx.orgLabel ?? org) : org;
  const named = ctx.hideOrg || org === "" ? slug : `${own}/${slug}`;
  const version = str(ref, "version");
  if (version === "" || version === "latest") return named;
  return `${named}@${FULL_HASH.test(version) ? shortVersionHash(version) : version}`;
}

/** Each reference of a protojson list field, labelled. */
export function refLabels(list: JsonValue | undefined, metadata: JsonObject, ctx: ViewContext): string[] {
  return objects(list).map((ref) => refLabel(ref, metadata, ctx)).filter((label) => label !== "");
}

/** The objects of a protojson list field (none when absent). */
export function objects(list: JsonValue | undefined): JsonObject[] {
  return Array.isArray(list) ? list.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}

/** The strings of a protojson list field (none when absent). */
export function strings(list: JsonValue | undefined): string[] {
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

/** A run's status word ("completed", "running", "awaiting-approval"), from its protojson phase. */
export function phaseWord(run: JsonObject): string {
  return formatAgentPhase(phaseOf(run));
}

/** Whether a run has ended (completed, failed, cancelled or terminated). */
export function hasEnded(run: JsonObject): boolean {
  return isTerminalAgentPhase(phaseOf(run));
}

// The phase protojson names ("RUN_FAILED"), found by its proto name in the
// enum's descriptor, since generated TypeScript names may drop a prefix.
function phaseOf(run: JsonObject): RunPhase {
  const name = str(obj(run, "status"), "phase");
  return RunPhaseSchema.values.find((value) => value.name === name)?.number ?? RunPhase.RUN_PHASE_UNSPECIFIED;
}

/**
 * How long a run took ("1m 4s"), or has taken so far while it works ("3m 2s
 * so far"); undefined before it starts, and for an ended run that recorded
 * no end.
 */
export function runSpan(run: JsonObject, now: number): string | undefined {
  const status = obj(run, "status");
  const start = Date.parse(str(status, "started_at"));
  if (Number.isNaN(start)) return undefined;
  const end = Date.parse(str(status, "completed_at"));
  if (!Number.isNaN(end)) return formatElapsed(end - start);
  return hasEnded(run) ? undefined : `${formatElapsed(now - start)} so far`;
}

/**
 * A run's tokens as the epilogue counts them ("18.4k (12.0k in, 6.4k out)"),
 * never a price; undefined when it counted none.
 */
export function tokenUsage(run: JsonObject): string | undefined {
  const usage = obj(obj(run, "status"), "streaming_usage");
  const total = int64(usage, "total_tokens");
  if (total <= 0n) return undefined;
  return `${formatTokenCount(total)} (${formatTokenCount(int64(usage, "input_tokens"))} in, ${formatTokenCount(int64(usage, "output_tokens"))} out)`;
}

// An int64 protojson field (a string on the wire), 0 when absent or unreadable.
function int64(json: JsonObject, key: string): bigint {
  const value = json[key];
  if (typeof value !== "string" && typeof value !== "number") return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * The first `max` lines of a long text, and a note of how many more there
 * are and how to read them; no lines for a text that is blank.
 */
export function firstLines(text: string, max = TEXT_LINES): { lines: string[]; more?: string } {
  const trimmed = text.replace(/\r\n/g, "\n").trimEnd();
  if (trimmed === "") return { lines: [] };
  const all = trimmed.split("\n");
  if (all.length <= max) return { lines: all };
  const rest = all.length - max;
  return { lines: all.slice(0, max), more: `… ${rest} more ${rest === 1 ? "line" : "lines"}; -o yaml for all` };
}

/** "yes" or "no" for a protojson bool (absent is false). */
export function yesNo(json: JsonObject, key: string): string {
  return json[key] === true ? "yes" : "no";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;


/**
 * A routine's schedule in words, with the time zone it keeps ("every day at
 * 09:00, Asia/Kolkata"): the shapes the console's schedule builder writes
 * and the cron shorthands in words, any other cron as itself. No cron: it
 * runs only when fired. The words of the console's `describeCadence`
 * (sdk/react's routine/cadence.ts), which the CLI cannot import.
 */
export function scheduleWords(cron: string | undefined, timeZone: string): string {
  if (cron === undefined) return "only when fired";
  const zone = timeZone === "" ? "UTC" : timeZone;
  return `${cadence(cron.trim().replace(/\s+/g, " "))}, ${zone}`;
}

// A cron shorthand in words; undefined for any other cron. The words are
// chosen as the schedule is read, not held in a table built at import.
function shorthandWords(cron: string): string | undefined {
  switch (cron) {
    case "@hourly":
      return "every hour, on the hour";
    case "@daily":
      return "every day at 00:00";
    case "@weekly":
      return "every Sunday at 00:00";
    case "@monthly":
      return "on day 1 of every month at 00:00";
    case "@yearly":
      return "every year on January 1 at 00:00";
    default:
      return undefined;
  }
}

function cadence(cron: string): string {
  const shorthand = shorthandWords(cron);
  if (shorthand !== undefined) return shorthand;
  const custom = `cron "${cron}"`;
  const fields = cron.split(" ");
  if (fields.length !== 5) return custom;
  const [m, h, d, month, w] = fields as [string, string, string, string, string];
  const minute = upTo(m, 59);
  if (month !== "*" || minute === undefined) return custom;
  if (h === "*" && d === "*" && w === "*") return `every hour at minute ${minute}`;
  const hour = upTo(h, 23);
  if (hour === undefined) return custom;
  const at = `at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (d === "*" && w === "*") return `every day ${at}`;
  const day = upTo(d, 31);
  if (day !== undefined && day >= 1 && w === "*") return `on day ${day} of every month ${at}`;
  const days = d === "*" ? weekdays(w) : undefined;
  return days === undefined ? custom : `every ${days} ${at}`;
}

// A one- or two-digit field no greater than `max`; undefined for any other.
function upTo(field: string, max: number): number | undefined {
  if (!/^\d{1,2}$/.test(field)) return undefined;
  const value = Number(field);
  return value <= max ? value : undefined;
}

// "1,3,5" as "Monday, Wednesday and Friday"; undefined for anything else.
function weekdays(field: string): string | undefined {
  if (!/^[0-6](,[0-6])*$/.test(field)) return undefined;
  const names = [...new Set(field.split(",").map(Number))].sort((a, b) => a - b).map((day) => WEEKDAYS[day]);
  if (names.length === 7) return "day";
  if (names.join() === WEEKDAYS.slice(1, 6).join()) return "weekday";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
