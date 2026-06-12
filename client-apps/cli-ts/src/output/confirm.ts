// Interactive yes/no confirmation for destructive commands. Mirrors the Go
// CLI's clioutput.Confirmer: a `--force` flag (or a non-interactive stderr)
// auto-confirms, so scripts, pipes, and CI never hang waiting on a TTY prompt.
//
// Lives in `output/` to match Go's pkg/clioutput placement — the prompt is part
// of the human output contract (it writes to stderr, alongside warning panels),
// not part of any resource's transport logic.

import { createInterface } from "node:readline";

export interface ConfirmOptions {
  /** When true, skip the prompt and return true immediately (`--force`). */
  readonly force?: boolean;
  /** Input stream to read the answer from. Defaults to process.stdin. */
  readonly input?: NodeJS.ReadStream;
  /** Output stream the prompt is written to. Defaults to process.stderr. */
  readonly output?: NodeJS.WritableStream;
}

/**
 * Ask the user to confirm a destructive action. Returns true to proceed.
 *
 * Resolution order:
 *   - `--force`            → true (no prompt)
 *   - non-interactive TTY  → false (refuse rather than block a pipe/CI run)
 *   - interactive          → true only for an explicit yes ("y"/"yes")
 *
 * The default-no posture matches the "[y/N]" prompt: anything that is not an
 * affirmative answer aborts, which is the safe outcome for an irreversible
 * operation.
 */
export async function confirm(prompt: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (options.force === true) return true;

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;

  // Without a TTY there is no one to answer; refuse rather than hang. Callers
  // that need unattended deletes pass `--force`.
  if (input.isTTY !== true) return false;

  const rl = createInterface({ input, output });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(`${prompt} `, resolve));
    return isAffirmative(answer);
  } finally {
    rl.close();
  }
}

function isAffirmative(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}
