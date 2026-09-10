// Unit arms for the runner harness's SIGKILL-fallback line: when a runner
// outlives its SIGTERM grace, the line the job log keeps must say on its own
// whether the Temporal worker had stopped (the stigmer#1008 shape) or never
// finished draining (a hang of a new shape), and quote the runner's last output
// so the verdict can be checked without the log file CI discards on a green run
// (stigmer#1010; entry 20260908.01's wrong-assumption of 2026-09-08).
// Pure: a string in, a string out. No target, no spawn.
// Domain: conformance harness (execution engine).
import { describe, expect, it } from "vitest";
import { describeRunnerForceKill, runnerHomeEnv } from "../runner-process";

// The Temporal SDK prints each worker state change as a five-line object.
function workerStateChanged(state: string): string[] {
  return [
    `2026-09-07T23:06:47.287Z [INFO] Worker state changed {`,
    "  sdkComponent: 'worker',",
    "  taskQueue: 'stigmer_runner',",
    `  state: '${state}'`,
    "}",
  ];
}

// The tail of a #1008 hang, as the runner's log records it: the graceful path
// completes and the process then stays alive with nothing more logged.
const HANG_AFTER_WORKER_STOPPED = [
  "[ExecuteDeepAgent] Completed execution aex_01m1z1zhtfgkk9jmn0rka2kg73: events=73, messages=1, artifacts=0, writebacks=0, hasStructuredOutput=false",
  "Received SIGTERM, stopping worker gracefully...",
  ...workerStateChanged("STOPPING"),
  ...workerStateChanged("DRAINING"),
  ...workerStateChanged("DRAINED"),
  ...workerStateChanged("STOPPED"),
  "Worker stopped",
  "",
].join("\n");

const FALLBACK_HEADER = /^\[runner\] did not exit within \d+ms of SIGTERM — SIGKILL fallback; /;

function quotedLines(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => line.startsWith("    | "))
    .map((line) => line.slice("    | ".length));
}

describe("describeRunnerForceKill", () => {
  it("reads a tail that reached `Worker stopped` as the #1008 shape and quotes up to the marker", () => {
    const message = describeRunnerForceKill(HANG_AFTER_WORKER_STOPPED);

    expect(message, "the recipe's grep token must survive").toMatch(FALLBACK_HEADER);
    expect(message).toContain('worker="stopped"');
    expect(message, "the verdict names the issue it stands for").toContain("stigmer#1008");
    expect(message).not.toContain('worker="not stopped"');
    const quoted = quotedLines(message);
    expect(quoted.at(-1), "the excerpt ends where the runner went silent").toBe("Worker stopped");
    expect(quoted[0], "the whole shutdown sequence fits: 23 non-blank lines under the bound").toMatch(
      /^\[ExecuteDeepAgent\]/,
    );
    expect(quoted, "the sequence is readable from SIGTERM to the marker").toContain(
      "Received SIGTERM, stopping worker gracefully...",
    );
  });

  it("reads a tail that never reached the marker as NOT the #1008 shape", () => {
    // Cut mid-drain: through the DRAINING state change, before DRAINED.
    const tail = HANG_AFTER_WORKER_STOPPED.split("\n").slice(0, 12).join("\n");
    expect(tail, "the arm's premise: the drain is still in flight").toMatch(/state: 'DRAINING'\n}$/);

    const message = describeRunnerForceKill(tail);

    expect(message).toMatch(FALLBACK_HEADER);
    expect(message).toContain('worker="not stopped"');
    expect(message, "a reader is told this is not the known shape").toContain("NOT the #1008 shape");
    expect(message).not.toContain('worker="stopped"');
    const quoted = quotedLines(message);
    expect(quoted, "the excerpt shows how far the drain got").toContain("  state: 'DRAINING'");
    expect(quoted.join("\n")).not.toMatch(/DRAINED|STOPPED/);
  });

  it("keeps the `stopped` verdict when the runner printed after the marker, and shows what it printed", () => {
    const tail =
      HANG_AFTER_WORKER_STOPPED +
      "agent-session-cache: closed parked agent for session=ses_01 (shutdown)\n" +
      "Error: something the harness has never seen\n";

    const message = describeRunnerForceKill(tail);

    expect(message, "a post-drain line is evidence, not a different verdict").toContain('worker="stopped"');
    const quoted = quotedLines(message);
    expect(quoted).toContain("Worker stopped");
    expect(quoted.at(-2)).toBe("agent-session-cache: closed parked agent for session=ses_01 (shutdown)");
    expect(quoted.at(-1), "the surprise is in the job log, where a reader sees it").toBe(
      "Error: something the harness has never seen",
    );
  });

  it("does not throw on an empty tail and says nothing was captured", () => {
    const message = describeRunnerForceKill("");

    expect(message).toMatch(FALLBACK_HEADER);
    expect(message, "no output cannot prove the worker stopped").toContain('worker="not stopped"');
    expect(quotedLines(message)).toEqual(["(no runner output captured)"]);
  });

  it("quotes only the last 24 non-blank lines and clips a long line", () => {
    const longLine = "x".repeat(5_000);
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const tail = [...lines.slice(0, 20), "", "   ", ...lines.slice(20), longLine, "Worker stopped"].join("\n");

    const message = describeRunnerForceKill(tail);

    const quoted = quotedLines(message);
    expect(quoted, "exactly the bound, blanks not counted").toHaveLength(24);
    expect(quoted[0]).toBe("line 29");
    expect(quoted.at(-1)).toBe("Worker stopped");
    const clipped = quoted.at(-2)!;
    expect(clipped.endsWith("…"), "a clipped line says so").toBe(true);
    expect(clipped.length, "240 kept characters plus the ellipsis").toBe(241);
    expect(message.length, "the whole message stays a job-log-sized paragraph").toBeLessThan(2_500);
  });

  it("matches the marker as a whole line only, tolerating surrounding whitespace and CRLF", () => {
    for (const notTheMarker of ["Worker stopped?", "Worker stopped early", "xWorker stopped", "Worker  stopped"]) {
      expect(
        describeRunnerForceKill(`Received SIGTERM, stopping worker gracefully...\n${notTheMarker}\n`),
        `"${notTheMarker}" merely contains the words`,
      ).toContain('worker="not stopped"');
    }
    for (const theMarker of ["  Worker stopped  ", "Worker stopped\r", "\tWorker stopped"]) {
      expect(
        describeRunnerForceKill(`Received SIGTERM, stopping worker gracefully...\r\n${theMarker}\r\n`),
        `${JSON.stringify(theMarker)} is the marker with whitespace around it`,
      ).toContain('worker="stopped"');
    }
  });

  it("ignores a marker that is only a fragment at the tail's cut-off edge", () => {
    // The in-memory tail is a character slice, so its first line may be partial.
    // A fragment must not read as the marker in either direction.
    const message = describeRunnerForceKill("rker stopped\nsomething else\n");

    expect(message).toContain('worker="not stopped"');
  });
});

// The runner's home relocation (entry 20260910.02, ruling 2): the runner reads
// HOME then USERPROFILE for its `~/.stigmer` (shared/workspace/platform-dir.ts),
// and Node's homedir() — behind its workspace-root and artifact defaults —
// reads the same pair, so both must point at the harness-owned directory.
describe("runnerHomeEnv", () => {
  it("relocates both home variables the runner reads to the harness-owned directory", () => {
    expect(runnerHomeEnv("/tmp/harness-home")).toEqual({ HOME: "/tmp/harness-home", USERPROFILE: "/tmp/harness-home" });
  });
});
