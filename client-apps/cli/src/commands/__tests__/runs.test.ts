// Command-level contract for the `stigmer runs` group: each verb hands the run
// id and its flags to the right resource call and prints the success line the
// group promises on stderr; `approve` refuses a missing --task (workflow run)
// or --tool-call (agent run) as a usage error before any call; `logs` and
// `trace` pass their flags through. The backend and the run resources are
// replaced at their module seams (the commands import them lazily); the
// program, the flag parsing and the result rendering are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
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

const approve = vi.hoisted(() => ({
  approveWorkflowTask: vi.fn(),
  approveAgentToolCall: vi.fn(),
}));
vi.mock("../../resources/run-approve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/run-approve.js")>();
  return { ...actual, ...approve };
});

const logs = vi.hoisted(() => ({ streamRunLogs: vi.fn() }));
vi.mock("../../resources/run-logs.js", () => logs);

const trace = vi.hoisted(() => ({ traceRun: vi.fn() }));
vi.mock("../../resources/run-trace.js", () => trace);

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
  control.cancelRun.mockResolvedValue({ type: "agent", phase: "cancelled" });
  control.terminateRun.mockResolvedValue({ type: "workflow", phase: "terminated" });
  control.pauseRun.mockResolvedValue({ type: "agent", phase: "paused" });
  control.resumeRun.mockResolvedValue({ type: "workflow", phase: "running" });
  approve.approveWorkflowTask.mockResolvedValue(undefined);
  approve.approveAgentToolCall.mockResolvedValue(undefined);
  logs.streamRunLogs.mockResolvedValue(undefined);
  trace.traceRun.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer runs cancel | terminate | pause | resume", () => {
  it("cancels with the reason and reports the phase the server returned", async () => {
    const out = await runs("cancel", "aex_1", "--reason", "no longer needed");
    expect(control.cancelRun).toHaveBeenCalledWith(stigmer, "aex_1", "no longer needed");
    expect(out).toContain("Run cancelled: aex_1 (phase: cancelled)");
  });

  it("terminates with the reason", async () => {
    const out = await runs("terminate", "wex_1", "--reason", "stuck");
    expect(control.terminateRun).toHaveBeenCalledWith(stigmer, "wex_1", "stuck");
    expect(out).toContain("Run terminated: wex_1 (phase: terminated)");
  });

  it("pauses with an empty reason when none is given", async () => {
    const out = await runs("pause", "aex_1");
    expect(control.pauseRun).toHaveBeenCalledWith(stigmer, "aex_1", "");
    expect(out).toContain("Run paused: aex_1 (phase: paused)");
  });

  it("resumes, which takes no reason", async () => {
    const out = await runs("resume", "wex_1");
    expect(control.resumeRun).toHaveBeenCalledWith(stigmer, "wex_1");
    expect(out).toContain("Run resumed: wex_1 (phase: running)");
  });
});

describe("stigmer runs approve", () => {
  it("submits a workflow task decision with its comment, defaulting the outcome to approve", async () => {
    const out = await runs("approve", "wex_1", "--task", "sign-off", "--comment", "lgtm");
    expect(approve.approveWorkflowTask).toHaveBeenCalledWith(stigmer, {
      runId: "wex_1",
      taskName: "sign-off",
      outcome: "approve",
      comment: "lgtm",
      formData: undefined,
    });
    expect(out).toContain("Approval submitted: task=sign-off outcome=approve");
  });

  it("refuses a workflow approval without --task before calling the server", async () => {
    await expect(runs("approve", "wex_1")).rejects.toThrow(
      new UsageError("--task is required for workflow run approvals"),
    );
    expect(approve.approveWorkflowTask).not.toHaveBeenCalled();
  });

  it("submits an agent tool-call decision with the given action", async () => {
    const out = await runs("approve", "aex_1", "--tool-call", "tc_1", "--action", "deny");
    expect(approve.approveAgentToolCall).toHaveBeenCalledWith(stigmer, {
      runId: "aex_1",
      toolCallId: "tc_1",
      action: "deny",
      comment: "",
    });
    expect(out).toContain("Approval submitted: tool-call=tc_1 action=deny");
  });

  it("refuses an agent approval without --tool-call before calling the server", async () => {
    await expect(runs("approve", "aex_1")).rejects.toThrow(
      new UsageError("--tool-call is required for agent run approvals"),
    );
    expect(approve.approveAgentToolCall).not.toHaveBeenCalled();
  });

  it("refuses an id of neither family as a usage error", async () => {
    await expect(runs("approve", "ses_1", "--task", "x")).rejects.toBeInstanceOf(UsageError);
    expect(approve.approveWorkflowTask).not.toHaveBeenCalled();
  });
});

describe("stigmer runs logs", () => {
  it("passes --follow and --task through with an abort signal", async () => {
    await runs("logs", "wex_1", "--follow", "--task", "build");
    expect(logs.streamRunLogs).toHaveBeenCalledWith(
      stigmer,
      { runId: "wex_1", follow: true, task: "build" },
      expect.any(AbortSignal),
    );
  });

  it("reads once when --follow is absent, and leaves no signal handler behind", async () => {
    const before = process.listenerCount("SIGINT");
    await runs("logs", "aex_1");
    expect(logs.streamRunLogs).toHaveBeenCalledWith(
      stigmer,
      { runId: "aex_1", follow: false, task: undefined },
      expect.any(AbortSignal),
    );
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("stigmer runs trace", () => {
  it("renders the table by default", async () => {
    await runs("trace", "wex_1");
    expect(trace.traceRun).toHaveBeenCalledWith(stigmer, "wex_1", "table");
  });

  it("passes -o json through", async () => {
    await runs("trace", "aex_1", "-o", "json");
    expect(trace.traceRun).toHaveBeenCalledWith(stigmer, "aex_1", "json");
  });
});
