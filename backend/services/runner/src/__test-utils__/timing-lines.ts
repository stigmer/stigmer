/**
 * Reads the `stigmer_timing` lines a test subject writes to `console.log`
 * while it runs, parsed, so a test can assert on a timeline the way the
 * cluster's log reader will (`shared/cold-start-timing.ts`: the stdout line
 * is the only place a timeline's segments exist).
 *
 * One helper for every suite that asserts on an emitted timeline (the
 * runtime's `run-turn.test.ts`, each adapter's hermetic `turn-phases` proof),
 * so the way a line is recognised — the selector as the FIRST key, the way
 * `emitTimingLog` writes it — is decided once. Other log lines pass through
 * to the real console untouched; nothing here silences the run.
 */

/** One parsed timeline line: the selector, `total_ms`, `segments`, and whatever context the emitter added. */
export interface TimingLine {
  readonly stigmer_timing: string;
  readonly total_ms: number;
  readonly segments: ReadonlyArray<{ readonly name: string; readonly start_ms: number; readonly duration_ms: number }>;
  readonly [key: string]: unknown;
}

/**
 * Run `act` with `console.log` observed; return every `stigmer_timing` line
 * whose selector is `event`, in the order they were written.
 */
export async function captureTimingLines(event: string, act: () => Promise<void>): Promise<TimingLine[]> {
  const prefix = `{"stigmer_timing":${JSON.stringify(event)}`;
  const lines: TimingLine[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith(prefix)) {
      lines.push(JSON.parse(first) as TimingLine);
    }
    original(...args);
  };
  try {
    await act();
  } finally {
    console.log = original;
  }
  return lines;
}
