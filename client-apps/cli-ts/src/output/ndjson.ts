// NDJSON envelope seed for streaming commands (run/resume), which land in a
// later wave. Each event is one JSON object per line on stdout; this is the
// minimal writer the streaming renderer will build on, kept here so the output
// vocabulary is complete and discoverable from day one.

export interface NdjsonEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Serialize a single NDJSON event (one compact JSON object + newline). */
export function ndjsonLine(event: NdjsonEvent): string {
  return JSON.stringify(event) + "\n";
}

/** Write a single NDJSON event to the given stream. */
export function writeNdjson(out: { write(chunk: string): unknown }, event: NdjsonEvent): void {
  out.write(ndjsonLine(event));
}
