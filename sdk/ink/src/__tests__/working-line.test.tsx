// Pins what the terminal says while a turn works and when it ends (INK-10):
// the working line's words from the shared derivation (what it does now, for
// how long, and the states that take the phrase over), its clock moving on a
// fake clock, the line a completed turn leaves, and thinking drawn as one
// quiet line while it streams and once it settled.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import type { ThreadMessage } from "@stigmer/react-core";
import { samples, sampleInstant } from "@stigmer/react-sdk/test";
import { WorkingLine } from "../components/WorkingLine.js";
import { MessageEntry, THINKING_PREVIEW_LENGTH, thinkingPreview } from "../components/MessageEntry.js";
import { SLOW_PHRASE, STOPPING_PHRASE, formatElapsed, workedWords, workingWords } from "../working.js";
import { turnOf, waitingToolUse } from "./session-events.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A turn running a shell command, started at the sample instant. */
function runningCommand() {
  return turnOf([
    samples.userMessageEvent("Fix the flaky test", { processedAt: sampleInstant(0) }),
    samples.runStatusEvent("running", { processedAt: sampleInstant(0) }),
    samples.toolUseEvent("execute", { command: "npm test" }, { processedAt: sampleInstant(2_000) }),
  ]);
}

describe("INK-10 thinking shows, and a working indicator counts the time", () => {
  it("writes a span of time in seconds, minutes and hours", () => {
    expect([0, 999, 42_000, 59_999, 60_000, 72_000, 3_599_000, 3_600_000, 3_780_000, -5].map(formatElapsed)).toEqual([
      "0s",
      "0s",
      "42s",
      "59s",
      "1m 0s",
      "1m 12s",
      "59m 59s",
      "1h 0m",
      "1h 3m",
      "0s",
    ]);
  });

  it("says what the turn does now and for how long, from the shared derivation", () => {
    expect(workingWords(runningCommand(), Date.parse(sampleInstant(72_000)))).toEqual({ phrase: "Running a command", elapsed: "1m 12s", waiting: false });
  });

  it("lets stopping, then waiting on the person, then slowness take the phrase over", () => {
    const now = Date.parse(sampleInstant(5_000));
    const asking = { ...runningCommand(), asks: [waitingToolUse("execute")] };
    expect(workingWords(asking, now, { isStopping: true, isSlow: true })).toEqual({ phrase: STOPPING_PHRASE, elapsed: "5s", waiting: false });
    expect(workingWords(asking, now, { isSlow: true })).toMatchObject({ phrase: "Waiting for you", waiting: true });
    expect(workingWords(runningCommand(), now, { isSlow: true }).phrase).toBe(SLOW_PHRASE);
    expect(workingWords(null, now)).toEqual({ phrase: "Starting", elapsed: "", waiting: false });
    expect(workingWords(null, now, { isStopping: true }).phrase).toBe(STOPPING_PHRASE);
  });

  it("counts no time for a turn the log stamps no start for", () => {
    const unstamped = { ...samples.turn({ phase: "running", reply: "" }), userMessage: undefined, items: [], status: undefined };
    expect(workingWords(unstamped, Date.now()).elapsed).toBe("");
  });

  it("draws a spinner, the phrase and the time, and the time moves with the clock", async () => {
    vi.useFakeTimers({ now: Date.parse(sampleInstant(72_000)) });
    const { lastFrame } = render(<WorkingLine turn={runningCommand()} hint="Esc to stop" />);
    expect(lastFrame()).toMatch(/^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Running a command · 1m 12s · Esc to stop$/);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lastFrame()).toContain("Running a command · 1m 15s");
  });

  it("stops the spinner while the turn waits on the person", () => {
    vi.useFakeTimers({ now: Date.parse(sampleInstant(10_000)) });
    const asking = { ...runningCommand(), asks: [waitingToolUse("execute")] };
    expect(render(<WorkingLine turn={asking} />).lastFrame()).toBe(" ○ Waiting for you · 10s");
    expect(render(<WorkingLine turn={null} />).lastFrame()).toMatch(/^ . Starting$/);
  });

  it("leaves 'Worked for' under a completed turn, and nothing under a failed one or one under a second", () => {
    const events = [
      samples.userMessageEvent("Fix it", { processedAt: sampleInstant(0) }),
      samples.runStatusEvent("running", { processedAt: sampleInstant(0) }),
    ];
    expect(workedWords(turnOf([...events, samples.runStatusEvent("completed", { processedAt: sampleInstant(72_000) })]))).toBe("Worked for 1m 12s");
    expect(workedWords(turnOf([...events, samples.runStatusEvent("failed", { processedAt: sampleInstant(72_000) })]))).toBe("");
    expect(workedWords(turnOf([...events, samples.runStatusEvent("completed", { processedAt: sampleInstant(999) })]))).toBe("");
    expect(workedWords(turnOf([...events, samples.runStatusEvent("completed", { processedAt: sampleInstant(1_000) })]))).toBe("Worked for 1s");
    expect(workedWords(turnOf(events))).toBe("");
  });

  it("draws thinking as one quiet line: 'Thinking' while it streams, 'Thought' once settled, its start cut to the preview", () => {
    const long = `${"The test is flaky because rounding depends on the order of the lines. ".repeat(2)}I'll run the suite first.`;
    const live: ThreadMessage = { kind: "thinking", id: "t", text: long, live: true, processedAt: "" };
    const preview = thinkingPreview(long);
    expect(preview.length).toBeLessThanOrEqual(THINKING_PREVIEW_LENGTH + 1);
    expect(preview.endsWith("…")).toBe(true);
    expect(render(<MessageEntry message={live} />).lastFrame()).toBe(` ✻ Thinking ${preview}`);
    expect(render(<MessageEntry message={{ ...live, live: false }} />).lastFrame()).toBe(` ✻ Thought ${preview}`);
    expect(render(<MessageEntry message={{ ...live, text: "" }} />).lastFrame()).toBe(" ✻ Thinking");
    expect(thinkingPreview("  short \n thought ")).toBe("short thought");
  });

  it("draws thinking's whole text when expanded", () => {
    const message: ThreadMessage = { kind: "thinking", id: "t", text: "First line.\nSecond line.", live: false, processedAt: "" };
    expect(render(<MessageEntry message={message} expanded />).lastFrame()).toBe(" ✻ Thought\n   First line.\n   Second line.");
  });
});
