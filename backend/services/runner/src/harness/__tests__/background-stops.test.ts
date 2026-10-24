/**
 * The background stop pump (`../background-stops.ts`) on a fake clock: it
 * reads the run's stop requests only while a command runs, every interval;
 * a request hands its command's call id to every listener once, matched by
 * the tool use id the emitter derives (a hashed call id included); a request
 * for a command this invocation does not run matches nothing; a failed read
 * is logged once and tried again; nothing is read or handed on once it is
 * stopped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { BACKGROUND_STOP_POLL_MS, BackgroundStopPump } from "../background-stops.js";
import { toolUseEventId } from "../events/ids.js";

const RUN = "run_01jz8k3q9w4e5r6t7y8u9i0o1p";

function stopRequest(callId: string): SessionEvent {
  return create(SessionEventSchema, {
    runId: RUN,
    event: { case: "stigmerBackgroundCommandStopRequested", value: { id: `sevt_bs_${callId}`, toolUseId: toolUseEventId(RUN, callId) } },
  });
}

describe("BackgroundStopPump", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads nothing while no command runs, and every interval while one does", async () => {
    const read = vi.fn(async (): Promise<SessionEvent[]> => []);
    const pump = new BackgroundStopPump({ runId: RUN, read });
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_STOP_POLL_MS);
    expect(read).not.toHaveBeenCalled();

    pump.observe({ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(BACKGROUND_STOP_POLL_MS - 1);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * BACKGROUND_STOP_POLL_MS);
    expect(read).toHaveBeenCalledTimes(3);

    pump.observe({ kind: "background_command_ended", callId: "bg-1", ending: "exited", exitCode: 0, output: "" });
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_STOP_POLL_MS);
    expect(read, "no command runs: no read").toHaveBeenCalledTimes(3);
    pump.stop();
  });

  it("hands each stopped command's call id to every listener once, a hashed call id included", async () => {
    const hashed = "call/with spaces";
    let requests: SessionEvent[] = [];
    const pump = new BackgroundStopPump({ runId: RUN, read: async () => requests });
    const heard: string[] = [];
    const also: string[] = [];
    pump.onStop((callId) => heard.push(callId));
    const unsubscribe = pump.onStop((callId) => also.push(callId));
    pump.observe({ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 60 });
    pump.observe({ kind: "background_command_started", callId: hashed, timeoutSeconds: 60 });
    pump.observe({ kind: "background_command_started", callId: "bg-3", timeoutSeconds: 60 });

    requests = [stopRequest("bg-1"), stopRequest(hashed), stopRequest("bg-earlier-invocation")];
    await vi.advanceTimersByTimeAsync(BACKGROUND_STOP_POLL_MS);
    expect(heard).toEqual(["bg-1", hashed]);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(3 * BACKGROUND_STOP_POLL_MS);
    expect(heard, "each once, though the log keeps the request").toEqual(["bg-1", hashed]);
    expect(also).toEqual(["bg-1", hashed]);

    // A start re-reported for a command already handed on is not polled for again.
    pump.observe({ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 60 });
    requests = [...requests, stopRequest("bg-3")];
    await vi.advanceTimersByTimeAsync(BACKGROUND_STOP_POLL_MS);
    expect(heard).toEqual(["bg-1", hashed, "bg-3"]);
    pump.stop();
  });

  it("logs a failed read once and tries again; a failing listener breaks neither the pump nor the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = 2;
    const read = vi.fn(async (): Promise<SessionEvent[]> => {
      if (fail-- > 0) throw new Error("unavailable");
      return [stopRequest("bg-1")];
    });
    const pump = new BackgroundStopPump({ runId: RUN, read, intervalMs: 100 });
    const heard: string[] = [];
    pump.onStop(() => {
      throw new Error("listener broke");
    });
    pump.onStop((callId) => heard.push(callId));
    pump.observe({ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(heard).toEqual(["bg-1"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("a stop listener failed"));
    pump.stop();
    warn.mockRestore();
    error.mockRestore();
  });

  it("reads nothing and hands nothing on once stopped, a read in flight included", async () => {
    let answer: ((events: SessionEvent[]) => void) | undefined;
    const read = vi.fn(() => new Promise<SessionEvent[]>((resolve) => (answer = resolve)));
    const pump = new BackgroundStopPump({ runId: RUN, read });
    const heard: string[] = [];
    pump.onStop((callId) => heard.push(callId));
    pump.observe({ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(BACKGROUND_STOP_POLL_MS);
    expect(read).toHaveBeenCalledTimes(1);
    pump.stop();
    answer!([stopRequest("bg-1")]);
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_STOP_POLL_MS);
    expect(heard).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    pump.observe({ kind: "background_command_started", callId: "bg-2", timeoutSeconds: 60 });
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_STOP_POLL_MS);
    expect(read, "a start after the stop schedules nothing").toHaveBeenCalledTimes(1);
  });
});
