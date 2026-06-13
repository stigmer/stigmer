// Terminal-capability gate for renderer selection.
//
// Deliberately free of any React/Ink imports so the command can decide whether
// to take the interactive path *before* paying the dynamic-import cost of
// ink.tsx (DD-001 lazy boundary). Mirrors Go's termctl.IsSupported.

/**
 * Whether the terminal can host the interactive Ink renderer: stdout must be a
 * TTY and TERM must not be "dumb". When false, the command uses plaintext.
 */
export function isInkSupported(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (stream.isTTY !== true) return false;
  return process.env.TERM !== "dumb";
}
