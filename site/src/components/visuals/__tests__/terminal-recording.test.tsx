/**
 * `<TerminalRecording>`: the terminal kit's recording by its name, drawn as
 * the terminal's text in a `<pre>` labelled with its alt text; played frame
 * by frame on the recording's own times once it is in view, paused and
 * replayed from its button; showing the last frame, with nothing to play,
 * under reduced motion; refusing a name the kit does not record or blank
 * alt text, so the build fails on the page that asked.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recording } from "@/lib/recordings";
import { plainText } from "@/lib/sgr";
import { TerminalRecording } from "../TerminalRecording";

const ALT = "stigmer run asks before it runs git log, then answers";
const HELD = recording("run-approval");

/** The text the `<pre>` shows now. */
function shown(): string {
  return screen.getByRole("img", { name: ALT }).textContent ?? "";
}

/** Each line of the frame at `index`, its last rows, joined as the `<pre>`'s text joins them. */
function frameText(index: number): string {
  return plainText(HELD.frames[index]!.text).split("\n").slice(-HELD.rows).join("");
}

let observed: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  observed = undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }));
  window.matchMedia = globalThis.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TerminalRecording", () => {
  it("shows the typed command, then plays the frames on their own times once scrolled into view", () => {
    render(<TerminalRecording name="run-approval" alt={ALT} />);
    expect(shown()).toBe(frameText(0));
    act(() => vi.advanceTimersByTime(60_000));
    expect(shown()).toBe(frameText(0));
    act(() => observed?.([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(HELD.frames[1]!.at - 1));
    expect(shown()).toBe(frameText(0));
    act(() => vi.advanceTimersByTime(1));
    expect(shown()).toBe(frameText(1));
  });

  it("pauses, plays on, and replays from the start once ended", () => {
    render(<TerminalRecording name="run-approval" alt={ALT} />);
    act(() => observed?.([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(HELD.frames[1]!.at));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(shown()).toBe(frameText(1));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < HELD.frames.length; i += 1) act(() => vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(frameText(HELD.frames.length - 1));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(shown()).toBe(frameText(0));
  });

  it("shows the last frame and offers nothing to play under reduced motion", () => {
    reduced = true;
    render(<TerminalRecording name="run-approval" alt={ALT} />);
    expect(shown()).toBe(frameText(HELD.frames.length - 1));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("refuses a recording the kit does not hold, and blank alt text", () => {
    expect(() => render(<TerminalRecording name="run-denial" alt={ALT} />)).toThrow(/no terminal recording named "run-denial"/);
    expect(() => render(<TerminalRecording name="run-approval" alt=" " />)).toThrow(/alt text is required/);
  });
});
