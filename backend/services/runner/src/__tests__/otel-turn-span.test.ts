import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy span/tracer, hoisted so the vi.mock factory (which runs before imports)
// can close over them without a temporal-dead-zone error.
const { spanEnd, spanSetAttribute, startSpan } = vi.hoisted(() => {
  const spanEnd = vi.fn();
  const spanSetAttribute = vi.fn();
  const startSpan = vi.fn(() => ({ end: spanEnd, setAttribute: spanSetAttribute }));
  return { spanEnd, spanSetAttribute, startSpan };
});

vi.mock("@opentelemetry/api", () => ({
  trace: { getTracer: () => ({ startSpan }) },
}));

import {
  startCursorTurnSpan,
  ATTR_LLM_INPUT_TOKENS,
  ATTR_LLM_OUTPUT_TOKENS,
} from "../otel.js";

const spanAttrs = { model: "gpt-x", mode: "local", sessionId: "sess-1" };

describe("startCursorTurnSpan", () => {
  beforeEach(() => {
    spanEnd.mockClear();
    spanSetAttribute.mockClear();
    startSpan.mockClear();
  });

  it("records the input and output token attributes", async () => {
    const span = await startCursorTurnSpan(spanAttrs);
    span.setTokens(1200, 340);
    expect(spanSetAttribute).toHaveBeenCalledWith(ATTR_LLM_INPUT_TOKENS, 1200);
    expect(spanSetAttribute).toHaveBeenCalledWith(ATTR_LLM_OUTPUT_TOKENS, 340);
  });

  it("omits zero-valued token attributes (no count = no attribute)", async () => {
    const span = await startCursorTurnSpan(spanAttrs);
    span.setTokens(0, 0);
    expect(spanSetAttribute).not.toHaveBeenCalled();
  });

  it("ends the span exactly once even when end() is called repeatedly", async () => {
    // finishTurnTelemetry is invoked from the activity's finally on every exit
    // path; a second end() (e.g. a defensive double-invoke) must be a no-op so
    // OTel never warns about ending an already-ended span.
    const span = await startCursorTurnSpan(spanAttrs);
    span.end();
    span.end();
    span.end();
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores setTokens after the span has ended (no late mutation)", async () => {
    const span = await startCursorTurnSpan(spanAttrs);
    span.end();
    span.setTokens(1200, 340);
    expect(spanSetAttribute).not.toHaveBeenCalled();
  });
});
