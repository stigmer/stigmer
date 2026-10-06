/**
 * What a hook's run answered, read as Claude Code reads it.
 *
 *  - Exit code 2 blocks: a PreToolUse hook denies the call with its stderr
 *    as the reason; a PostToolUse hook's stderr is fed back beside the
 *    result (the tool already ran).
 *  - Otherwise, stdout that is a JSON object decides, whatever the exit
 *    code: `hookSpecificOutput.permissionDecision` (`allow`, `deny`, `ask`,
 *    `defer`) with its reason, `updatedInput` and `additionalContext`; the
 *    deprecated top-level `decision` (`approve`, `block`) with `reason`; and
 *    on PostToolUse a top-level `decision: "block"` with `reason`.
 *  - A decision that carries no reason (or a blank one) takes the hook's `systemMessage`, the
 *    text Claude Code shows the person, as its reason, so a refusal says why
 *    (hookify answers a block this way). Here that reason reaches the model
 *    too, as every hook reason does. A `systemMessage` that is not the
 *    reason (a warning with no decision, or one beside a decision's own
 *    reason) is shown to no one yet (stigmer#1954); it is logged.
 *  - Anything else (a plain exit 0, another exit code, a timeout, a command
 *    that did not start, JSON that does not parse) makes no decision. A
 *    failure is recorded as a hook error and the call falls to what would
 *    have happened without the hook, as Claude treats a non-blocking error.
 *
 * Text a hook hands the model is capped at {@link HOOK_TEXT_CAP} characters,
 * Claude's own cap on `additionalContext`. `updatedToolOutput` is not read
 * (a hook cannot replace a tool's result on Stigmer); it is logged.
 */

import type { HookRunResult } from "./run.js";

/** The most characters of one hook's reason or context the model is given. */
export const HOOK_TEXT_CAP = 10_000;

/** A PreToolUse hook's verdict on a call. */
export type HookDecision = "allow" | "deny" | "ask" | "defer";

/** What one PreToolUse run answered. */
export interface PreToolUseAnswer {
  readonly decision?: HookDecision;
  readonly reason?: string;
  readonly updatedInput?: Record<string, unknown>;
  readonly additionalContext?: string;
  /** Why the run made no decision, when it failed. */
  readonly error?: string;
}

/** What one PostToolUse run answered. */
export interface PostToolUseAnswer {
  /** The reason a hook blocked on the result, fed back to the model. */
  readonly blockReason?: string;
  readonly additionalContext?: string;
  readonly error?: string;
}

const BLOCKING_EXIT = 2;
const DECISIONS: ReadonlySet<string> = new Set<HookDecision>(["allow", "deny", "ask", "defer"]);

export function parsePreToolUse(result: HookRunResult): PreToolUseAnswer {
  const failure = failureOf(result);
  if (failure !== undefined) return { error: failure };
  if (result.exitCode === BLOCKING_EXIT) {
    return { decision: "deny", reason: capped(result.stderr.trim()) || "A hook blocked this call." };
  }
  const json = jsonObjectOf(result.stdout);
  if (json === undefined) {
    return result.exitCode === 0 ? {} : { error: exitError(result) };
  }
  const specific = objectField(json, "hookSpecificOutput");
  const permission = specific?.["permissionDecision"];
  const decision = typeof permission === "string" && DECISIONS.has(permission)
    ? (permission as HookDecision)
    : legacyDecision(json["decision"]);
  const ownReason = nonBlank(stringField(specific, "permissionDecisionReason")) ?? nonBlank(stringField(json, "reason"));
  logIgnoredFields(json, decision !== undefined, ownReason !== undefined);
  const reason = ownReason ?? (decision !== undefined ? stringField(json, "systemMessage") : undefined);
  const updatedInput = objectField(specific ?? {}, "updatedInput");
  const additionalContext = stringField(specific, "additionalContext");
  return {
    ...(decision !== undefined ? { decision } : {}),
    ...(reason !== undefined ? { reason: capped(reason) } : {}),
    ...(updatedInput !== undefined ? { updatedInput } : {}),
    ...(additionalContext !== undefined ? { additionalContext: capped(additionalContext) } : {}),
  };
}

export function parsePostToolUse(result: HookRunResult): PostToolUseAnswer {
  const failure = failureOf(result);
  if (failure !== undefined) return { error: failure };
  if (result.exitCode === BLOCKING_EXIT) {
    return { blockReason: capped(result.stderr.trim()) || "A hook flagged this result." };
  }
  const json = jsonObjectOf(result.stdout);
  if (json === undefined) {
    return result.exitCode === 0 ? {} : { error: exitError(result) };
  }
  const blocks = json["decision"] === "block";
  const ownReason = nonBlank(stringField(json, "reason"));
  logIgnoredFields(json, blocks, ownReason !== undefined);
  const blockReason = blocks ? (ownReason ?? stringField(json, "systemMessage") ?? "A hook flagged this result.") : undefined;
  const additionalContext = stringField(objectField(json, "hookSpecificOutput"), "additionalContext");
  return {
    ...(blockReason !== undefined ? { blockReason: capped(blockReason) } : {}),
    ...(additionalContext !== undefined ? { additionalContext: capped(additionalContext) } : {}),
  };
}

/** The deprecated `decision: approve | block` as today's verdict. */
function legacyDecision(value: unknown): HookDecision | undefined {
  if (value === "approve") return "allow";
  if (value === "block") return "deny";
  return undefined;
}

function failureOf(result: HookRunResult): string | undefined {
  if (result.spawnError !== undefined) return `the command did not start: ${result.spawnError}`;
  if (result.timedOut) return "the command timed out";
  if (result.exitCode === null) return "the command was stopped";
  return undefined;
}

function exitError(result: HookRunResult): string {
  const stderr = result.stderr.trim();
  return `the command exited ${result.exitCode}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`;
}

/** stdout as a JSON object when it is one: it opens with `{`, closes with `}` and parses. */
function jsonObjectOf(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Says what a hook answered that is not applied here. `decided` when its
 * answer carries a decision, `reasoned` when that answer carries a reason of
 * its own: a `systemMessage` is applied only as the reason of a decision
 * that gives none.
 */
function logIgnoredFields(json: Record<string, unknown>, decided: boolean, reasoned: boolean): void {
  if (objectField(json, "hookSpecificOutput")?.["updatedToolOutput"] !== undefined) {
    console.warn("[hooks] a hook's updatedToolOutput is not applied: a hook cannot replace a tool's result here");
  }
  if (json["continue"] === false) {
    console.warn("[hooks] a hook's continue:false is not applied: a hook cannot stop the turn here");
  }
  const systemMessage = stringField(json, "systemMessage");
  if (systemMessage === undefined || (decided && !reasoned)) return;
  console.warn(
    decided
      ? `[hooks] a hook's systemMessage is not shown: its decision gives its own reason: ${systemMessage.slice(0, 500)}`
      : `[hooks] a hook's systemMessage is not shown: a warning with no decision reaches no one here: ${systemMessage.slice(0, 500)}`,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  return isObject(value) ? value : undefined;
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

/** A reason that says nothing (empty or whitespace) is no reason. */
function nonBlank(text: string | undefined): string | undefined {
  return text !== undefined && text.trim() !== "" ? text : undefined;
}

function capped(text: string): string {
  return text.length > HOOK_TEXT_CAP ? text.slice(0, HOOK_TEXT_CAP) : text;
}
