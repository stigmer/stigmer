// Capability gate for the interactive resource pickers (`run` agent browse,
// `resume` session browse). Deliberately free of any React/Ink imports so the
// command can decide whether to take the interactive path *before* paying the
// dynamic-import cost of picker/ink.tsx (DD-001 lazy boundary).

import { isInkSupported } from "../stream/tty.js";

/** Minimal view of the process streams the gate inspects (injectable for tests). */
export interface PickerStreams {
  readonly stdin?: { readonly isTTY?: boolean };
  readonly stdout?: { readonly isTTY?: boolean };
}

/**
 * Whether the interactive picker can run: human output mode on a fully
 * interactive terminal — stdout must be renderable (TTY, not `TERM=dumb`) and
 * stdin must be keyboard-capable (TTY for raw-mode input).
 *
 * JSON mode and non-interactive shells (pipes, CI) return false so callers fall
 * back to actionable guidance with a stable, scriptable exit code.
 */
export function interactiveBrowseEnabled(
  outputMode: "inline" | "json",
  streams: PickerStreams = process,
): boolean {
  if (outputMode !== "inline") return false;
  const stdout = streams.stdout ?? process.stdout;
  const stdin = streams.stdin ?? process.stdin;
  return isInkSupported(stdout) && stdin.isTTY === true;
}
