import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createCheckpointer, CheckpointerCreationError } from "../factory.js";
import { HttpCheckpointSaver } from "../http-saver.js";
import { SqliteCheckpointSaver } from "../sqlite-saver.js";

describe("createCheckpointer", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("returns MemorySaver for type=memory", async () => {
    const saver = await createCheckpointer({ type: "memory" });
    expect(saver).toBeInstanceOf(MemorySaver);
  });

  it("returns SqliteCheckpointSaver for type=sqlite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-cp-factory-"));
    tempDirs.push(dir);
    const saver = await createCheckpointer({
      type: "sqlite",
      sqlitePath: join(dir, "checkpoints.db"),
    });
    expect(saver).toBeInstanceOf(SqliteCheckpointSaver);
    (saver as SqliteCheckpointSaver).close();
  });

  it("throws CheckpointerCreationError when sqlite is missing sqlitePath", async () => {
    await expect(
      createCheckpointer({ type: "sqlite" }),
    ).rejects.toThrow(CheckpointerCreationError);
  });

  it("returns HttpCheckpointSaver for type=http", async () => {
    const saver = await createCheckpointer({
      type: "http",
      proxyEndpoint: "https://proxy.test",
      authToken: { current: "tok-123" },
    });
    expect(saver).toBeInstanceOf(HttpCheckpointSaver);
  });

  it("throws CheckpointerCreationError when http is missing proxyEndpoint", async () => {
    await expect(
      createCheckpointer({ type: "http", authToken: { current: "tok" } }),
    ).rejects.toThrow(CheckpointerCreationError);
  });

  it("throws CheckpointerCreationError when http is missing authToken", async () => {
    await expect(
      createCheckpointer({ type: "http", proxyEndpoint: "https://proxy.test" }),
    ).rejects.toThrow(CheckpointerCreationError);
  });

  it("throws CheckpointerCreationError when the http credential ref holds nothing at open", async () => {
    await expect(
      createCheckpointer({ type: "http", proxyEndpoint: "https://proxy.test", authToken: { current: null } }),
    ).rejects.toThrow(CheckpointerCreationError);
  });

  it("hands the http saver the caller's ref itself, so a rotation after open reaches the saver's next request", async () => {
    const ref = { current: "boot-credential" };
    const saver = await createCheckpointer({ type: "http", proxyEndpoint: "https://proxy.test", authToken: ref });
    const fetchSpy = vi.fn().mockResolvedValue({ status: 404, ok: false });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      ref.current = "session-credential";
      await saver.getTuple({ configurable: { thread_id: "t", checkpoint_ns: "" } });
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe("Bearer session-credential");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("error includes the checkpointer type", async () => {
    try {
      await createCheckpointer({ type: "http" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointerCreationError);
      expect((err as CheckpointerCreationError).checkpointerType).toBe("http");
    }
  });
});
