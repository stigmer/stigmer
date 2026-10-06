// Tests for runEpilogue, the exit summary every run renderer ends with: a
// stream that failed before reaching a phase is re-raised as a CLI error;
// otherwise the final run and its usage report are read (the run by the id
// the stream followed) and a compact summary goes to stderr. In a session the
// summary names the outcome (completed with duration and cost, failed with
// the best error the run holds, cancelled, stopped, or exited mid-phase) and
// the matching copy-paste `stigmer resume` line; without one it is a single
// completion line. A usage report the server will not give drops the cost
// and fails nothing. The client is a double recording what it was asked.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentRunSchema, type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { MessageType, RunPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { GetRunUsageReportInput } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliExitError, ExitCode } from "../../../errors/index.js";
import { runEpilogue } from "../epilogue.js";

const STARTED = "2026-06-12T10:00:00Z";

function finalRun(status: MessageInitShape<typeof AgentRunSchema>["status"]): AgentRun {
  return create(AgentRunSchema, { metadata: { id: "aex_1" }, status });
}

interface Double {
  readonly client: Stigmer;
  readonly gets: string[];
  readonly usageRequests: GetRunUsageReportInput[];
}

/** A client whose final Get answers `run` and whose usage report costs `micros` (or fails). */
function double(run: AgentRun, micros: bigint | "fails" = 0n): Double {
  const gets: string[] = [];
  const usageRequests: GetRunUsageReportInput[] = [];
  const client = {
    agentRun: {
      get: async (id: string) => {
        gets.push(id);
        return run;
      },
      getRunUsageReport: async (req: GetRunUsageReportInput) => {
        usageRequests.push(req);
        if (micros === "fails") throw new Error("usage service down");
        return { aggregate: { billableCostMicros: micros } };
      },
    },
  } as unknown as Stigmer;
  return { client, gets, usageRequests };
}

let stderr: string[];

beforeEach(() => {
  vi.stubEnv("NO_COLOR", "1");
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const ok = { phase: "completed", error: "" };

describe("runEpilogue", () => {
  it("re-raises a stream that failed before any phase, reading nothing", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED }));
    const failure = runEpilogue(d.client, "ses_1", "aex_1", { phase: "", error: "stream reset" });
    await expect(failure).rejects.toBeInstanceOf(CliExitError);
    await expect(failure).rejects.toMatchObject({ message: "stream reset", exitCode: ExitCode.General });
    expect(d.gets).toEqual([]);
  });

  it("summarises a completed session turn with duration and cost, and returns the final run", async () => {
    const run = finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:01:30Z" });
    const d = double(run, 123_456n);
    const result = await runEpilogue(d.client, "ses_1", "aex_1", ok);

    expect(result).toBe(run);
    expect(d.gets).toEqual(["aex_1"]);
    expect(d.usageRequests.map((r) => r.runId)).toEqual(["aex_1"]);
    expect(stderr).toEqual(["\n", "✓ Completed (1m30s · $0.123)\n", "\n", "  To continue:  stigmer resume ses_1\n"]);
  });

  it("drops the cost when the usage report fails, without failing the run", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:00:45Z" }), "fails");
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✓ Completed (45s)\n");
  });

  it("offers a retry for a failed session turn, naming the run's error", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED, error: "model refused" }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✗ Failed: model refused\n");
    expect(stderr).toContain("  To retry:     stigmer resume ses_1\n");
  });

  it("reports a cancelled session turn and offers to resume it", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_CANCELLED }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("Cancelled\n");
    expect(stderr).toContain("  To resume:    stigmer resume ses_1\n");
  });

  it("reports a terminated session turn with its last system message", async () => {
    const d = double(
      finalRun({
        phase: RunPhase.RUN_TERMINATED,
        messages: [
          { type: MessageType.MESSAGE_SYSTEM, content: "first notice" },
          { type: MessageType.MESSAGE_SYSTEM, content: "cost cap reached" },
        ],
      }),
    );
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("Stopped: cost cap reached\n");
  });

  it("reports a session turn that exited mid-phase", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_WAITING_FOR_APPROVAL }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("Exited (waiting_for_approval)\n");
    expect(stderr).toContain("  To resume:    stigmer resume ses_1\n");
  });

  it("prints one completion line outside a session", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED }));
    await runEpilogue(d.client, "", "aex_1", ok);
    expect(stderr).toEqual(["\n", "✓ Run completed\n"]);
  });

  it("names the first failed tool call's error for a failed run outside a session", async () => {
    const d = double(
      finalRun({
        phase: RunPhase.RUN_FAILED,
        messages: [
          {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              { name: "Shell", status: ToolCallStatus.TOOL_CALL_COMPLETED },
              { name: "Fetch", status: ToolCallStatus.TOOL_CALL_FAILED, error: "connection refused" },
            ],
          },
        ],
      }),
    );
    await runEpilogue(d.client, "", "aex_1", ok);
    expect(stderr).toEqual(["\n", "✗ Run failed: connection refused\n"]);
  });

  it("falls back to the generic pointer when a failed run holds no error", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(d.client, "", "aex_1", ok);
    expect(stderr).toContain("✗ Run failed: Run failed (error details unavailable — check run logs)\n");
  });
});
