import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createV3EventRecorder, type V3ProtocolEvent } from "../v3-event-recorder.js";

function makeProtocolEvent(
  seq: number,
  method: string,
  data: unknown = {},
  opts?: { namespace?: string[]; node?: string },
): V3ProtocolEvent {
  return {
    type: "event",
    seq,
    method,
    params: {
      namespace: opts?.namespace ?? [],
      timestamp: 1716700000000 + seq * 100,
      node: opts?.node,
      data,
    },
  };
}

describe("createV3EventRecorder", () => {
  it("returns undefined when recordDir is undefined", () => {
    expect(createV3EventRecorder("exec-1", undefined)).toBeUndefined();
  });

  it("returns undefined when recordDir is empty string", () => {
    expect(createV3EventRecorder("exec-1", "")).toBeUndefined();
  });

  it("returns a recorder when recordDir is provided", () => {
    const recorder = createV3EventRecorder("exec-1", "/tmp/test");
    expect(recorder).toBeDefined();
    expect(recorder!.record).toBeInstanceOf(Function);
    expect(recorder!.flush).toBeInstanceOf(Function);
  });
});

describe("V3EventRecorder", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "v3-recorder-test-"));
  });

  it("flush is a no-op when no events are recorded", async () => {
    const recorder = createV3EventRecorder("exec-empty", testDir)!;
    await recorder.flush();

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(testDir);
    expect(files).toHaveLength(0);
  });

  it("writes events to a JSON file named by execution ID", async () => {
    const recorder = createV3EventRecorder("exec-abc", testDir)!;

    recorder.record(
      makeProtocolEvent(0, "messages", { event: "message-start", data: { role: "assistant" } }),
      0,
    );
    recorder.record(
      makeProtocolEvent(1, "messages", { event: "message-finish", data: { usage: { input: 10 } } }),
      1,
    );

    await recorder.flush();

    const filePath = join(testDir, "exec-abc.v3-events.json");
    const content = JSON.parse(await readFile(filePath, "utf-8"));

    expect(content.executionId).toBe("exec-abc");
    expect(content.eventCount).toBe(2);
    expect(content.recordedAt).toBeTruthy();
    expect(content.events).toHaveLength(2);

    expect(content.events[0].seq).toBe(0);
    expect(content.events[0].method).toBe("messages");
    expect(content.events[0].type).toBe("event");
    expect(content.events[0].namespace).toEqual([]);
    expect(content.events[0].timestamp).toBe(1716700000000);
    expect(content.events[0].data.event).toBe("message-start");
    expect(content.events[0].capturedAt).toBeTruthy();

    expect(content.events[1].seq).toBe(1);
    expect(content.events[1].method).toBe("messages");
    expect(content.events[1].timestamp).toBe(1716700000100);
  });

  it("preserves namespace and node fields", async () => {
    const recorder = createV3EventRecorder("exec-ns", testDir)!;

    recorder.record(
      makeProtocolEvent(0, "tools", { type: "tool-started" }, {
        namespace: ["tools:task-1", "agent_node:inner"],
        node: "model_request",
      }),
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-ns.v3-events.json"), "utf-8"),
    );

    expect(content.events[0].namespace).toEqual(["tools:task-1", "agent_node:inner"]);
    expect(content.events[0].node).toBe("model_request");
  });

  it("handles circular references in event data gracefully", async () => {
    const recorder = createV3EventRecorder("exec-circular", testDir)!;

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    recorder.record(
      makeProtocolEvent(0, "custom", circular),
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-circular.v3-events.json"), "utf-8"),
    );

    expect(content.events[0].data._serializationError).toBe(true);
    expect(content.events[0].data.keys).toContain("a");
  });

  it("handles bigint values in event data", async () => {
    const recorder = createV3EventRecorder("exec-bigint", testDir)!;

    recorder.record(
      makeProtocolEvent(0, "messages", { tokens: BigInt(12345) }),
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-bigint.v3-events.json"), "utf-8"),
    );

    expect(content.events[0].data.tokens).toBe("12345");
  });

  it("creates output directory if it does not exist", async () => {
    const nestedDir = join(testDir, "nested", "deep", "dir");
    const recorder = createV3EventRecorder("exec-mkdir", nestedDir)!;

    recorder.record(makeProtocolEvent(0, "lifecycle", { event: "started" }), 0);
    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(nestedDir, "exec-mkdir.v3-events.json"), "utf-8"),
    );
    expect(content.eventCount).toBe(1);
  });

  it("records all protocol channel methods", async () => {
    const recorder = createV3EventRecorder("exec-channels", testDir)!;

    const channels = ["messages", "tools", "lifecycle", "updates", "values", "input", "custom"];
    for (let i = 0; i < channels.length; i++) {
      recorder.record(makeProtocolEvent(i, channels[i], { channel: channels[i] }), i);
    }

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-channels.v3-events.json"), "utf-8"),
    );

    expect(content.eventCount).toBe(7);
    const methods = content.events.map((e: { method: string }) => e.method);
    expect(methods).toEqual(channels);
  });
});

