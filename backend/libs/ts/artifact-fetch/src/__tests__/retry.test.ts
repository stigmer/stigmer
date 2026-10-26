/**
 * Pins the download retry contract (`retry.ts`) over a scripted fetch: which
 * failures are transient (a connection that never answers, a body that drops,
 * a 5xx, a 429) and which are answers (a 404, a failure the reader raises as
 * an ArtifactFetchError), the doubling wait, the error a persistent failure
 * ends in, and that an abort is thrown as its own reason and never retried.
 * The CLI's Temporal suite pins the same contract end to end through its
 * installer; this suite pins it where it lives.
 */

import { describe, expect, it } from "vitest";

import { ArtifactFetchError } from "../errors.js";
import { DOWNLOAD_ATTEMPTS, describeFailure, fetchWithRetry, type Network } from "../retry.js";

type Step = "reject" | number | "ok";

function scripted(steps: Step[]): { net: Network; delays: number[]; calls: () => number } {
  let calls = 0;
  const delays: number[] = [];
  const fetchImpl = (async () => {
    const step = steps[calls] ?? "ok";
    calls += 1;
    if (step === "reject") throw new TypeError("fetch failed", { cause: new Error("read ECONNRESET") });
    if (typeof step === "number") return new Response(null, { status: step });
    return new Response("body");
  }) as unknown as typeof fetch;
  return {
    net: { fetch: fetchImpl, sleep: async (ms) => void delays.push(ms) },
    delays,
    calls: () => calls,
  };
}

const read = (res: Response): Promise<string> => res.text();

describe("fetchWithRetry", () => {
  it("retries a refused connection, a 5xx and a 429, doubling the wait", async () => {
    const { net, delays, calls } = scripted(["reject", 503, 429, "ok"]);
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", read)).resolves.toBe("body");
    expect(calls()).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("takes a 404 as the answer", async () => {
    const { net, calls, delays } = scripted([404]);
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", read)).rejects.toThrow(
      new ArtifactFetchError("failed to download A: HTTP 404 from https://example.test/a.tgz"),
    );
    expect(calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries a body that fails while it is read", async () => {
    const { net, calls } = scripted(["ok", "ok"]);
    let reads = 0;
    const flakyRead = async (res: Response): Promise<string> => {
      reads += 1;
      if (reads === 1) throw new TypeError("terminated", { cause: new Error("other side closed") });
      return res.text();
    };
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", flakyRead)).resolves.toBe("body");
    expect(calls()).toBe(2);
  });

  it("does not retry an ArtifactFetchError the reader raises: it is an answer", async () => {
    const { net, calls } = scripted(["ok", "ok"]);
    const refusing = async (): Promise<string> => {
      throw new ArtifactFetchError("A checksum mismatch");
    };
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", refusing)).rejects.toThrow("A checksum mismatch");
    expect(calls()).toBe(1);
  });

  it("gives up after four attempts, naming the last failure and what to do", async () => {
    const { net, calls } = scripted(["reject", "reject", "reject", "reject"]);
    const err: unknown = await fetchWithRetry(net, "https://example.test/a.tgz", "A", read).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArtifactFetchError);
    expect((err as ArtifactFetchError).message).toBe(
      "failed to download A from https://example.test/a.tgz after 4 attempts: fetch failed: read ECONNRESET",
    );
    expect((err as ArtifactFetchError).details).toEqual(["check the network connection, then run the command again"]);
    expect(calls()).toBe(DOWNLOAD_ATTEMPTS);
  });

  it("throws an abort's own reason at once and never retries it", async () => {
    const controller = new AbortController();
    const reason = new Error("the turn was stopped");
    let calls = 0;
    const net: Network = {
      fetch: (async () => {
        calls += 1;
        controller.abort(reason);
        throw new DOMException("This operation was aborted", "AbortError");
      }) as unknown as typeof fetch,
      sleep: async () => {},
    };
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", read, controller.signal)).rejects.toBe(reason);
    expect(calls).toBe(1);
  });

  it("does not start when the signal has already aborted", async () => {
    const { net, calls } = scripted(["ok"]);
    const reason = new Error("stopped before");
    await expect(fetchWithRetry(net, "https://example.test/a.tgz", "A", read, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(calls()).toBe(0);
  });
});

describe("describeFailure", () => {
  it("appends the socket error behind fetch's message, and stringifies a non-error", () => {
    expect(describeFailure(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }))).toBe("fetch failed: ECONNREFUSED");
    expect(describeFailure(new Error("plain"))).toBe("plain");
    expect(describeFailure("text")).toBe("text");
  });
});
