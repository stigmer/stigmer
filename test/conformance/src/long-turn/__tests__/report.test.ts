// The real-clock run's report (../report.ts): the transcript's sequence
// check, the streaming follower's check against the log, the verdict both
// give, what became of the person's message and what they were told, the
// Markdown summary while running and at the end, and the writer that leaves
// both files whole.
// Domain: conformance long turn (pure, plus the writer on a temp directory).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  followerCheckOf,
  messageCheckOf,
  messageVerdictOf,
  movedSeqsOf,
  renderSummary,
  seqGapsOf,
  transcriptCheckOf,
  transcriptVerdictOf,
  writeLongTurnReport,
  type LongTurnEnd,
  type LongTurnReport,
  type MinuteSample,
  type SentMessage,
} from "../report";

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

describe("the follower check", () => {
  it("holds a follower whole when it was sent every seq of the log once, in order, across its streams", () => {
    expect(followerCheckOf([1, 2, 3, 4], [1, 2, 3, 4], ["Unavailable"])).toEqual({
      events: 4,
      streams: 2,
      endings: ["Unavailable"],
      missing: [],
      duplicates: [],
      extra: [],
      inOrder: true,
    });
  });

  it("names what a follower missed, was sent twice, was sent that the log lacks, and an order the log does not have", () => {
    const check = followerCheckOf([1, 6, 2, 6, 2, 4, 9, 8], [1, 2, 3, 4, 5, 6, 7], []);
    expect(check.missing).toEqual([[3, 3], [5, 5], [7, 7]]);
    expect(check.duplicates).toEqual([2, 6]);
    expect(check.extra).toEqual([8, 9]);
    expect(check.inOrder).toBe(false);
    expect(check.streams).toBe(1);
  });
});

describe("the transcript verdict", () => {
  const end = { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 9, atStep: undefined, stepsEnded: 2, stoppedByBudget: false };

  it("is whole only when the log is unbroken and the follower holds exactly the log", () => {
    expect(transcriptVerdictOf({ ...end, transcript: transcriptCheckOf([1, 2, 3]), follower: followerCheckOf([1, 2, 3], [1, 2, 3], []) })).toEqual({ whole: true, reasons: [] });
    expect(transcriptVerdictOf({ ...end, transcript: transcriptCheckOf([1, 2, 4]), follower: followerCheckOf([1, 2, 4], [1, 2, 4], []) })).toEqual({
      whole: false,
      reasons: ["the log has gaps 3"],
    });
    expect(transcriptVerdictOf({ ...end, transcript: transcriptCheckOf([1, 2, 3, 4, 5, 6]), follower: followerCheckOf([1, 2, 2, 5, 9], [1, 2, 3, 4, 5, 6], []) }).reasons).toEqual([
      "the follower missed 3-4, 6",
      "the follower was sent 2 twice",
      "the follower was sent 9, which the log lacks",
    ]);
    expect(transcriptVerdictOf({ ...end, transcript: transcriptCheckOf([1, 2]), follower: followerCheckOf([2, 1], [1, 2], []) }).reasons).toEqual(["the follower was sent the log out of order"]);
  });

  it("is broken when the log was never read back or no follower streamed it", () => {
    expect(transcriptVerdictOf({ ...end, transcript: undefined, follower: followerCheckOf([], [], []) }).reasons).toEqual(["the log was not read back"]);
    expect(transcriptVerdictOf({ ...end, transcript: transcriptCheckOf([1]) }).reasons).toEqual(["no streaming follower ran"]);
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
    expect(md).toContain("**Transcript**: broken: the log has gaps 3; no streaming follower ran.");
    expect(md).toContain("gaps 3.");
    expect(md).toContain("stalled \\| for 180s");
    expect(renderSummary({ ...running, samples: [sample(1, { error: "C:\\path | x" })] })).toContain("C:\\\\path \\| x");
    const whole = renderSummary({ ...running, end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 9, atStep: undefined, stepsEnded: 2, stoppedByBudget: true, transcript: transcriptCheckOf([1, 2, 3, 4]) } });
    expect(whole).toContain("stopped by the run's budget at minute 9, at step `none`");
    expect(whole).toContain("seq 1 to 4, unbroken.");
    const followed = renderSummary({
      ...running,
      serverRestarts: [{ elapsedMinutes: 5, step: "server-restarted-mid-tool", overlapped: true }],
      end: { phase: "RUN_COMPLETED", error: "", elapsedMinutes: 9, atStep: undefined, stepsEnded: 2, stoppedByBudget: false, transcript: transcriptCheckOf([1, 2, 3]), follower: followerCheckOf([1, 2, 3], [1, 2, 3], ["Unavailable"]) },
    });
    expect(followed).toContain("**Transcript**: whole: the log is unbroken, and the follower was sent every event of it once, in order.");
    expect(followed).toContain("Follower: 3 events over 2 streams (ended: Unavailable).");
    expect(followed).toContain("## Server restarts");
    expect(followed).toContain("- minute 5: the server replaced, overlapping, during `server-restarted-mid-tool`");
    const plain = renderSummary({ ...running, serverRestarts: [{ elapsedMinutes: 5, step: "s", overlapped: false }] });
    expect(plain).toContain("- minute 5: the server stopped and started, during `s`");
    expect(plain, "no verdict while the run is going").not.toContain("**Transcript**");
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

describe("the person's message and what they are told", () => {
  const sent: SentMessage = { step: "message-mid-tool", sentAtMinutes: 31, eventId: "sevt_m", queuedWhenSent: true, serverRestartedWhileQueued: true };
  const use = (id: string, step: string): SessionEvent =>
    create(SessionEventSchema, {
      runId: "run_1",
      event: { case: "agentToolUse", value: { id, name: "execute", input: { command: `echo 'start ${step}'; wait` } } },
    });
  const result = (id: string, of: string): SessionEvent =>
    create(SessionEventSchema, { runId: "run_1", event: { case: "agentToolResult", value: { id, toolUseId: of } } });
  const message = (runId: string): SessionEvent =>
    create(SessionEventSchema, { runId, event: { case: "userMessage", value: { id: "sevt_m", content: [{ type: "text", text: "also the notes" }] } } });

  it("finds the message read by the run once, after the result of the step it was sent during", () => {
    const log = [use("u1", "subagent-work"), result("r1", "u1"), use("u2", "message-mid-tool"), result("r2", "u2"), message("run_1")];
    expect(messageCheckOf(log, sent)).toMatchObject({ listed: 1, readBy: "run_1", afterStepResult: true });
  });

  it("says when the message sits before its step's result, is read by another run, or is listed twice", () => {
    expect(messageCheckOf([use("u2", "message-mid-tool"), message("run_1"), result("r2", "u2")], sent).afterStepResult).toBe(false);
    expect(messageCheckOf([use("u2", "message-mid-tool"), result("r2", "u2"), message("run_2")], sent).readBy).toBe("run_2");
    expect(messageCheckOf([message("run_1"), message("run_1")], sent)).toMatchObject({ listed: 2, readBy: "", afterStepResult: false });
    expect(messageCheckOf([], sent)).toMatchObject({ listed: 0, readBy: "", afterStepResult: false });
  });

  it("passes a message read once after its step and one attention, finished; names every way it fails", () => {
    const end: LongTurnEnd = {
      phase: "RUN_COMPLETED",
      error: "",
      elapsedMinutes: 58,
      atStep: "drained-mid-tool",
      stepsEnded: 20,
      stoppedByBudget: false,
      transcript: undefined,
      message: { ...sent, listed: 1, readBy: "run_1", afterStepResult: true },
      attention: { told: [{ reason: "finished", runId: "run_1" }] },
    };
    expect(messageVerdictOf(end, "run_1")).toEqual({ read: true, reasons: [] });
    expect(messageVerdictOf({ ...end, message: undefined, attention: undefined }, "run_1").read, "a profile with neither").toBe(true);
    const failed = messageVerdictOf(
      {
        ...end,
        message: { ...sent, queuedWhenSent: false, listed: 2, readBy: "", afterStepResult: false },
        attention: { told: [{ reason: "finished", runId: "run_1" }, { reason: "finished", runId: "run_1" }] },
      },
      "run_1",
    );
    expect(failed.reasons).toEqual([
      "the message did not wait for the working turn: it was sent with nothing working",
      "the log lists the message 2 times",
      "no run read the message",
      "the message is not in the log after the result of `message-mid-tool`",
      "the person was told finished (run_1), finished (run_1), not once that the turn finished",
    ]);
    expect(messageVerdictOf({ ...end, message: { ...end.message!, readBy: "run_2" }, attention: { told: [] } }, "run_1").reasons).toEqual([
      "run run_2 read the message, not the turn",
      "the person was told nothing, not once that the turn finished",
    ]);
  });

  it("says in the summary what became of the message and what the person was told", () => {
    const summary = renderSummary({
      ...running,
      end: {
        phase: "RUN_COMPLETED",
        error: "",
        elapsedMinutes: 58,
        atStep: "drained-mid-tool",
        stepsEnded: 2,
        stoppedByBudget: false,
        transcript: undefined,
        message: { ...sent, listed: 1, readBy: "run_1", afterStepResult: true },
        attention: { told: [{ reason: "finished", runId: "run_1" }] },
      },
    });
    expect(summary).toContain(
      "Message: sent at minute 31 during `message-mid-tool`, waited in the queue, the server replaced while it waited; listed 1 time, read by run_1, after the step's result.",
    );
    expect(summary).toContain("Attention: told finished.");
    const quiet = renderSummary({
      ...running,
      end: {
        phase: "RUN_COMPLETED",
        error: "",
        elapsedMinutes: 1,
        atStep: undefined,
        stepsEnded: 0,
        stoppedByBudget: false,
        transcript: undefined,
        message: { ...sent, queuedWhenSent: false, serverRestartedWhileQueued: false, listed: 2, readBy: "", afterStepResult: false },
        attention: { told: [] },
      },
    });
    expect(quiet).toContain("Message: sent at minute 31 during `message-mid-tool`; listed 2 times, read by no run.");
    expect(quiet).toContain("Attention: told nothing.");
  });
});

describe("a queued message moved to the log's head", () => {
  it("is found where the follower first saw it, under an id the log lists at another seq", () => {
    expect(movedSeqsOf([[19, "a"], [20, "msg"], [21, "b"], [30, "msg"]], [[19, "a"], [21, "b"], [30, "msg"]])).toEqual([20]);
    expect(movedSeqsOf([[1, ""], [2, "gone"]], [[1, "x"]]), "an id the log lacks, or none, moved nowhere").toEqual([]);
  });

  it("is no gap in the log and no extra for the follower, and the summary says where it moved from", () => {
    const transcript = transcriptCheckOf([19, 21, 30], [20]);
    expect(transcript).toMatchObject({ gaps: [[22, 29]], moved: [20] });
    expect(transcriptCheckOf([1, 2]).moved).toBeUndefined();
    expect(transcriptCheckOf([1, 4], [3, 2])).toMatchObject({ gaps: [], moved: [2, 3] });
    const followed = followerCheckOf([19, 20, 21, 30], [19, 21, 30], [], [20]);
    expect([followed.extra, followed.missing]).toEqual([[], []]);
    const summary = renderSummary({
      ...running,
      end: {
        phase: "RUN_COMPLETED",
        error: "",
        elapsedMinutes: 2,
        atStep: undefined,
        stepsEnded: 2,
        stoppedByBudget: false,
        transcript: transcriptCheckOf([1, 3], [2]),
      },
    });
    expect(summary).toContain("Transcript: 2 events, seq 1 to 3, unbroken (moved to the head as read: 2).");
  });
});

