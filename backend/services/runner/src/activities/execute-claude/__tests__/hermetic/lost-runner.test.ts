/**
 * Hermetic: what a Claude turn leaves for the runner that replaces a lost
 * one, on the real engine.
 *
 * Invariants pinned:
 *  - While a call the gate let run is running, the session's store already
 *    holds it (the engine mirrors every entry as it writes it, stigmer#2612)
 *    and the session's log already shows it (its row is RUNNING once the gate
 *    let it run, stigmer#2614). A runner lost mid-call therefore leaves the
 *    turn where its replacement reads it: the store it resumes from, and the
 *    log that says the run had already worked.
 *  - An invocation home a lost runner left behind (the `finally` that removes
 *    it never ran) does not stop the next invocation of the same turn, on the
 *    same path, from starting the engine (stigmer#2613).
 *
 * No goldens: the first case reads the store and the log mid-call, the
 * second only that the turn completes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { getClaudeInvocationDir, getClaudeTranscriptDir } from "../../../../shared/workspace/platform-dir.js";
import { anthropicText, anthropicToolUses } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, resetClaudeScenarioState } from "../../__test-utils__/hermetic-claude.js";
import { engineSessionIdOf } from "../../engine-session-id.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

/** How often {@link until} looks, and how many times: the scripted clock fakes `Date`, so the bound counts looks. */
const POLL_MS = 50;
const POLLS = 400;

/** Resolves once `ready()` holds; bounded, naming what it waited for. */
async function until(what: string, ready: () => boolean): Promise<void> {
  for (let looks = 0; !ready(); looks += 1) {
    if (looks >= POLLS) throw new Error(`${what} did not happen within ${(POLL_MS * POLLS) / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Every file under `dir`, read whole and joined. */
function readAll(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((path) => (statSync(path).isDirectory() ? readAll(path) : readFileSync(path, "utf8")))
    .join("\n");
}

describe("ExecuteClaude hermetic — what a lost runner leaves", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("a call the gate let run is in the session's store and its log while it runs", async () => {
    const hold = mkdtempSync(join(tmpdir(), "stigmer-claude-held-"));
    const started = join(hold, "started");
    const release = join(hold, "release");
    const callId = "toolu_held_call";
    const record = claudeExecutionRecord({ message: "Run the long build.", autoApproveAll: true });
    let turn: ReturnType<typeof file.run> | undefined;
    try {
      turn = file.run(record, (conversation) =>
        conversation.toolResults.has(callId)
          ? anthropicText("The build is done.")
          : anthropicToolUses([
              {
                toolCallId: callId,
                toolName: "Bash",
                toolInput: { command: `touch '${started}'; while [ ! -f '${release}' ]; do sleep 0.1; done; echo built`, description: "Build" },
              },
            ]),
      );
      await until("the held call starting", () => existsSync(started));

      const logged = (): boolean => record.sessionEvents.some((event) => event.event.case === "agentToolUse" && event.event.value.id.endsWith(callId));
      await until("the running call reaching the session's log", logged);
      await until("the running call reaching the session's store", () => readAll(getClaudeTranscriptDir(FIXTURE.sessionId)).includes(callId));
      expect(record.sessionEvents.some((event) => event.event.case === "agentToolResult"), "and nothing of its result yet").toBe(false);

      writeFileSync(release, "");
      const invocation = await turn;
      expect(invocation.outcome.kind).toBe("returned");
      expect(record.lastFullStatus?.phase, "the turn completes").toBe(RunPhase.RUN_COMPLETED);
    } finally {
      // A failed look must not leave the turn running into the next case.
      writeFileSync(release, "");
      await turn?.catch(() => undefined);
      rmSync(hold, { recursive: true, force: true });
    }
  });

  it("a turn whose invocation home a lost runner left behind starts on the same path and completes", async () => {
    resetClaudeScenarioState(env);
    // What a runner killed mid-turn leaves: the engine's own copy of the
    // session in the invocation's home, and nothing in the store.
    const engineSession = engineSessionIdOf(FIXTURE.threadId);
    const left = join(getClaudeInvocationDir(FIXTURE.sessionId, FIXTURE.executionId, 0), "projects", engineSession);
    mkdirSync(left, { recursive: true });
    writeFileSync(
      join(left, `${engineSession}.jsonl`),
      `${JSON.stringify({ type: "user", uuid: "00000000-0000-4000-8000-00000000aaaa", sessionId: engineSession, message: { role: "user", content: "before the loss" } })}\n`,
    );
    const record = claudeExecutionRecord({ message: "Say hello." });
    const invocation = await file.resume(record, () => anthropicText("Hello."));
    expect(invocation.outcome.kind).toBe("returned");
    expect(record.lastFullStatus?.phase, `the turn completes: ${record.lastFullStatus?.error ?? ""}`).toBe(RunPhase.RUN_COMPLETED);
  });
});
