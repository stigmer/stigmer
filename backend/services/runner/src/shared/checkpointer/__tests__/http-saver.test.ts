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

  beforeEach(() => {
    saver = new HttpCheckpointSaver(PROXY, TOKEN);
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
