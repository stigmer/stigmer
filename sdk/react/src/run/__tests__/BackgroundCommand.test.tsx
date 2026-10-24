// Pins the console's view of a command the agent runs in the background,
// read from the fold's `ToolUse.background`: the start's row is the
// command's row (a "Background" chip, the command's state and clock, the
// running look and forced-open body while it runs though the call returned,
// its own output rather than the start's answer, how it ended in words);
// Stop on the row while it runs and a handler is wired
// (BackgroundCommandContext), "Stopping…" from the click and across a reload
// (the log's stop request), and a failed stop shown on the row; the thread's
// tail line while the turn waits only on such commands, with Stop for a lone
// one; the agent's stop call read from the command's end; the approval
// card's line for a background start; and the stop hook's call.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ToolUse } from "@stigmer/client";
import { ToolCallItem } from "../ToolCallItem";
import { BackgroundCommandContext, type BackgroundCommandContextValue } from "../BackgroundCommandContext";
import { backgroundStatusLabel } from "../BackgroundCommandStatus";
import { LivenessStatusLine, backgroundWaitLabel } from "../LivenessStatusLine";
import { ApprovalCardBody } from "../ApprovalCard";
import { buildThreadItems } from "../MessageThread";
import { toolUse, TOOL_STARTED_AT } from "./__fixtures__/fold-values";

afterEach(cleanup);

const STARTED = "Started in the background (id bg-1). Output is going to /large_tool_results/background-bg-1.log; you will be told when it ends. Do not poll it.";

function backgroundStart(background: Parameters<typeof toolUse>[0]["background"] = {}, extra: Partial<Parameters<typeof toolUse>[0]> = {}): ToolUse {
  return toolUse({
    name: "execute",
    id: "run_1.bg-1",
    input: { command: "npm run dev", background: true },
    result: STARTED,
    background,
    ...extra,
  });
}

function stopping(onStop: BackgroundCommandContextValue["onStop"] = () => {}, extra: Partial<BackgroundCommandContextValue> = {}): BackgroundCommandContextValue {
  return { onStop, stoppingIds: new Set(), errorsByToolUseId: new Map(), ...extra };
}

function rowOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-cursor-target="tool-call-row"]') as HTMLElement;
}

describe("a background command's row", () => {
  it("runs live though its call returned: chip, state with a clock, open body with its own output, never the start's answer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(TOOL_STARTED_AT) + 125_000));
    try {
      const { container } = render(<ToolCallItem toolUse={backgroundStart({ liveOutput: "ready on :3000\n" })} />);
      expect(screen.getByText("Background")).toBeTruthy();
      expect(container.querySelector('[data-cursor-target="background-command-status"]')?.textContent).toBe("Running in the background · 2m 5s");
      expect(rowOf(container).querySelector(".stgm-shimmer-label"), "the running sweep").not.toBeNull();
      expect(container.textContent).toContain("ready on :3000");
      expect(container.textContent).not.toContain("Started in the background");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says how it ended, with what it printed, and settles like a finished shell", () => {
    const { container } = render(
      <ToolCallItem toolUse={backgroundStart({ state: "exited", exitCode: 1, output: "1 failed\nExit code: 1", endedAt: TOOL_STARTED_AT })} />,
    );
    expect(container.querySelector('[data-cursor-target="background-command-status"]')?.textContent).toBe("Exited · code 1");
    expect(container.textContent).toContain("1 failed");
    expect(container.textContent).not.toContain("Started in the background");
    expect(screen.queryByRole("button", { name: "Stop" }), "nothing to stop once it ended").toBeNull();
  });

  it.each([
    [{ state: "exited", exitCode: 0 }, "Exited · code 0"],
    [{ state: "timed_out" }, "Timed out"],
    [{ state: "failed_to_start" }, "Failed to start"],
    [{ state: "stopped", stoppedBy: "person" }, "Stopped by a person"],
    [{ state: "stopped", stoppedBy: "agent" }, "Stopped by the agent"],
    [{ state: "stopped", stoppedBy: "approval" }, "Stopped when the turn paused for approval"],
    [{ state: "stopped", stoppedBy: "turn" }, "Stopped with the turn"],
    [{ state: "running" }, "Running in the background"],
  ] as const)("words %j as %s", (background, label) => {
    expect(backgroundStatusLabel(backgroundStart(background).background!)).toBe(label);
  });

  it("offers Stop while it runs and a handler is wired, which stops this command alone without toggling the row", () => {
    const onStop = vi.fn();
    const { container } = render(
      <BackgroundCommandContext.Provider value={stopping(onStop)}>
        <ToolCallItem toolUse={backgroundStart()} />
      </BackgroundCommandContext.Provider>,
    );
    const header = rowOf(container).querySelector('[role="button"]');
    const expandedBefore = header?.getAttribute("aria-expanded");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledWith("run_1.bg-1");
    expect(header?.getAttribute("aria-expanded"), "the click stays on the button").toBe(expandedBefore);
  });

  it("shows no Stop without a handler (a viewer who may not act)", () => {
    render(<ToolCallItem toolUse={backgroundStart()} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("says Stopping… while the request is in flight, and after it from the log's stop request", () => {
    const { unmount } = render(
      <BackgroundCommandContext.Provider value={stopping(() => {}, { stoppingIds: new Set(["run_1.bg-1"]) })}>
        <ToolCallItem toolUse={backgroundStart()} />
      </BackgroundCommandContext.Provider>,
    );
    expect((screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(
      <BackgroundCommandContext.Provider value={stopping()}>
        <ToolCallItem toolUse={backgroundStart({ stopRequested: true })} />
      </BackgroundCommandContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeTruthy();
  });

  it("shows a failed stop on the row", () => {
    render(
      <BackgroundCommandContext.Provider value={stopping(() => {}, { errorsByToolUseId: new Map([["run_1.bg-1", new Error("the turn is not working")]]) })}>
        <ToolCallItem toolUse={backgroundStart()} />
      </BackgroundCommandContext.Provider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t stop the command — the turn is not working");
  });
});

describe("the agent's stop of a background command", () => {
  it("reads as what it stopped, from the command's end that names the call", () => {
    const stop = toolUse({
      name: "stop_background_command",
      id: "run_1.stop-1",
      input: { id: "bg-1" },
      result: "listening\n[Stopped at your request; its processes were stopped]",
      stoppedBackground: { toolUseId: "run_1.bg-1", input: { command: "npm run dev", background: true } },
    });
    const { container } = render(<ToolCallItem toolUse={stop} />);
    expect(container.textContent).toContain("Stopped");
    expect(container.textContent).toContain("npm run dev");
  });

  it("says it is stopping while the call runs", () => {
    const stop = toolUse({ name: "stop_background_command", id: "run_1.stop-1", input: { id: "bg-1" }, state: "running" });
    const { container } = render(<ToolCallItem toolUse={stop} />);
    expect(container.textContent).toContain("Stopping a command");
  });

  it("says the command had already ended when no end names it", () => {
    const stop = toolUse({ name: "stop_background_command", id: "run_1.stop-1", input: { id: "bg-1" }, result: "It had already ended." });
    const { container } = render(<ToolCallItem toolUse={stop} />);
    expect(container.textContent).toContain("The command had already ended");
  });
});

describe("the thread's tail line while the turn waits on background commands", () => {
  it("names the oldest command, how many more, and its time", () => {
    const one = backgroundStart();
    const two = backgroundStart({}, { id: "run_1.bg-2", input: { command: "npm test", background: true } });
    expect(backgroundWaitLabel([one], 125_000)).toBe("Waiting for `npm run dev` · 2m 5s");
    expect(backgroundWaitLabel([one, two], null)).toBe("Waiting for `npm run dev` and 1 more");
  });

  it("offers Stop for a lone command, and none for several", () => {
    const onStop = vi.fn();
    const { unmount } = render(
      <BackgroundCommandContext.Provider value={stopping(onStop)}>
        <LivenessStatusLine waitingOn={[backgroundStart()]} />
      </BackgroundCommandContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledWith("run_1.bg-1");
    unmount();
    render(
      <BackgroundCommandContext.Provider value={stopping(onStop)}>
        <LivenessStatusLine waitingOn={[backgroundStart(), backgroundStart({}, { id: "run_1.bg-2" })]} />
      </BackgroundCommandContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("and 1 more");
  });

  it("reads Working… with no command to wait on", () => {
    render(<LivenessStatusLine waitingOn={[]} />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Working…");
  });

  it("is built from the live turn: only when its liveness names no wait on the model and a command runs", () => {
    const running = backgroundStart();
    const turn = (awaitingModelMs: number | undefined) => ({
      runId: "run_1",
      userMessage: { id: "u1", text: "go", processedAt: TOOL_STARTED_AT },
      items: [{ kind: "message" as const, id: "run_1.root.m0", text: "Waiting for it.", live: false, processedAt: TOOL_STARTED_AT }, running],
      status: { phase: "running" as const, stopCause: "", error: "", processedAt: TOOL_STARTED_AT },
      ended: false,
      asks: [],
      todos: [],
      structuredOutput: undefined,
      memory: undefined,
      fileReview: [],
      errors: [],
      answer: "Waiting for it.",
      liveness: { operations: [], awaitingModelMs },
    });
    const liveness = (awaitingModelMs: number | undefined) =>
      buildThreadItems([turn(awaitingModelMs)], []).find((item) => item.kind === "liveness");
    const held = liveness(undefined);
    expect(held?.kind === "liveness" && held.waitingOn.map((t) => t.id)).toEqual(["run_1.bg-1"]);
    const inThread = buildThreadItems(
      [
        {
          ...turn(undefined),
          items: [
            toolUse({
              name: "task",
              id: "run_1.task-1",
              result: "",
              state: "running",
              thread: { id: "run_1.task-1", agentName: "helper", input: "", reply: "", state: "completed", items: [backgroundStart({}, { id: "run_1.sub-bg" })] },
            }),
          ],
        },
      ],
      [],
    ).find((item) => item.kind === "liveness");
    expect(inThread, "a sub-agent that still runs shows its own live signal: no tail line").toBeUndefined();
    const subTurn = {
      ...turn(undefined),
      items: [
        toolUse({
          name: "task",
          id: "run_1.task-2",
          result: "done",
          thread: { id: "run_1.task-2", agentName: "helper", input: "", reply: "done", state: "completed", items: [backgroundStart({}, { id: "run_1.sub-bg-2" })] },
        }),
      ],
    };
    const fromThread = buildThreadItems([subTurn], []).find((item) => item.kind === "liveness");
    expect(fromThread?.kind === "liveness" && fromThread.waitingOn.map((t) => t.id), "a sub-agent's command counts").toEqual(["run_1.sub-bg-2"]);
    const thinking = liveness(4_000);
    expect(thinking?.kind === "liveness" && thinking.waitingOn, "the model is working: the line stays Working…").toEqual([]);
  });
});

describe("the approval card for a background start", () => {
  it("says it runs in the background and stops at the turn's end or its next pause", () => {
    const ask = { argsPreview: JSON.stringify({ command: "npm run dev", background: true }) };
    render(<ApprovalCardBody toolUse={toolUse({ name: "execute", input: { command: "npm run dev", background: true }, ask })} onAnswer={() => {}} />);
    expect(screen.getByText(/Runs in the background while the agent works; it stops when the turn ends or pauses for approval\./)).toBeTruthy();
  });

  it("says nothing of it for a foreground command", () => {
    const ask = { argsPreview: JSON.stringify({ command: "npm test" }) };
    render(<ApprovalCardBody toolUse={toolUse({ name: "execute", input: { command: "npm test" }, ask })} onAnswer={() => {}} />);
    expect(screen.queryByText(/Runs in the background/)).toBeNull();
  });
});
