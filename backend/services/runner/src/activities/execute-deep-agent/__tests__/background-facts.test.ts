/**
 * The registry's reports as transcript facts (`../background-facts.ts`), on a
 * fake clock: a start at once; output coalesced per command to the streaming
 * floor (a fragment at once after a quiet spell, what follows within the
 * floor at its end); an end after the command's waiting output, with how it
 * ended and who stopped it, and a persist asked for; each ending in its own
 * words.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptEvent } from "../../../harness/transcript/events.js";
import type { BackgroundCommand } from "../../../shared/shell/background-commands.js";
import type { CommandResult } from "../../../shared/shell/run-command.js";
import { backgroundFacts, endedFact } from "../background-facts.js";

const FLOOR_MS = 500;

function result(init: Partial<CommandResult> = {}): CommandResult {
  return { stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false, truncated: false, ...init };
}

function command(init: Partial<BackgroundCommand> = {}): BackgroundCommand {
  return { id: "bg-1", command: "npm test", timeoutSeconds: 60, result: result(), stoppedBy: undefined, ...init };
}

function sinkDouble() {
  const facts: TranscriptEvent[] = [];
  const requestPersist = vi.fn(async () => undefined);
  return { facts, requestPersist, sink: { transcript: { apply: (event: TranscriptEvent) => void facts.push(event) }, requestPersist } };
}

describe("backgroundFacts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports a start at once, coalesces output to the floor, and ends after the waiting output, asking for a persist", async () => {
    const { facts, requestPersist, sink } = sinkDouble();
    const listeners = backgroundFacts(sink as never, FLOOR_MS);
    listeners.onStarted!(command({ result: undefined, timeoutSeconds: 3300 }));
    expect(facts).toEqual([{ kind: "background_command_started", callId: "bg-1", timeoutSeconds: 3300 }]);

    listeners.onOutput!("bg-1", "a");
    listeners.onOutput!("bg-1", "b");
    listeners.onOutput!("bg-1", "c");
    listeners.onOutput!("bg-2", "other");
    expect(facts.slice(1), "the first fragment of each command goes at once").toEqual([
      { kind: "background_output_delta", callId: "bg-1", delta: "a" },
      { kind: "background_output_delta", callId: "bg-2", delta: "other" },
    ]);
    await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
    expect(facts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(facts.at(-1), "what came within the floor, together, at its end").toEqual({ kind: "background_output_delta", callId: "bg-1", delta: "bc" });

    listeners.onOutput!("bg-1", "d");
    listeners.onEnded!(command({ result: result({ stdout: "abcd", exitCode: 1 }) }));
    expect(facts.slice(-2)).toEqual([
      { kind: "background_output_delta", callId: "bg-1", delta: "d" },
      { kind: "background_command_ended", callId: "bg-1", ending: "exited", exitCode: 1, output: expect.stringContaining("abcd") },
    ]);
    expect(requestPersist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * FLOOR_MS);
    expect(facts.filter((f) => f.kind === "background_output_delta" && f.callId === "bg-1").map((f) => (f as { delta: string }).delta)).toEqual(["a", "bc", "d"]);
  });

  it("says each ending in the log's words, who stopped it, and the agent's stop call", () => {
    expect(endedFact(command({ result: result({ timedOut: true, exitCode: null, stdout: "slow" }) }))).toMatchObject({ ending: "timed_out", output: expect.stringContaining("slow") });
    expect(endedFact(command({ result: result({ spawnError: "spawn /bin/sh ENOENT", exitCode: null }) }))).toEqual({
      kind: "background_command_ended",
      callId: "bg-1",
      ending: "failed_to_start",
      output: "spawn /bin/sh ENOENT",
    });
    const aborted = result({ aborted: true, exitCode: null });
    expect(endedFact(command({ result: aborted, stoppedBy: { by: "agent", callId: "stop-1" } }))).toMatchObject({ ending: "stopped", stoppedBy: "agent", stoppedByCallId: "stop-1" });
    expect(endedFact(command({ result: aborted, stoppedBy: { by: "agent", callId: "" } })).stoppedByCallId).toBeUndefined();
    expect(endedFact(command({ result: aborted, stoppedBy: { by: "person" } }))).toMatchObject({ stoppedBy: "person" });
    expect(endedFact(command({ result: aborted, stoppedBy: { by: "approval" } }))).toMatchObject({ stoppedBy: "approval" });
    expect(endedFact(command({ result: aborted, stoppedBy: undefined })), "an abort no one named is the invocation's end").toMatchObject({ stoppedBy: "turn" });
  });
});
