// Command-level contract for the `stigmer runs` group: each verb hands the run
// id and its flags to the right resource call and prints the success line the
// group promises on stderr; `cancel` names the turns it stopped, and says so when the run had already ended; `approve` passes an
// absent --tool-call as empty and reports the answer; `logs`, `trace` and
// `scores` pass their flags through. The backend and the run resources are
// replaced at their module seams (the commands import them lazily); the
// program, the flag parsing and the result rendering are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The client the commands hand to the resources; identity is what is asserted.
const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const control = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  terminateRun: vi.fn(),
  pauseRun: vi.fn(),
  resumeRun: vi.fn(),
}));
vi.mock("../../resources/run-control.js", () => control);

const approve = vi.hoisted(() => ({ approveAgentToolCall: vi.fn() }));
vi.mock("../../resources/run-approve.js", () => approve);

const logs = vi.hoisted(() => ({ streamRunLogs: vi.fn() }));
vi.mock("../../resources/run-logs.js", () => logs);

const trace = vi.hoisted(() => ({ traceRun: vi.fn() }));
vi.mock("../../resources/run-trace.js", () => trace);

const scores = vi.hoisted(() => ({ showRunScores: vi.fn() }));
vi.mock("../../resources/run-scores.js", () => scores);

let stderr: string[];

/** Runs `stigmer runs ...`, returning what it wrote to stderr. */
async function runs(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "runs", ...args]);
  return stderr.join("");
}

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  control.cancelRun.mockResolvedValue({ phase: "cancelled", wasAlreadyTerminal: false, stoppedRunIds: ["run_1", "run_2"] });
  control.terminateRun.mockResolvedValue({ phase: "terminated" });
  control.pauseRun.mockResolvedValue({ phase: "paused" });
  control.resumeRun.mockResolvedValue({ phase: "running" });
  approve.approveAgentToolCall.mockResolvedValue({ toolUseId: "run_1.c1", toolName: "delete", answer: "deny" });
  logs.streamRunLogs.mockResolvedValue(undefined);
  trace.traceRun.mockResolvedValue(undefined);
  scores.showRunScores.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer runs cancel | terminate | pause | resume", () => {
  it("cancels and reports the phase and every turn the interrupt stopped", async () => {
    const out = await runs("cancel", "run_1");
    expect(control.cancelRun).toHaveBeenCalledWith(stigmer, "run_1");
    expect(out).toContain("Run cancelled: run_1 (phase: cancelled; stopped: run_1, run_2)");
  });

  it("names no stopped turns when the interrupt stopped none", async () => {
    control.cancelRun.mockResolvedValue({ phase: "cancelled", wasAlreadyTerminal: false, stoppedRunIds: [] });
    const out = await runs("cancel", "run_1");
    expect(out).toContain("Run cancelled: run_1 (phase: cancelled)");
  });

  it("says when the run had already ended", async () => {
    control.cancelRun.mockResolvedValue({ phase: "completed", wasAlreadyTerminal: true, stoppedRunIds: [] });
    const out = await runs("cancel", "run_1");
    expect(out).toContain("Run already ended: run_1 (phase: completed)");
  });

  it("terminates with the reason", async () => {
    const out = await runs("terminate", "run_1", "--reason", "stuck");
    expect(control.terminateRun).toHaveBeenCalledWith(stigmer, "run_1", "stuck");
    expect(out).toContain("Run terminated: run_1 (phase: terminated)");
  });

  it("pauses with an empty reason when none is given", async () => {
    const out = await runs("pause", "run_1");
    expect(control.pauseRun).toHaveBeenCalledWith(stigmer, "run_1", "");
    expect(out).toContain("Run paused: run_1 (phase: paused)");
  });

  it("resumes, which takes no reason", async () => {
    const out = await runs("resume", "run_1");
    expect(control.resumeRun).toHaveBeenCalledWith(stigmer, "run_1");
    expect(out).toContain("Run resumed: run_1 (phase: running)");
  });
});

describe("stigmer runs approve", () => {
  it("answers the named tool call with the given action and reason", async () => {
    const out = await runs("approve", "run_1", "--tool-call", "run_1.c1", "--action", "deny", "--comment", "unsafe");
    expect(approve.approveAgentToolCall).toHaveBeenCalledWith(stigmer, {
      runId: "run_1",
      toolCallId: "run_1.c1",
      action: "deny",
      comment: "unsafe",
    });
    expect(out).toContain("Tool call denied: delete (run_1.c1)");
  });

  it("allows the one waiting call for the turn when no --tool-call is named", async () => {
    approve.approveAgentToolCall.mockResolvedValue({ toolUseId: "run_1.c1", toolName: "shell", answer: "grant" });
    const out = await runs("approve", "run_1", "--action", "allow-all");
    expect(approve.approveAgentToolCall).toHaveBeenCalledWith(stigmer, {
      runId: "run_1",
      toolCallId: "",
      action: "allow-all",
      comment: "",
    });
    expect(out).toContain("Tool call allowed for the rest of the turn: shell (run_1.c1)");
  });

  it("defaults the action to allow", async () => {
    approve.approveAgentToolCall.mockResolvedValue({ toolUseId: "run_1.c1", toolName: "shell", answer: "allow" });
    const out = await runs("approve", "run_1");
    expect(approve.approveAgentToolCall).toHaveBeenCalledWith(stigmer, {
      runId: "run_1",
      toolCallId: "",
      action: "allow",
      comment: "",
    });
    expect(out).toContain("Tool call allowed: shell (run_1.c1)");
  });

  it("passes the resource's refusal through", async () => {
    approve.approveAgentToolCall.mockRejectedValue(new UsageError("run run_1 has no tool call waiting for an answer"));
    await expect(runs("approve", "run_1")).rejects.toThrow("run run_1 has no tool call waiting for an answer");
  });
});

describe("stigmer runs logs", () => {
  it("passes --follow through with an abort signal", async () => {
    await runs("logs", "run_1", "--follow");
    expect(logs.streamRunLogs).toHaveBeenCalledWith(
      stigmer,
      { runId: "run_1", follow: true },
      expect.any(AbortSignal),
    );
  });

  it("reads once when --follow is absent, and leaves no signal handler behind", async () => {
    const before = process.listenerCount("SIGINT");
    await runs("logs", "run_1");
    expect(logs.streamRunLogs).toHaveBeenCalledWith(
      stigmer,
      { runId: "run_1", follow: false },
      expect.any(AbortSignal),
    );
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("stigmer runs trace", () => {
  it("renders the table by default", async () => {
    await runs("trace", "run_1");
    expect(trace.traceRun).toHaveBeenCalledWith(stigmer, "run_1", "table");
  });

  it("passes -o json through", async () => {
    await runs("trace", "run_1", "-o", "json");
    expect(trace.traceRun).toHaveBeenCalledWith(stigmer, "run_1", "json");
  });
});

describe("stigmer runs scores", () => {
  it("renders the table by default", async () => {
    await runs("scores", "run_1");
    expect(scores.showRunScores).toHaveBeenCalledWith(stigmer, "run_1", "table");
  });

  it("passes -o json through", async () => {
    await runs("scores", "run_1", "-o", "json");
    expect(scores.showRunScores).toHaveBeenCalledWith(stigmer, "run_1", "json");
  });
});
