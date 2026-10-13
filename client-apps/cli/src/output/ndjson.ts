// NDJSON writer for streaming commands (run/resume `--json`): one compact
// JSON value per line. What each line holds is the caller's: the session
// renderer writes each event's Managed Agents JSON
// (resources/stream/render-ndjson.ts).

/** Serialize a single NDJSON line (one compact JSON value + newline). */
export function ndjsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/** Write a single NDJSON line to the given stream. */
export function writeNdjson(out: { write(chunk: string): unknown }, value: unknown): void {
  out.write(ndjsonLine(value));
}
