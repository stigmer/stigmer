// The real-clock run's report (../report.ts): the transcript's sequence
// check, the Markdown summary while running and at the end, and the writer
// that leaves both files whole.
// Domain: conformance long turn (pure, plus the writer on a temp directory).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSummary, seqGapsOf, transcriptCheckOf, writeLongTurnReport, type LongTurnReport, type MinuteSample } from "../report";

const sample = (minute: number, over: Partial<MinuteSample> = {}): MinuteSample => ({
  elapsedMinutes: minute,
  phase: "RUN_IN_PROGRESS",
  openStep: "silent-build",
  stepsStarted: 1,
  stepsEnded: 0,
  sessionEvents: 4,
  modelCalls: 1,
  compactions: 0,
  error: "",
  ...over,
});

const running: LongTurnReport = {
  profile: "goal",
  model: "claude-haiku-4.5",
  startedAt: "2026-10-18T08:00:00.000Z",
  steps: ["silent-build", "streamed-build"],
  notes: ["the runner's token is static here, so no re-mint is seen"],
  samples: [sample(1), sample(2)],
  runnerEvents: [],
};

describe("the transcript check", () => {
  it("names every missing sequence number as a range, and an unbroken log as none", () => {
    expect(seqGapsOf([1, 2, 3, 4])).toEqual([]);
    expect(seqGapsOf([5, 1, 2, 9, 7])).toEqual([[3, 4], [6, 6], [8, 8]]);
    expect(transcriptCheckOf([2, 3, 5])).toEqual({ events: 3, firstSeq: 2, lastSeq: 5, gaps: [[4, 4]] });
    expect(transcriptCheckOf([])).toEqual({ events: 0, firstSeq: 0, lastSeq: 0, gaps: [] });
  });
});

describe("the summary", () => {
  it("says a run is going, with its newest minute, its notes and every minute", () => {
    const md = renderSummary(running);
    expect(md).toContain("**Running**: minute 2, RUN_IN_PROGRESS, open step silent-build.");
    expect(md).toContain("Note: the runner's token is static here");
    expect(md.match(/^\| [12] \|/gm)).toHaveLength(2);
    expect(renderSummary({ ...running, samples: [] })).toContain("no sample yet");
    expect(renderSummary({ ...running, samples: [sample(1, { modelCalls: undefined, compactions: undefined })] })).toMatch(/\| n\/a \| n\/a \|/);
  });

  it("leads with where the turn ended, its error, the runner ends and the transcript", () => {
    const md = renderSummary({
      ...running,
      samples: [sample(3, { phase: "RUN_FAILED", error: "stalled | for 180s" })],
      runnerEvents: [{ elapsedMinutes: 2, step: "killed-mid-tool", signal: "SIGKILL" }],
      end: { phase: "RUN_FAILED", error: "[StallTimeoutError] stalled", elapsedMinutes: 3, atStep: "silent-build", stepsEnded: 0, stoppedByBudget: false, transcript: transcriptCheckOf([1, 2, 4]) },
    });
    expect(md).toContain("**Outcome**: ended RUN_FAILED at minute 3, at step `silent-build`, 0 of 2 steps ended.");
    expect(md).toContain("Error: [StallTimeoutError] stalled");
    expect(md).toContain("- minute 2: SIGKILL during `killed-mid-tool`");
    expect(md).toContain("gaps 3.");
    expect(md).toContain("stalled \\| for 180s");
    expect(renderSummary({ ...running, samples: [sample(1, { error: "C:\\path | x" })] })).toContain("C:\\\\path \\| x");
    const whole = renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 9, atStep: undefined, stepsEnded: 2, stoppedByBudget: true, transcript: transcriptCheckOf([1, 2, 3, 4]) } });
    expect(whole).toContain("stopped by the run's budget at minute 9, at step `none`");
    expect(whole).toContain("seq 1 to 4, unbroken.");
    expect(whole, "no reply line when the turn wrote none").not.toContain("Reply:");
    const replied = renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 1, atStep: undefined, stepsEnded: 0, stoppedByBudget: false, transcript: undefined, reply: "I won't run that." } });
    expect(replied).toContain("Reply: I won't run that.");
    expect(replied, "no counts line on a live run").not.toContain("compactions:");
    const counted = renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 0.2, atStep: undefined, stepsEnded: 0, stoppedByBudget: false, transcript: undefined, modelCalls: 69, compactions: 3 } });
    expect(counted).toContain("Model calls: 69; compactions: 3.");
    expect(renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 0.2, atStep: undefined, stepsEnded: 0, stoppedByBudget: false, transcript: undefined, compactions: 0 } })).toContain("Model calls: 0; compactions: 0.");
    const long = renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 1, atStep: undefined, stepsEnded: 0, stoppedByBudget: false, transcript: undefined, reply: "x".repeat(700) } });
    expect(long).toContain(`Reply: ${"x".repeat(600)}…`);
    expect(renderSummary({ ...running, end: { phase: "RUN_FAILED", error: "", elapsedMinutes: 1, atStep: "x", stepsEnded: 0, stoppedByBudget: false, transcript: transcriptCheckOf([1, 2, 3, 6]) } })).toContain("gaps 4-5.");
  });
});

describe("the writer", () => {
  it("leaves report.json and summary.md whole, and no temporary file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "long-turn-report-test-"));
    try {
      await writeLongTurnReport(dir, running);
      expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))).toEqual(running);
      expect(readFileSync(join(dir, "summary.md"), "utf8")).toBe(renderSummary(running));
      expect(existsSync(join(dir, "report.json.tmp"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
