// Tests for runEpilogue, the exit summary every run renderer ends with: a
// stream that failed before reaching a phase is re-raised as a CLI error;
// otherwise the final run and its usage report are read (the run by the id
// the stream followed) and a compact summary goes to stderr. In a session the
// summary names the outcome (completed with duration and tokens, never a
// price; failed with the best error the run and its turn hold, cancelled,
// stopped, or exited mid-phase) and the matching copy-paste `stigmer resume`
// line; without one it is a single completion line. The best error is the
// run's own, else the folded turn's status error, its last error event, the
// platform's last note, the first failed tool use's output (a subagent's
// included); a turn the stream did not hand over is read from the run's
// events, only when the summary needs it. Tokens with no metered calls were
// counted from the runner's own report and carry a "~". A usage report the
// server will not give, or one that counted no tokens, drops the token part
// and fails nothing. The client is a double recording what it was asked.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { GetRunUsageReportInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { ListSessionEventsRequest } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { foldSession, type Stigmer, type Turn } from "@stigmer/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliExitError, ExitCode } from "../../../errors/index.js";
import { failure, note, phase, result, said, threadRunning, use, user } from "../../__test-utils__/session-events.js";
import type { HeadlessResult } from "../../stream/headless.js";
import { runEpilogue } from "../epilogue.js";

const STARTED = "2026-06-12T10:00:00Z";

function finalRun(status: MessageInitShape<typeof RunSchema>["status"]): Run {
  return create(RunSchema, { metadata: { id: "aex_1" }, status });
}

interface Double {
  readonly client: Stigmer;
  readonly gets: string[];
  readonly usageRequests: GetRunUsageReportInput[];
  readonly eventRequests: ListSessionEventsRequest[];
}

interface Usage {
  readonly totalTokens: bigint;
  readonly llmCallCount: number;
}

const NO_USAGE: Usage = { totalTokens: 0n, llmCallCount: 0 };

/**
 * A client whose final Get answers `run`, whose usage report holds `usage`
 * (or fails), and whose session lists `events`.
 */
function double(run: Run, usage: Usage | "fails" = NO_USAGE, events: SessionEvent[] = []): Double {
  const gets: string[] = [];
  const usageRequests: GetRunUsageReportInput[] = [];
  const eventRequests: ListSessionEventsRequest[] = [];
  const client = {
    session: {
      listEvents: async (req: ListSessionEventsRequest) => {
        eventRequests.push(req);
        return { events, nextPageToken: "" };
      },
    },
    run: {
      get: async (id: string) => {
        gets.push(id);
        return run;
      },
      getRunUsageReport: async (req: GetRunUsageReportInput) => {
        usageRequests.push(req);
        if (usage === "fails") throw new Error("usage service down");
        return { aggregate: usage };
      },
    },
  } as unknown as Stigmer;
  return { client, gets, usageRequests, eventRequests };
}

/** The turn of `events`, folded, as the headless stream hands it over. */
function folded(events: SessionEvent[]): HeadlessResult {
  const turn = foldSession(events).turns[0] as Turn;
  return { phase: turn.status?.phase ?? "", error: "", turn };
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

const ok: HeadlessResult = { phase: "completed", error: "", turn: undefined };

describe("runEpilogue", () => {
  it("re-raises a stream that failed before any phase, reading nothing", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED }));
    const raised = runEpilogue(d.client, "ses_1", "aex_1", { phase: "", error: "stream reset", turn: undefined });
    await expect(raised).rejects.toBeInstanceOf(CliExitError);
    await expect(raised).rejects.toMatchObject({ message: "stream reset", exitCode: ExitCode.General });
    expect(d.gets).toEqual([]);
  });

  it("summarises a completed session turn with duration and metered tokens, and returns the final run", async () => {
    const run = finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:01:30Z" });
    const d = double(run, { totalTokens: 18_400n, llmCallCount: 3 });
    const result = await runEpilogue(d.client, "ses_1", "aex_1", ok);

    expect(result).toBe(run);
    expect(d.gets).toEqual(["aex_1"]);
    expect(d.usageRequests.map((r) => r.runId)).toEqual(["aex_1"]);
    expect(stderr).toEqual(["\n", "✓ Completed (1m30s · 18.4k tokens)\n", "\n", "  To continue:  stigmer resume ses_1\n"]);
    expect(d.eventRequests).toEqual([]);
  });

  it("marks tokens counted from the runner's own report, with no metered calls, as estimated", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:00:42Z" }), {
      totalTokens: 1_234_567n,
      llmCallCount: 0,
    });
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✓ Completed (42s · ~1.2M tokens)\n");
  });

  it("drops the token part when the report counted none", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:00:45Z" }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✓ Completed (45s)\n");
  });

  it("names only the tokens when the run has no duration", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED }), { totalTokens: 900n, llmCallCount: 1 });
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✓ Completed (900 tokens)\n");
  });

  it("drops the tokens when the usage report fails, without failing the run", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED, startedAt: STARTED, completedAt: "2026-06-12T10:00:45Z" }), "fails");
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✓ Completed (45s)\n");
  });

  it("offers a retry for a failed session turn, naming the run's error", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED, error: "model refused" }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✗ Failed: model refused\n");
    expect(stderr).toContain("  To retry:     stigmer resume ses_1\n");
    expect(d.eventRequests).toEqual([]);
  });

  it("names the turn's status error when the run holds none", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(d.client, "ses_1", "aex_1", folded([user("aex_1", "go"), phase("aex_1", "failed", "budget exceeded")]));
    expect(stderr).toContain("✗ Failed: budget exceeded\n");
  });

  it("names the turn's last error event", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(
      d.client,
      "ses_1",
      "aex_1",
      folded([user("aex_1", "go"), failure("aex_1", "e1", "first"), failure("aex_1", "e2", "model overloaded"), phase("aex_1", "failed")]),
    );
    expect(stderr).toContain("✗ Failed: model overloaded\n");
  });

  it("reads the turn from the run's events when the stream handed none over", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }), NO_USAGE, [
      user("aex_1", "go"),
      failure("aex_1", "e1", "model overloaded"),
      phase("aex_1", "failed"),
    ]);
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("✗ Failed: model overloaded\n");
    expect(d.eventRequests.map((r) => [r.sessionId, r.runId])).toEqual([["ses_1", "aex_1"]]);
  });

  it("reports a cancelled session turn and offers to resume it", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_CANCELLED }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("Cancelled\n");
    expect(stderr).toContain("  To resume:    stigmer resume ses_1\n");
  });

  it("reports a terminated session turn with the platform's last note", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_TERMINATED }));
    await runEpilogue(
      d.client,
      "ses_1",
      "aex_1",
      folded([user("aex_1", "go"), note("aex_1", "n0", "first notice"), note("aex_1", "n1", "cost cap reached"), phase("aex_1", "terminated")]),
    );
    expect(stderr).toContain("Stopped: cost cap reached\n");
  });

  it("reports a session turn that exited mid-phase", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_WAITING_FOR_APPROVAL }));
    await runEpilogue(d.client, "ses_1", "aex_1", ok);
    expect(stderr).toContain("Exited (awaiting-approval)\n");
    expect(stderr).toContain("  To resume:    stigmer resume ses_1\n");
  });

  it("prints one completion line outside a session", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_COMPLETED }));
    await runEpilogue(d.client, "", "aex_1", ok);
    expect(stderr).toEqual(["\n", "✓ Run completed\n"]);
  });

  it("names the first failed tool use's output for a failed run outside a session", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(
      d.client,
      "",
      "aex_1",
      folded([
        user("aex_1", "go"),
        said("aex_1", 0, "Fetching."),
        use("aex_1", "c1", "Shell"),
        result("aex_1", "c1", "ok"),
        use("aex_1", "c2", "Fetch"),
        result("aex_1", "c2", "", true),
        use("aex_1", "c3", "Fetch"),
        result("aex_1", "c3", "connection refused", true),
        phase("aex_1", "failed"),
      ]),
    );
    expect(stderr).toEqual(["\n", "✗ Run failed: connection refused\n"]);
  });

  it("finds a failed tool use inside a subagent", async () => {
    const thread = "aex_1.t1";
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(
      d.client,
      "",
      "aex_1",
      folded([
        user("aex_1", "go"),
        use("aex_1", "t1", "task"),
        threadRunning("aex_1", thread, "researcher"),
        use("aex_1", "s1", "read", { threadId: thread }),
        result("aex_1", "s1", "no such file", true, thread),
        phase("aex_1", "failed"),
      ]),
    );
    expect(stderr).toEqual(["\n", "✗ Run failed: no such file\n"]);
  });

  it("falls back to the generic pointer when a failed run and its turn hold no error", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(d.client, "", "aex_1", folded([user("aex_1", "go"), phase("aex_1", "failed")]));
    expect(stderr).toContain("✗ Run failed: Run failed (error details unavailable — check run logs)\n");
  });

  it("falls back to the generic pointer outside a session with no turn, reading no events", async () => {
    const d = double(finalRun({ phase: RunPhase.RUN_FAILED }));
    await runEpilogue(d.client, "", "aex_1", ok);
    expect(stderr).toContain("✗ Run failed: Run failed (error details unavailable — check run logs)\n");
    expect(d.eventRequests).toEqual([]);
  });
});
