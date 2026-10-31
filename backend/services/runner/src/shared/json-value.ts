/**
 * Tool arguments as JSON carries them, compared as JSON carries them.
 *
 * A call's arguments come from a model or a hook as JSON and come back from
 * a checkpoint, a session's log or a card as JSON: an absent key and an
 * undefined one are alike there, so two values are compared after that
 * normalisation, never as objects in memory: the Stigmer harness's gate when
 * an approved call resumes (`middleware/approval-gate.ts`), the Claude
 * harness's when its host's tools admit a call and when an approved call is
 * held to its row (`execute-claude/gate.ts`), and the hooks when a rewrite
 * only echoes the call (`hooks/tool-view.ts`).
 */

import { isDeepStrictEqual } from "node:util";

/** A value as JSON carries it: an absent key and an undefined one are alike. */
export function asJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Whether two values are the same as JSON carries them. */
export function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(asJson(a), asJson(b));
}

/** Whether an untyped value (a checkpoint's, a resume's) is an arguments object. */
export function isArgsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
