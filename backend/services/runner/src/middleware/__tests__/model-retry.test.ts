/**
 * The model retry middleware (`model-retry.ts`): a reply that failed after
 * it began is called again within its count, on p-retry's first waits and
 * never shorter than the provider's hint; a failure the request loop
 * already handled, or one that cannot pass, goes straight through; a stop
 * during a wait ends it at once; each failed attempt leaves one line.
 *
 * The provider's errors are the SDK's own classes, wrapped in LangChain's
 * own `MiddlewareError` as deepagents' tail wraps them before they reach
 * this middleware.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import { AIMessage } from "@langchain/core/messages";
import { stampRetryable } from "@langchain/core/errors";
import { MiddlewareError } from "langchain";

import { createModelRetryMiddleware, streamRetryDelayMs } from "../model-retry.js";
import type { ModelCallRequest } from "../types.js";

/** An `event: error` after a 200, wrapped once by a middleware inside this one. */
function midReplyOverload(): Error {
  const err = new APIError(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers(), "overloaded_error");
  return MiddlewareError.wrap(err, "promptCaching") as Error;
}

function providerError(status: number, headers: Record<string, string> = {}): APIError {
  return APIError.generate(status, { type: "error", error: { type: "error", message: `HTTP ${status}` } }, undefined, new Headers(headers));
}

function request(signal?: AbortSignal): ModelCallRequest {
  return { model: {}, messages: [], state: { messages: [] }, runtime: { signal } };
}

/** A handler that throws each of `failures` in turn, then answers. */
function failingThen(...failures: Error[]) {
  const answer = new AIMessage("done");
  const handler = vi.fn(async () => {
    const next = failures.shift();
    if (next !== undefined) throw next;
    return answer;
  });
  return { handler, answer };
}

describe("model retry middleware", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal | undefined) => {});

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sleep.mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const middleware = () => createModelRetryMiddleware({ sleep, random: () => 0 });

  it("calls again a reply that failed after it began, on p-retry's first two waits", async () => {
    const { handler, answer } = failingThen(midReplyOverload(), midReplyOverload());

    await expect(middleware().wrapModelCall!(request(), handler)).resolves.toBe(answer);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "[MODEL-RETRY] phase=stream decision=retry reason=overloaded attempt=1/3 delay_ms=1000",
      "[MODEL-RETRY] phase=stream decision=retry reason=overloaded attempt=2/3 delay_ms=2000",
    ]);
  });

  it("gives up after its count, throwing the call's own error", async () => {
    const last = midReplyOverload();
    const { handler } = failingThen(midReplyOverload(), midReplyOverload(), last);

    await expect(middleware().wrapModelCall!(request(), handler)).rejects.toBe(last);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.at(-1)?.[0]).toBe("[MODEL-RETRY] phase=stream decision=stop reason=overloaded attempt=3/3 delay_ms=none");
  });

  it("never retries a failure the request loop handled, and logs nothing of its own for it", async () => {
    const handled = MiddlewareError.wrap(stampRetryable(providerError(529), false), "promptCaching") as Error;
    const { handler } = failingThen(handled);

    await expect(middleware().wrapModelCall!(request(), handler)).rejects.toBe(handled);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("never retries a failure that cannot pass", async () => {
    const refused = providerError(401);
    const { handler } = failingThen(refused);

    await expect(middleware().wrapModelCall!(request(), handler)).rejects.toBe(refused);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[MODEL-RETRY] phase=stream decision=stop reason=refused attempt=1/3 delay_ms=none");
  });

  it("waits no less than the provider's retry-after", async () => {
    const { handler, answer } = failingThen(providerError(503, { "retry-after": "3" }));

    await expect(middleware().wrapModelCall!(request(), handler)).resolves.toBe(answer);

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3_000]);
    expect(streamRetryDelayMs(2, 500, () => 1)).toBe(4_000);
    expect(streamRetryDelayMs(1, undefined, () => 0.5)).toBe(1_500);
  });

  it("ends a wait at once when the run is stopped, with the stop's own reason", async () => {
    const controller = new AbortController();
    const stop = new Error("stopped by the person");
    const { handler } = failingThen(midReplyOverload());
    const started = performance.now();
    setTimeout(() => controller.abort(stop), 20);

    await expect(createModelRetryMiddleware({ random: () => 0 }).wrapModelCall!(request(controller.signal), handler)).rejects.toBe(stop);

    expect(performance.now() - started).toBeLessThan(900);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not wait at all when the run was already stopped", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const { handler } = failingThen(midReplyOverload());

    await expect(createModelRetryMiddleware().wrapModelCall!(request(controller.signal), handler)).rejects.toThrow("stopped");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
