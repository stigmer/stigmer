import { describe, it, expect } from "vitest";
import { isRetryableHttpStatus, isRetryableFetchError } from "../http-retry.js";

// The shared bounded-backoff loop (fetchWithRetry, same module) is exercised
// through its consumers' suites — http-saver.test.ts ("retry behavior"),
// artifact-storage.test.ts, registry-fetch tests — which pin the loop's
// behavior at real call sites rather than in the abstract. This file covers
// the classification policy in isolation — the grpc-retry.test.ts twin.

describe("isRetryableHttpStatus", () => {
  it("returns true for 408 (request timeout)", () => {
    expect(isRetryableHttpStatus(408)).toBe(true);
  });

  it("returns true for 429 (throttled)", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
  });

  it.each([500, 502, 503, 504])("returns true for %i", (status) => {
    expect(isRetryableHttpStatus(status)).toBe(true);
  });

  // The four deterministic errors CheckpointerProxyController actually emits:
  // 400 malformed, 403 FGA deny, 404 missing, 413 over the 4 MB cap. Retrying
  // any of them would repeat the same failure (and 404 carries semantics —
  // getTuple maps it to "no checkpoint yet").
  it.each([400, 401, 403, 404, 413])("returns false for deterministic %i", (status) => {
    expect(isRetryableHttpStatus(status)).toBe(false);
  });

  it("returns false for success statuses", () => {
    expect(isRetryableHttpStatus(200)).toBe(false);
    expect(isRetryableHttpStatus(204)).toBe(false);
  });
});

describe("isRetryableFetchError", () => {
  it("returns true for undici's network-failure shape (TypeError: fetch failed)", () => {
    const err = new TypeError("fetch failed");
    (err as TypeError & { cause?: unknown }).cause = new Error("connect ECONNREFUSED");
    expect(isRetryableFetchError(err)).toBe(true);
  });

  it("returns true for a bare TypeError (no cause)", () => {
    expect(isRetryableFetchError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for AbortSignal.timeout's rejection shape (TimeoutError)", () => {
    // DOMException with name "TimeoutError" is what AbortSignal.timeout()
    // produces; construct the real shape rather than a look-alike.
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(isRetryableFetchError(err)).toBe(true);
  });

  it("returns false for a manual abort (AbortError) — the caller cancelled on purpose", () => {
    const err = new DOMException("This operation was aborted", "AbortError");
    expect(isRetryableFetchError(err)).toBe(false);
  });

  it("returns false for a generic Error", () => {
    expect(isRetryableFetchError(new Error("random"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableFetchError("boom")).toBe(false);
    expect(isRetryableFetchError(undefined)).toBe(false);
  });
});
