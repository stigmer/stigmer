// Proves a sample turn's span (../samples.ts, `durationMs`): set, the turn's
// events run evenly from the sample instant to that span after it, so a
// finished turn reads its real time and its steps theirs; unset, every
// event keeps the stamp its builder gives, as every fixture written before
// it expects.
import { describe, it, expect } from "vitest";
import { SAMPLE_INSTANT, samples, sampleInstant } from "../samples";

/** Each event's `processedAt`, in log order. */
function stamps(events: ReturnType<typeof samples.turnEvents>): string[] {
  return events.map((e) => {
    const value = e.event.value;
    return value !== undefined && "processedAt" in value ? String(value.processedAt) : "";
  });
}

const TOOLS = [
  { name: "read_file", input: { path: "src/billing/invoice.ts" }, result: "export function lineTotal() {}" },
  { name: "edit_file", input: { path: "src/billing/invoice.ts" }, result: "1 edit applied" },
];

describe("samples.turnEvents with a span", () => {
  it("spreads the events evenly over the span, the message first and the final status at its end", () => {
    const events = samples.turnEvents({ tools: TOOLS, durationMs: 42_000 });
    const at = stamps(events);
    expect(at[0]).toBe(SAMPLE_INSTANT);
    expect(at.at(-1)).toBe(sampleInstant(42_000));
    const ms = at.map((iso) => Date.parse(iso) - Date.parse(SAMPLE_INSTANT));
    const gaps = ms.slice(1).map((value, index) => value - ms[index]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it("puts the steps inside the turn, so they span part of it", () => {
    const at = stamps(samples.turnEvents({ tools: TOOLS, durationMs: 42_000 })).map((iso) => Date.parse(iso) - Date.parse(SAMPLE_INSTANT));
    // message, running, two uses with their results, the reply, the final status
    const [firstUse, lastResult] = [at[2]!, at[5]!];
    expect(firstUse).toBeGreaterThan(0);
    expect(lastResult).toBeGreaterThan(firstUse);
    expect(lastResult).toBeLessThan(42_000);
  });

  it("keeps the builders' own stamps when no span is given", () => {
    // Every event at the sample instant, a tool's result 1.2s after it (its step's own time).
    expect(new Set(stamps(samples.turnEvents({ tools: TOOLS })))).toEqual(new Set([SAMPLE_INSTANT, sampleInstant(1_200)]));
  });
});
