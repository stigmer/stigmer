/**
 * Live ground truth for the transcript the Cursor harness builds — the one
 * check that proves the translator (`translator.ts`) and the one builder
 * (`harness/transcript/builder.ts`) against what the REAL `@cursor/sdk` sends,
 * through the REAL `ExecuteCursor` activity. The standing instrument an
 * `@cursor/sdk` bump runs before it is trusted, beside
 * `cursor-hook-protocol-live.test.ts` (the hook payloads) and
 * `cursor-sdk-auth-smoke.test.ts` (the credential).
 *
 * WHY THIS EXISTS. The hermetic goldens under `hermetic/` prove the folding
 * rules against the SDK shapes CAPTURED in the scripted double
 * (`__test-utils__/scripted-sdk.ts`). They cannot see the SDK move, and they
 * cannot see the two channels the translator reads — the discrete
 * `run.stream()` events and the fine-grained `onDelta` updates — arrive in the
 * order the real SDK interleaves them. Three facts about a real turn decide
 * whether the transcript the console renders is right, and none is a type:
 *
 *  1. Every row SETTLES. A tool call that ends RUNNING, or an AI message that
 *     ends `isStreaming`, is a spinner that never stops.
 *  2. Live shell output lands ONCE. `shell-output-delta` chunks stream into
 *     the row while the command runs; the stream's own completed `tool_call`
 *     carries the final output. Lost output or doubled output (a chunk applied
 *     to a row the completion already settled) is the S4 M4 hunk Q-M4-15 ruled.
 *  3. `tool-call-completed` on the delta channel may arrive before or after
 *     the stream's own completion; the translator defers to the stream's
 *     instant either way. Only a recording of both channels under one
 *     sequence shows which order the SDK actually uses.
 *
 * HOW. The hermetic driver's LIVE posture (`hermetic-cursor.ts`,
 * `beginLiveCursorScenario`): this file mocks ONLY the control-plane client, so
 * the real activity runs under a real `MockActivityEnvironment` `Context`,
 * persists into an in-memory `ExecutionRecord`, and talks to the real SDK
 * with a real member key on the real clock. The runner's own approval hook is
 * installed and runs (the gate is unconditional; `spec.auto_approve_all`
 * makes it allow), under a temp `HOME` the SDK's own `~/.cursor` state also
 * lands in. The registry fixture keeps pricing and tier pinned and lets every
 * other URL reach the network (`stubRegistryFetch({ live: true })`).
 *
 * WHAT IT ASSERTS, AND WHAT A FAILURE MEANS. Structural facts of the persisted
 * transcript, never prose (a live model's words are not ours). Every failure
 * text says which of two readings it supports — the MODEL deviated from the
 * prompt (re-run; not a defect), or the TRANSCRIPT is wrong (a STOP for a
 * bump) — and names the recording as the arbiter: with
 * `CURSOR_EVENT_RECORD_DIR` set, the raw events of both channels are written
 * to `<dir>/<executionId>.cursor-events.jsonl` in arrival order, and this
 * file prints their sequence.
 *
 * Skipped without CURSOR_API_KEY (the sibling arms' convention) — it spends
 * real credits for one two-tool turn. Findings are PRINTED as well as
 * asserted, so a bump's PR can quote what the real SDK sent.
 *
 * Run with:
 *   CURSOR_API_KEY=<member key> CURSOR_EVENT_RECORD_DIR=/tmp/cursor-live \
 *     CI=1 npx vitest run cursor-transcript-live
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { approvalCategory } from "../approval-policy.js";
import { beginLiveCursorScenario, cursorExecutionRecord, runCursorTurn } from "../__test-utils__/hermetic-cursor.js";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

/**
 * Read BEFORE the environment is created: the environment owns the variable
 * for the run (it sets it to this value, or clears it), and restores it after.
 */
const EVENT_RECORDING_DIR = process.env.CURSOR_EVENT_RECORD_DIR || undefined;

/** The one line the shell must print; asserted to appear exactly once in the shell row's result. */
const PROBE_LINE = "transcript probe";

/** The hook-protocol arm's prompt shape: one write, one shell, no questions. */
const PROMPT =
  "Do exactly two things, in order, without asking questions: " +
  `(1) create a file named probe.txt in the workspace containing the single line '${PROBE_LINE}'; ` +
  "(2) run the shell command `cat probe.txt`. Then reply with the word done.";

/** One line of the recording, as the recorder writes it (`cursor-event-recorder.ts`). */
interface RecordedLine {
  readonly seq: number;
  readonly channel: "stream" | "delta";
  readonly type: string;
  readonly event?: { readonly subtype?: unknown };
}

function readRecording(dir: string, executionId: string): RecordedLine[] {
  const path = join(dir, `${executionId}.cursor-events.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine);
}

/** `channel:type` plus the stream event's subtype when it has one (`tool_call` started/completed). */
function describeLine(line: RecordedLine): string {
  const subtype = line.channel === "stream" && typeof line.event?.subtype === "string" ? `:${line.event.subtype}` : "";
  return `${line.channel}:${line.type}${subtype}`;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SETTLED: ReadonlySet<ToolCallStatus> = new Set([
  ToolCallStatus.TOOL_CALL_COMPLETED,
  ToolCallStatus.TOOL_CALL_FAILED,
  ToolCallStatus.TOOL_CALL_SKIPPED,
  ToolCallStatus.TOOL_CALL_INTERRUPTED,
]);

describeWithCursorKey("ExecuteCursor live — the transcript against the real SDK", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    env = createHermeticEnvironment({ eventRecordingDir: EVENT_RECORDING_DIR });
    registry = stubRegistryFetch({ live: true });
  });

  afterAll(() => {
    registry.restore();
    env.dispose();
  });

  it("settles every row, lands the shell output once, and records both channels in arrival order", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = cursorExecutionRecord({ message: PROMPT, autoApproveAll: true });
    const scenario = beginLiveCursorScenario({ env, record, apiKey: CURSOR_API_KEY });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Findings dump (what a bump's PR quotes) ──────────────────────────────
    const final = record.lastFullStatus;
    const rows = record.toolCalls();
    console.log(`[transcript-live] outcome: ${invocation.outcome.kind}; phases persisted: ${record.persistedPhases.map((p) => ExecutionPhase[p]).join(" → ")}`);
    for (const m of final?.messages ?? []) {
      console.log(`[transcript-live] message type=${MessageType[m.type]} isStreaming=${m.isStreaming} rows=${m.toolCalls.length} content=${JSON.stringify(m.content.slice(0, 80))}`);
    }
    for (const row of rows) {
      console.log(
        `[transcript-live] row name=${row.name} category=${approvalCategory(row.name) ?? "-"} status=${ToolCallStatus[row.status]} ` +
          `argsPreview=${JSON.stringify(row.argsPreview.slice(0, 80))} result=${JSON.stringify(row.result.slice(0, 120))}`,
      );
    }
    const hosts = [...new Set(registry.urls.map((u) => new URL(u).host))];
    console.log(`[transcript-live] fetch hosts dialled: ${hosts.join(", ")}`);

    const recording = EVENT_RECORDING_DIR ? readRecording(EVENT_RECORDING_DIR, record.executionId) : [];
    if (EVENT_RECORDING_DIR) {
      console.log(`[transcript-live] recording: ${recording.length} lines at ${join(EVENT_RECORDING_DIR, `${record.executionId}.cursor-events.jsonl`)}`);
      console.log(`[transcript-live] sequence: ${recording.map((l) => `${l.seq}=${describeLine(l)}`).join(" ")}`);
    }

    // ── Assert: the turn completed ───────────────────────────────────────────
    if (invocation.outcome.kind === "threw") {
      const error = invocation.outcome.error;
      throw new Error(
        `the activity threw instead of returning: ${error instanceof Error ? error.message : String(error)} — ` +
          "a credential or quota refusal from Cursor reads as such in this message and is not a transcript defect; anything else is",
      );
    }
    expect(record.persistedPhases.at(-1), "the last persisted phase is not COMPLETED — read the phases above").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
    expect(final, "no full status was persisted").toBeDefined();

    // ── Assert: fact 1 — every row settled ───────────────────────────────────
    const streaming = final!.messages.filter((m) => m.isStreaming);
    expect(
      streaming.map((m) => m.type),
      "a message is still isStreaming in the COMPLETED status — a spinner that never stops; the transcript is wrong (finalize did not close it)",
    ).toEqual([]);
    const unsettled = rows.filter((r) => !SETTLED.has(r.status));
    expect(
      unsettled.map((r) => `${r.name}=${ToolCallStatus[r.status]}`),
      "a tool call is not settled in the COMPLETED status — the transcript is wrong (a completion the SDK sent was not folded; the recording shows whether it arrived)",
    ).toEqual([]);

    // ── Assert: the prompt's two actions reached the transcript ──────────────
    const byCategory = (category: "write" | "shell"): ToolCall[] => rows.filter((r) => approvalCategory(r.name) === category);
    const writes = byCategory("write");
    const shells = byCategory("shell");
    expect(
      writes.length,
      "no write-category tool call in the transcript — either the model created the file another way (re-run) or the translator dropped a tool_call (the recording shows a stream tool_call the rows lack; a STOP)",
    ).toBeGreaterThan(0);
    expect(
      shells.length,
      "no shell-category tool call in the transcript — either the model ran no shell command (re-run; the recording shows no shell tool_call from the SDK) or the translator dropped one (the recording shows it; a STOP)",
    ).toBe(1);

    // ── Assert: fact 2 — the shell output landed once ────────────────────────
    const shell = shells[0]!;
    expect(shell.status, "the shell row did not COMPLETE — the transcript is wrong").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(
      countOccurrences(shell.result, PROBE_LINE),
      `the shell row's result carries the probe line ${countOccurrences(shell.result, PROBE_LINE)} times, not once — ` +
        "0 is lost output (or the model wrote a different line: compare the write row's argsPreview), 2+ is doubled output (a shell-output-delta applied after the completion; the recording shows the order) — either is the transcript being wrong",
    ).toBe(1);
    for (const write of writes) {
      expect(write.status, `the write row ${write.name} did not settle COMPLETED — the transcript is wrong`).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    }

    // ── Assert: fact 3 — the recording holds both channels in one sequence ───
    if (EVENT_RECORDING_DIR) {
      expect(recording.length, "CURSOR_EVENT_RECORD_DIR was set but no recording was written — the recorder was not flushed").toBeGreaterThan(0);
      expect(recording.map((l) => l.seq), "the recording's seq is not the arrival order").toEqual(recording.map((_, i) => i));
      const channels = new Set(recording.map((l) => l.channel));
      expect(channels.has("stream"), "the recording holds no stream event").toBe(true);
      expect(channels.has("delta"), "the recording holds no delta — the onDelta channel was not recorded").toBe(true);
    }
  }, 300_000);
});
