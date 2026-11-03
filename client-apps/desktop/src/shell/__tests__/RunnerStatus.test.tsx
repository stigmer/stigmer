// ---------------------------------------------------------------------------
// RunnerStatus — the sidebar row that says whether agents run on this computer
//
// The row shows the runner's state in words, offers Restart when the runner
// stopped and Try again, with the host's reason, when it could not start,
// and calls the runner's restart once per press, disabled while it runs.
// The runner's context is stubbed; the state itself is pinned in
// hooks/__tests__/runner-state.test.ts and useEmbeddedRunner.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunnerState } from "../../hooks/runner-state";

const runner = vi.hoisted(() => ({
  state: { kind: "idle" } as RunnerState,
  restart: vi.fn<() => Promise<void>>(),
}));
vi.mock("../../hooks/EmbeddedRunnerContext", () => ({
  useRunner: () => ({ state: runner.state, restart: runner.restart }),
}));

import { RunnerStatus } from "../RunnerStatus";

beforeEach(() => {
  runner.state = { kind: "idle" };
  runner.restart.mockReset();
  runner.restart.mockResolvedValue(undefined);
});

describe("DSK-05 RunnerStatus", () => {
  it("says the runner's state and offers nothing while all is well", () => {
    runner.state = { kind: "ready", conversations: 2 };
    render(<RunnerStatus />);

    expect(screen.getByRole("status").textContent).toBe("Agents working on 2 conversations");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Restart when the runner stopped, and restarts it once", async () => {
    runner.state = { kind: "stopped" };
    render(<RunnerStatus />);
    expect(screen.getByRole("status").textContent).toBe("Agents stopped");

    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(runner.restart).toHaveBeenCalledTimes(1);
  });

  it("shows why the runner could not start, and offers Try again", async () => {
    runner.state = { kind: "failed", reason: "node binary `/x/node` was not found" };
    render(<RunnerStatus />);

    expect(screen.getByRole("status").textContent).toBe("Agents couldn't start");
    expect(screen.getByText("node binary `/x/node` was not found")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(runner.restart).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a restart runs, so one press starts one runner", async () => {
    let finish: () => void = () => {};
    runner.restart.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    runner.state = { kind: "stopped" };
    render(<RunnerStatus />);

    const button = screen.getByRole("button", { name: "Restart" });
    await userEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      finish();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
