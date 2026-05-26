import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { createV2EventRecorder } from "../event-recorder.js";
import type { StreamEvent } from "../status-builder.js";

function makeEvent(eventType: string, runId: string, data: Record<string, unknown> = {}): StreamEvent {
  return { event: eventType, run_id: runId, data };
}

describe("createV2EventRecorder", () => {
  it("returns undefined when recordDir is undefined", () => {
    expect(createV2EventRecorder("exec-1", undefined)).toBeUndefined();
  });

  it("returns undefined when recordDir is empty string", () => {
    expect(createV2EventRecorder("exec-1", "")).toBeUndefined();
  });

  it("returns a recorder when recordDir is provided", () => {
    const recorder = createV2EventRecorder("exec-1", "/tmp/test");
    expect(recorder).toBeDefined();
    expect(recorder!.record).toBeInstanceOf(Function);
    expect(recorder!.flush).toBeInstanceOf(Function);
  });
});

describe("V2EventRecorder", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "v2-recorder-test-"));
  });

  it("flush is a no-op when no events are recorded", async () => {
    const recorder = createV2EventRecorder("exec-empty", testDir)!;
    await recorder.flush();

    const files = await import("node:fs/promises").then(fs => fs.readdir(testDir));
    expect(files).toHaveLength(0);
  });

  it("writes events to a JSON file named by execution ID", async () => {
    const recorder = createV2EventRecorder("exec-abc", testDir)!;

    recorder.record(
      makeEvent("on_chat_model_stream", "run-1", { chunk: { content: "hello" } }),
      0,
    );
    recorder.record(
      makeEvent("on_chat_model_end", "run-1", { output: { content: "done" } }),
      1,
    );

    await recorder.flush();

    const filePath = join(testDir, "exec-abc.v2-events.json");
    const content = JSON.parse(await readFile(filePath, "utf-8"));

    expect(content.executionId).toBe("exec-abc");
    expect(content.eventCount).toBe(2);
    expect(content.recordedAt).toBeTruthy();
    expect(content.events).toHaveLength(2);

    expect(content.events[0].seq).toBe(0);
    expect(content.events[0].event).toBe("on_chat_model_stream");
    expect(content.events[0].run_id).toBe("run-1");
    expect(content.events[0].data.chunk.content).toBe("hello");
    expect(content.events[0].timestamp).toBeTruthy();

    expect(content.events[1].seq).toBe(1);
    expect(content.events[1].event).toBe("on_chat_model_end");
  });

  it("preserves event metadata when present", async () => {
    const recorder = createV2EventRecorder("exec-meta", testDir)!;

    recorder.record(
      {
        event: "on_chat_model_stream",
        run_id: "run-1",
        data: { chunk: { content: "text" } },
        metadata: { langgraph_checkpoint_ns: "tools:task-1|agent_node:inner" },
      },
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-meta.v2-events.json"), "utf-8"),
    );

    expect(content.events[0].metadata.langgraph_checkpoint_ns).toBe(
      "tools:task-1|agent_node:inner",
    );
  });

  it("handles circular references in event data gracefully", async () => {
    const recorder = createV2EventRecorder("exec-circular", testDir)!;

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    recorder.record(
      { event: "on_tool_end", run_id: "run-1", data: circular },
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-circular.v2-events.json"), "utf-8"),
    );

    expect(content.events[0].data._serializationError).toBe(true);
    expect(content.events[0].data.keys).toContain("a");
  });

  it("creates output directory if it does not exist", async () => {
    const nestedDir = join(testDir, "nested", "deep", "dir");
    const recorder = createV2EventRecorder("exec-mkdir", nestedDir)!;

    recorder.record(makeEvent("on_chat_model_stream", "run-1", { chunk: { content: "hi" } }), 0);
    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(nestedDir, "exec-mkdir.v2-events.json"), "utf-8"),
    );
    expect(content.eventCount).toBe(1);
  });

  it("preserves event name field", async () => {
    const recorder = createV2EventRecorder("exec-name", testDir)!;

    recorder.record(
      { event: "on_tool_start", name: "read_file", run_id: "tool-1", data: { input: {} } },
      0,
    );

    await recorder.flush();

    const content = JSON.parse(
      await readFile(join(testDir, "exec-name.v2-events.json"), "utf-8"),
    );
    expect(content.events[0].name).toBe("read_file");
  });
});
