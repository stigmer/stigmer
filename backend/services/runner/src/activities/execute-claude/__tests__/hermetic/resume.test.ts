/**
 * Hermetic golden: a Claude session's next message resumes the conversation
 * from the session store, on the real engine, with the runner keeping it on
 * its own disk (`checkpointerType: "sqlite"`, the file backing).
 *
 * What the resume may not depend on, each taken away here:
 *
 *  - the engine's per-invocation configuration directory, which every turn
 *    removes at its end (`turn.ts`), so a resume never finds it;
 *  - the workspace's path: the second message runs with the workspace under
 *    another root, and the engine still finds its conversation, because the
 *    store is keyed by the thread and the engine's project key is fixed
 *    (`engine-env.ts`), never derived from the working directory.
 *
 * The second turn's first model call carries the first turn's message and
 * answer, and the second message once.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { getClaudeEngineDir, getClaudeTranscriptDir } from "../../../../shared/workspace/platform-dir.js";
import { anthropicText, saidByUser } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

const FIRST = "Remember the word heron.";
const FIRST_ANSWER = "Noted: heron.";
const SECOND = "Which word did I give you?";

describe("ExecuteClaude hermetic — a session resumes from its store", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("the next message resumes the conversation with the engine's configuration gone and the workspace moved", async () => {
    const first = claudeExecutionRecord({ message: FIRST });
    const one = await file.run(first, () => anthropicText(FIRST_ANSWER));
    expect((one.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(readdirSync(getClaudeEngineDir(FIXTURE.sessionId)), "only the transcripts outlive the turn").toEqual(["transcripts"]);
    expect(existsSync(getClaudeTranscriptDir(FIXTURE.sessionId))).toBe(true);

    const second = claudeExecutionRecord({ message: SECOND, executionId: "run_claude_0002" });
    const before = file.wire().conversations.length;
    const two = await file.resume(second, () => anthropicText("You gave me heron."), {}, { workspaceRootDir: join(env.workspaceRootDir, "moved") });

    expect((two.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    const resumed = file.wire().conversations[before]!;
    expect(saidByUser(resumed, FIRST), "the first message is in the resumed conversation").toBe(true);
    expect(JSON.stringify(resumed.body)).toContain(FIRST_ANSWER);
    expect(resumed.userTexts.filter((text) => text.includes(SECOND)), "the second message, once").toHaveLength(1);
    expect(resumed.userTexts.filter((text) => text.includes(FIRST)), "the first message, once").toHaveLength(1);
  });
});
