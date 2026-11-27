/**
 * The runner's transport for LangChain's Google client
 * (`google-transport.ts`): the credential it adds by destination, and the
 * per-attempt bound, armed until the response headers arrive.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { googleTransport } from "../google-transport.js";
import { isModelTimeout } from "../model-error.js";
import { retryDecisionOf } from "../model-retry.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent";

describe("googleTransport", () => {
  it("adds the key in x-goog-api-key to a call to Google, over any header the client set", async () => {
    let seen: Headers | undefined;
    vi.stubGlobal("fetch", async (request: Request) => {
      seen = request.headers;
      return new Response("{}");
    });

    await googleTransport({ credential: { kind: "google-key", key: "k" } }).fetch(
      new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": "from-the-client" }, body: "{}" }),
    );

    expect(seen?.get("x-goog-api-key")).toBe("k");
    expect(seen?.get("content-type")).toBe("application/json");
  });

  it("names no project: the runner never builds a Vertex path", async () => {
    expect(await googleTransport({ credential: { kind: "google-key", key: "k" } }).getProjectId()).toBe("");
  });

  it("adds the Stigmer headers, and no Google key, to a call to a Stigmer endpoint", async () => {
    let seen: Headers | undefined;
    vi.stubGlobal("fetch", async (request: Request) => {
      seen = request.headers;
      return new Response("{}");
    });

    await googleTransport({ credential: { kind: "stigmer", headers: { Authorization: "Bearer t", "X-Stigmer-Execution-Id": "run_1" } } }).fetch(
      new Request(URL, { method: "POST", body: "{}" }),
    );

    expect(seen?.get("authorization")).toBe("Bearer t");
    expect(seen?.get("x-stigmer-execution-id")).toBe("run_1");
    expect(seen?.has("x-goog-api-key")).toBe(false);
  });

  it("fails an attempt whose headers do not arrive in time with a model timeout the retry rule retries", async () => {
    vi.stubGlobal("fetch", (_request: Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );

    const failure = await googleTransport({ credential: { kind: "google-key", key: "k" }, timeoutMs: 20 })
      .fetch(new Request(URL, { method: "POST", body: "{}" }))
      .then(() => undefined, (err: unknown) => err as Error);

    expect(failure?.name).toBe("TimeoutError");
    expect(isModelTimeout([failure!])).toBe(true);
    expect(retryDecisionOf(failure)).toEqual({ retry: true, reason: "timeout" });
  });

  it("clears the bound once the headers arrive, so a long streamed reply is never cut", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_request: Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response("{}");
    });

    await googleTransport({ credential: { kind: "google-key", key: "k" }, timeoutMs: 20 }).fetch(new Request(URL, { method: "POST", body: "{}" }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(signal?.aborted).toBe(false);
  });

  it("keeps the caller's own abort", async () => {
    vi.stubGlobal("fetch", (_request: Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );
    const stop = new AbortController();

    const pending = googleTransport({ credential: { kind: "google-key", key: "k" }, timeoutMs: 60_000 })
      .fetch(new Request(URL, { method: "POST", body: "{}", signal: stop.signal }))
      .then(() => undefined, (err: unknown) => err as Error);
    stop.abort();

    expect((await pending)?.name).toBe("AbortError");
  });
});
