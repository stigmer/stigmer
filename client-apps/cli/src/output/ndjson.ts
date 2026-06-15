// NDJSON envelope + writer for streaming commands (run/resume/draft).
//
// The wire shape mirrors the Go CLI's run --json output (run_stream_json.go):
// every line is a `{type, ts, payload}` object, and the payload is cleaned of
// nil/empty-string fields before encoding. This module owns the *formatting*;
// the Event→{type, payload} mapping lives in resources/stream/render-ndjson.ts.

export interface NdjsonEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The Go-parity envelope: a typed event with a timestamp and cleaned payload. */
export interface NdjsonEnvelope extends NdjsonEvent {
  readonly ts: string;
  readonly payload: Record<string, unknown>;
}

/** Serialize a single NDJSON event (one compact JSON object + newline). */
export function ndjsonLine(event: NdjsonEvent): string {
  return JSON.stringify(event) + "\n";
}

/** Write a single NDJSON event to the given stream. */
export function writeNdjson(out: { write(chunk: string): unknown }, event: NdjsonEvent): void {
  out.write(ndjsonLine(event));
}

/**
 * Build a `{type, ts, payload}` envelope, cleaning the payload exactly like Go's
 * writeJSONEvent: drop `undefined`/`null` and empty-string fields, but keep
 * `false` and `0`. `now` is injectable for deterministic tests.
 */
export function ndjsonEnvelope(
  type: string,
  payload: Record<string, unknown>,
  now: () => string = defaultTimestamp,
): NdjsonEnvelope {
  return { type, ts: now(), payload: cleanNdjsonPayload(payload) };
}

/** Drop nil and empty-string entries from a payload (booleans/numbers survive). */
export function cleanNdjsonPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value === "") continue;
    out[key] = value;
  }
  return out;
}

function defaultTimestamp(): string {
  return new Date().toISOString();
}
