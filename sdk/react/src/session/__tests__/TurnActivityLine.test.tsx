/**
 * Proves the working turn's line (../TurnActivityLine.tsx) from the first
 * second: what the turn is doing, for how long, and how far it has got (to-dos
 * done of total and the item in progress with a list; steps settled without
 * one), with Stop on it where the person can stop; and that a person being
 * awaited takes the line over in the solid fill, still with Stop, while a
 * reader who cannot answer reads that it waits for an answer. Drawn over
 * the scenario catalogue's busy and approval states at its clock.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SCENARIO_CLOCK, conversationOf, samples, scenarios } from "../../test";
import { TurnActivityLine } from "../TurnActivityLine";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function busyTurn() {
  return conversationOf(scenarios.busy).activeTurn!;
}

describe("TurnActivityLine", () => {
  it("KIT-05 says what the turn is doing, for how long, and how far it has got, from its to-do list", () => {
    render(<TurnActivityLine turn={busyTurn()} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Running a command");
    expect(line.textContent).toContain("1 min 30 s");
    expect(line.textContent).toContain("2 of 5 done");
    expect(line.textContent).toContain("now: Apply the same rule to credit notes");
  });

  it("KIT-05 counts the steps settled when the agent keeps no list, and says so from the first second", () => {
    vi.setSystemTime(new Date(Date.parse(samples.turn().userMessage!.processedAt) + 1_000));
    const turn = samples.turn({
      phase: "running",
      reply: "",
      tools: [
        { name: "read_file", input: { path: "a.ts" }, result: "ok" },
        { name: "execute", input: { command: "npm test" } },
      ],
    });
    render(<TurnActivityLine turn={turn} />);
    expect(screen.getByRole("status").textContent).toBe("Running a command1 s · 1 step");
  });

  it("says no step count before a step has settled", () => {
    vi.setSystemTime(new Date(Date.parse(samples.turn().userMessage!.processedAt)));
    const turn = samples.turn({ phase: "running", reply: "", tools: [{ name: "execute", input: { command: "npm test" } }] });
    render(<TurnActivityLine turn={turn} />);
    expect(screen.getByRole("status").textContent).toBe("Running a command0 s");
  });

  it("ticks the time on, once a second", () => {
    render(<TurnActivityLine turn={busyTurn()} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("status").textContent).toContain("2 min");
  });

  it("offers Stop where the person can stop, and says it is stopping", () => {
    const onStop = vi.fn();
    const { rerender } = render(<TurnActivityLine turn={busyTurn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();

    rerender(<TurnActivityLine turn={busyTurn()} onStop={onStop} isStopping />);
    expect((screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<TurnActivityLine turn={busyTurn()} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("KIT-08 takes the line over in the solid fill while an approval waits, with Stop still on it", () => {
    const waiting = conversationOf(scenarios.approval).activeTurn!;
    render(<TurnActivityLine turn={waiting} onStop={() => {}} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Waiting for you");
    expect(line.className).toContain("stg:bg-foreground");
    expect(line.className).toContain("stg:text-background");
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("tells a reader who cannot answer that the turn waits for an answer, in the plain fill", () => {
    const waiting = conversationOf(scenarios.approval).activeTurn!;
    render(<TurnActivityLine turn={waiting} decides={false} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Waiting for an answer");
    expect(line.textContent).not.toContain("Waiting for you");
    expect(line.className).not.toContain("stg:bg-foreground");
  });
});
