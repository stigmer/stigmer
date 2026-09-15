/**
 * The Cursor event recorder's contract (`cursor-event-recorder.ts`): off when
 * no directory is named; both SDK channels in ONE file under ONE arrival
 * counter, each line saying which channel it came from; the file named by the
 * execution; a cyclic payload recorded as a marker rather than failing the
 * flush. The native recorder's `v3-event-recorder.test.ts` is the sibling.
 *
 * The ordering arm is the reason the recorder exists in this shape: a delta
 * that arrives between two stream events must read between them in the file,
 * because "does `tool-call-completed` precede the stream's own completion" is
 * a question only the arrival order can answer.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { InteractionUpdate, SDKMessage } from "@cursor/sdk";
import { createCursorEventRecorder } from "../cursor-event-recorder.js";

/** A stream event carrying only what the recorder reads; the rest is payload. */
function streamEvent(type: string, extra: Record<string, unknown> = {}): SDKMessage {
  return { type, agent_id: "agent-1", run_id: "run-1", ...extra } as unknown as SDKMessage;
}

function delta(type: string, extra: Record<string, unknown> = {}): InteractionUpdate {
  return { type, ...extra } as unknown as InteractionUpdate;
}

interface RecordedLine {
  readonly seq: number;
  readonly capturedAt: string;
  readonly channel: "stream" | "delta";
  readonly type: string;
  readonly agent_id?: string;
  readonly run_id?: string;
  readonly event?: Record<string, unknown>;
  readonly update?: Record<string, unknown>;
}

async function readLines(dir: string, executionId: string): Promise<RecordedLine[]> {
  const content = await readFile(join(dir, `${executionId}.cursor-events.jsonl`), "utf-8");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine);
}

describe("createCursorEventRecorder", () => {
  it("returns undefined when no directory is named (recording off)", () => {
    expect(createCursorEventRecorder("exec-1", undefined)).toBeUndefined();
    expect(createCursorEventRecorder("exec-1", "")).toBeUndefined();
  });

  it("returns a recorder with both channels and a flush when a directory is named", () => {
    const recorder = createCursorEventRecorder("exec-1", "/tmp/unused");
    expect(recorder).toBeDefined();
    expect(recorder!.record).toBeInstanceOf(Function);
    expect(recorder!.recordDelta).toBeInstanceOf(Function);
    expect(recorder!.flush).toBeInstanceOf(Function);
  });
});

describe("CursorEventRecorder", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-recorder-test-"));
  });

  it("flush writes nothing when nothing was recorded", async () => {
    const recorder = createCursorEventRecorder("exec-empty", dir)!;
    await recorder.flush();
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("sequences both channels in ONE file in arrival order, each line naming its channel", async () => {
    const recorder = createCursorEventRecorder("exec-order", dir)!;

    recorder.record(streamEvent("tool_call", { subtype: "started", call_id: "c1" }));
    recorder.recordDelta(delta("shell-output-delta", { event: { chunk: "hook probe\n" } }));
    recorder.recordDelta(delta("tool-call-completed", { toolCall: { id: "c1" } }));
    recorder.record(streamEvent("tool_call", { subtype: "completed", call_id: "c1" }));
    recorder.record(streamEvent("result"));

    await recorder.flush();
    const lines = await readLines(dir, "exec-order");

    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(lines.map((l) => `${l.channel}:${l.type}`)).toEqual([
      "stream:tool_call",
      "delta:shell-output-delta",
      "delta:tool-call-completed",
      "stream:tool_call",
      "stream:result",
    ]);
    for (const line of lines) expect(line.capturedAt).toBeTruthy();
  });

  it("a stream line carries the event's agent and run ids and the whole event; a delta line the whole update", async () => {
    const recorder = createCursorEventRecorder("exec-shape", dir)!;

    recorder.record(streamEvent("assistant", { content: "hi" }));
    recorder.recordDelta(delta("turn-ended", { usage: { inputTokens: 12 } }));

    await recorder.flush();
    const [stream, deltaLine] = await readLines(dir, "exec-shape");

    expect(stream!.agent_id).toBe("agent-1");
    expect(stream!.run_id).toBe("run-1");
    expect(stream!.event).toMatchObject({ type: "assistant", content: "hi" });
    expect(stream!.update).toBeUndefined();

    expect(deltaLine!.update).toEqual({ type: "turn-ended", usage: { inputTokens: 12 } });
    expect(deltaLine!.event).toBeUndefined();
    expect(deltaLine!.agent_id).toBeUndefined();
  });

  it("names the file by execution id and creates the directory if it does not exist", async () => {
    const nested = join(dir, "nested", "deep");
    const recorder = createCursorEventRecorder("exec-mkdir", nested)!;

    recorder.record(streamEvent("system"));
    await recorder.flush();

    expect(await readdir(nested)).toEqual(["exec-mkdir.cursor-events.jsonl"]);
  });

  it("records a cyclic payload as a serialization marker instead of failing the flush", async () => {
    const recorder = createCursorEventRecorder("exec-cyclic", dir)!;

    const cyclic: Record<string, unknown> = { type: "custom", a: 1 };
    cyclic.self = cyclic;
    recorder.record(cyclic as unknown as SDKMessage);

    await recorder.flush();
    const [line] = await readLines(dir, "exec-cyclic");

    expect(line!.type).toBe("custom");
    expect(line!.event).toMatchObject({ _serializationError: true });
    expect((line!.event as { keys: string[] }).keys).toContain("a");
  });
});
