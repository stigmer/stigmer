import { describe, it, expect } from "vitest";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createCheckpointer, CheckpointerCreationError } from "../factory.js";
import { HttpCheckpointSaver } from "../http-saver.js";

describe("createCheckpointer", () => {
  it("returns MemorySaver for type=memory", async () => {
    const saver = await createCheckpointer({ type: "memory" });
    expect(saver).toBeInstanceOf(MemorySaver);
  });

  it("returns HttpCheckpointSaver for type=http", async () => {
    const saver = await createCheckpointer({
      type: "http",
      proxyEndpoint: "https://proxy.test",
      authToken: "tok-123",
    });
    expect(saver).toBeInstanceOf(HttpCheckpointSaver);
  });

  it("throws CheckpointerCreationError when http is missing proxyEndpoint", async () => {
    await expect(
      createCheckpointer({ type: "http", authToken: "tok" }),
    ).rejects.toThrow(CheckpointerCreationError);
  });

  it("throws CheckpointerCreationError when http is missing authToken", async () => {
    await expect(
      createCheckpointer({ type: "http", proxyEndpoint: "https://proxy.test" }),
    ).rejects.toThrow(CheckpointerCreationError);
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
