/**
 * What both hook formats read from the turn and hand back to the evaluator
 * (`../evaluate.ts`): the turn's facts a hook's stdin and environment carry,
 * the call's scope, and a command ready to spawn.
 */

import type { HookPermissionMode } from "../evaluate.js";

/** The turn's facts a hook reads. */
export interface FormatContext {
  readonly sessionId: string;
  /** The execution; Cursor's `generation_id`. */
  readonly executionId: string;
  /** The model the turn runs; Cursor's `model`. */
  readonly model: string;
  readonly workspaceRoot: string;
  readonly permissionMode: HookPermissionMode;
  /** The agent shell's environment, the runner's credentials already stripped. */
  readonly baseEnv: Readonly<Record<string, string>>;
}

/** Which graph made the call: a sub-agent's carries its type and invocation id. */
export interface HookScope {
  readonly subAgent?: { readonly type: string; readonly id: string };
}

/** A command to spawn: exec form when `args` is set, else shell form. */
export interface HookCommand {
  readonly command: string;
  readonly args: readonly string[] | null;
}
