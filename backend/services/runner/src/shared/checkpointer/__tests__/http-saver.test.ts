import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpCheckpointSaver } from "../http-saver.js";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";

const PROXY = "https://proxy.test";
const TOKEN = "test-token";

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    configurable: {
      thread_id: "thread-1",
      checkpoint_ns: "",
      checkpoint_id: "cp-1",
      ...overrides,
    },
  };
}

async function serializeForProxy(obj: unknown): Promise<{ type: string; binary: Record<string, any> }> {
  const helperSaver = new HttpCheckpointSaver(PROXY, TOKEN);
  const [typeTag, payload] = await helperSaver.serde.dumpsTyped(obj);
  const b64 = Buffer.from(payload).toString("base64");
  return {
    type: typeTag,
    binary: { $binary: { base64: b64, subType: "00" } },
  };
}

describe("HttpCheckpointSaver", () => {
  let saver: HttpCheckpointSaver;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let recordedDelays: number[];

  beforeEach(() => {
    // delayFn injected so retry-path tests record the backoff schedule
    // instead of sleeping through it (~7.75 s of real delays otherwise).
    recordedDelays = [];
    saver = new HttpCheckpointSaver(PROXY, TOKEN, {
      delayFn: async (ms) => {
        recordedDelays.push(ms);
      },
    });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTuple", () => {
    it("returns undefined on 404", async () => {
      fetchSpy.mockResolvedValue({ status: 404, ok: false });
      const result = await saver.getTuple(makeConfig());
      expect(result).toBeUndefined();
    });

    it("throws on non-404 error", async () => {
      fetchSpy.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
      });
      await expect(saver.getTuple(makeConfig())).rejects.toThrow("500");
    });

    it("includes authorization header", async () => {
      fetchSpy.mockResolvedValue({ status: 404, ok: false });
      await saver.getTuple(makeConfig());
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBe("Bearer test-token");
      expect(url).toContain("/v1/proxy/checkpoints/checkpoint");
    });
  });

  describe("put", () => {
    it("sends checkpoint and metadata as $binary to the proxy", async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      const checkpoint: Checkpoint = {
        v: 4,
        id: "cp-new",
        ts: new Date().toISOString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
      };
      const metadata: CheckpointMetadata = {
        source: "loop",
        step: 0,
        parents: {},
      };

      const result = await saver.put(makeConfig(), checkpoint, metadata, {});
      expect(result.configurable?.checkpoint_id).toBe("cp-new");
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain("/checkpoint");
      expect(opts.method).toBe("PUT");

      const body = JSON.parse(opts.body);
      expect(body.thread_id).toBe("thread-1");
      expect(body.checkpoint_id).toBe("cp-new");
      expect(body.checkpoint.$binary).toBeDefined();
      expect(body.metadata.$binary).toBeDefined();
      expect(body.type).toBeDefined();
    });
  });

  describe("putWrites", () => {
    it("sends writes array with $binary values", async () => {
      fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      await saver.putWrites(
        makeConfig(),
        [["messages", { content: "hello" }]],
        "task-1",
      );

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain("/writes");
      expect(opts.method).toBe("PUT");

      const body = JSON.parse(opts.body);
      expect(body.writes).toHaveLength(1);
      expect(body.writes[0].task_id).toBe("task-1");
      expect(body.writes[0].channel).toBe("messages");
      expect(body.writes[0].value.$binary).toBeDefined();
    });
  });

  describe("list", () => {
    it("yields checkpoint tuples from proxy response", async () => {
      const cp: Checkpoint = {
        v: 4,
        id: "cp-list-1",
        ts: new Date().toISOString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
      };
      const md: CheckpointMetadata = { source: "loop", step: 1, parents: {} };
      const cpSer = await serializeForProxy(cp);
      const mdSer = await serializeForProxy(md);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            checkpoints: [
              {
                thread_id: "thread-1",
                checkpoint_ns: "",
                checkpoint_id: "cp-list-1",
                type: cpSer.type,
                checkpoint: cpSer.binary,
                metadata_type: mdSer.type,
                metadata: mdSer.binary,
              },
            ],
          }),
      });

      const results: any[] = [];
      for await (const tuple of saver.list(makeConfig())) {
        results.push(tuple);
      }
      expect(results).toHaveLength(1);
      expect(results[0].config.configurable.checkpoint_id).toBe("cp-list-1");
    });
  });

  // The bounded-backoff loop (cloud#188). Classification policy itself is
  // covered by shared/__tests__/http-retry.test.ts; these cases pin the
  // loop's behavior at the saver's call sites: transient failures recover,
  // deterministic failures never retry, budget exhaustion still fails
  // loudly, and 404 semantics survive unchanged.
  describe("retry behavior", () => {
    const ok404 = { status: 404, ok: false, statusText: "Not Found" };
    const err503 = { status: 503, ok: false, statusText: "Service Unavailable" };
    const err400 = { status: 400, ok: false, statusText: "Bad Request" };
    const err401 = { status: 401, ok: false, statusText: "Unauthorized" };

    function makeCheckpoint(): Checkpoint {
      return {
        v: 4,
        id: "cp-retry",
        ts: new Date().toISOString(),
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
      };
    }
    const md: CheckpointMetadata = { source: "loop", step: 0, parents: {} };

    it("recovers a put from a transient 503", async () => {
      fetchSpy
        .mockResolvedValueOnce(err503)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const result = await saver.put(makeConfig(), makeCheckpoint(), md, {});
      expect(result.configurable?.checkpoint_id).toBe("cp-retry");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(recordedDelays).toEqual([250]);
    });

    it("recovers a put from a network-level rejection (undici TypeError)", async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await expect(saver.put(makeConfig(), makeCheckpoint(), md, {})).resolves.toBeDefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("backs off exponentially across consecutive transient failures", async () => {
      fetchSpy
        .mockResolvedValueOnce(err503)
        .mockResolvedValueOnce(err503)
        .mockResolvedValueOnce(err503)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await saver.put(makeConfig(), makeCheckpoint(), md, {});
      expect(recordedDelays).toEqual([250, 500, 1000]);
    });

    it("fails loudly when the budget is exhausted on a retryable status", async () => {
      fetchSpy.mockResolvedValue(err503);

      await expect(saver.put(makeConfig(), makeCheckpoint(), md, {}))
        .rejects.toThrow("Checkpoint PUT failed: 503");
      // 1 initial attempt + 5 retries (the default budget).
      expect(fetchSpy).toHaveBeenCalledTimes(6);
      expect(recordedDelays).toEqual([250, 500, 1000, 2000, 4000]);
    });

    it("rethrows the original error when the budget is exhausted on network rejections", async () => {
      const netErr = new TypeError("fetch failed");
      fetchSpy.mockRejectedValue(netErr);

      await expect(saver.putWrites(makeConfig(), [["messages", { a: 1 }]], "t1"))
        .rejects.toBe(netErr);
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it("never retries a deterministic 400", async () => {
      fetchSpy.mockResolvedValue(err400);

      await expect(saver.put(makeConfig(), makeCheckpoint(), md, {}))
        .rejects.toThrow("Checkpoint PUT failed: 400");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(recordedDelays).toEqual([]);
    });

    it("never retries a rejected credential (401)", async () => {
      fetchSpy.mockResolvedValue(err401);

      await expect(saver.getTuple(makeConfig())).rejects.toThrow("Checkpoint GET failed: 401");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("never retries a manual abort (AbortError)", async () => {
      const abortErr = new DOMException("This operation was aborted", "AbortError");
      fetchSpy.mockRejectedValue(abortErr);

      await expect(saver.getTuple(makeConfig())).rejects.toBe(abortErr);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("retries a hung request aborted by the per-request timeout (TimeoutError)", async () => {
      fetchSpy
        .mockRejectedValueOnce(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        )
        .mockResolvedValueOnce(ok404);

      await expect(saver.getTuple(makeConfig())).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("preserves getTuple's 404 semantics without retrying", async () => {
      fetchSpy.mockResolvedValue(ok404);

      await expect(saver.getTuple(makeConfig())).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("preserves deleteThread's 404 tolerance without retrying", async () => {
      fetchSpy.mockResolvedValue(ok404);

      await expect(saver.deleteThread("thread-1")).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("bounds every request with an abort signal", async () => {
      fetchSpy.mockResolvedValue(ok404);

      await saver.getTuple(makeConfig());
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it("surfaces a pending-writes read failure instead of silently degrading", async () => {
      // The checkpoint GET succeeds; the follow-up writes GET fails on every
      // attempt. Pre-#188 code mapped this to "no pending writes" and
      // returned a tuple stripped of resume state.
      const cp = makeCheckpoint();
      const cpSer = await serializeForProxy(cp);
      const mdSer = await serializeForProxy(md);
      const checkpointDoc = {
        thread_id: "thread-1",
        checkpoint_ns: "",
        checkpoint_id: cp.id,
        type: cpSer.type,
        checkpoint: cpSer.binary,
        metadata_type: mdSer.type,
        metadata: mdSer.binary,
      };
      fetchSpy.mockImplementation((url: string) => {
        if (url.includes("/writes")) return Promise.resolve(err503);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(checkpointDoc) });
      });

      await expect(saver.getTuple(makeConfig())).rejects.toThrow(
        "Checkpoint writes GET failed: 503",
      );
    });

    it("recovers the pending-writes read from a transient failure", async () => {
      const cp = makeCheckpoint();
      const cpSer = await serializeForProxy(cp);
      const mdSer = await serializeForProxy(md);
      const checkpointDoc = {
        thread_id: "thread-1",
        checkpoint_ns: "",
        checkpoint_id: cp.id,
        type: cpSer.type,
        checkpoint: cpSer.binary,
        metadata_type: mdSer.type,
        metadata: mdSer.binary,
      };
      let writesCalls = 0;
      fetchSpy.mockImplementation((url: string) => {
        if (url.includes("/writes")) {
          writesCalls++;
          return writesCalls === 1
            ? Promise.resolve(err503)
            : Promise.resolve({ ok: true, json: () => Promise.resolve({ writes: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(checkpointDoc) });
      });

      const tuple = await saver.getTuple(makeConfig());
      expect(tuple?.checkpoint.id).toBe(cp.id);
      expect(tuple?.pendingWrites).toEqual([]);
      expect(writesCalls).toBe(2);
    });
  });

  describe("URL construction", () => {
    it("strips trailing slashes from proxy endpoint", () => {
      const s = new HttpCheckpointSaver("https://proxy.test///", "tok");
      fetchSpy.mockResolvedValue({ status: 404, ok: false });
      s.getTuple(makeConfig());
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("https://proxy.test/v1/proxy/checkpoints/checkpoint");
    });
  });
});
