/**
 * Hermetic: a Cursor turn returns what the agent saved in its outputs folder
 * as Files, through the whole `ExecuteCursor` activity, the runner's gate
 * installed in the workspace and its real bash hook.
 *
 * One turn with file review on (capture mode) in a git workspace. The
 * scripted agent does what the SDK does for each write: it runs the hook,
 * then writes the file itself, through the workspace's `.stigmer` link.
 * Pinned:
 *   - the hook lets both outputs through in capture mode, as it lets the
 *     repository's edit through;
 *   - both reports, one name in two folders, are registered at their output
 *     paths with the bytes written, before the turn's final write;
 *   - the turn's change set holds the repository's edit and no output.
 * Execution conformance drives the native engine only, so this is the
 * Cursor engine's proof short of a live run.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { hasBash, hookWrite } from "../../__test-utils__/cursor-hook-harness.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  runWorkspaceHook,
} from "../../__test-utils__/hermetic-cursor.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { hermeticUploads, stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

const AGENT_ID = "agent-hermetic-outputs-0001";
const RUN_ID = "run-hermetic-outputs-0001";
const NORTH = "# North\n\nRevenue up.\n";
const SOUTH = "# South\n\nRevenue flat.\n";
const NOTES_AFTER = "first\nsecond\n";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe.skipIf(!hasBash)("ExecuteCursor hermetic — the outputs folder", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("returns the agent's outputs as Files before the final write, and reviews only the repository's edit", async () => {
    const repo = join(env.workspaceRootDir, "repos", "ledger");
    initGitWorkspace(repo, { "notes.md": "first\n" });
    const hookDecisions: string[] = [];
    const saveThroughLink = (relative: string, content: string) => {
      const path = join(repo, ".stigmer", "outputs", relative);
      hookDecisions.push(runWorkspaceHook(repo, hookWrite(path, content)).permission);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");
    };

    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Saving the summaries.")),
          step.effect("save the north summary", () => saveThroughLink("reports/north/summary.md", NORTH)),
          step.event(ev.toolCall("call-north", "edit", "completed", { path: ".stigmer/outputs/reports/north/summary.md", content: NORTH }, "ok")),
          step.effect("save the south summary", () => saveThroughLink("reports/south/summary.md", SOUTH)),
          step.event(ev.toolCall("call-south", "edit", "completed", { path: ".stigmer/outputs/reports/south/summary.md", content: SOUTH }, "ok")),
          step.effect("edit notes.md", () => {
            hookDecisions.push(runWorkspaceHook(repo, hookWrite(join(repo, "notes.md"), NOTES_AFTER)).permission);
            writeFileSync(join(repo, "notes.md"), NOTES_AFTER, "utf-8");
          }),
          step.event(ev.toolCall("call-notes", "edit", "completed", { path: "notes.md", content: NOTES_AFTER }, "ok")),
          step.event(ev.assistant("Saved both summaries.")),
          step.turnEnded({ inputTokens: 2_400, outputTokens: 70, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: "Done", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({
      message: "Write the regional summaries.",
      resources: [localPathEntry("ledger", repo)],
      fileReview: true,
    });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario);

    expect(hookDecisions, "every write flows in capture mode").toEqual(["allow", "allow", "allow"]);
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.registeredOutputs.map((o) => [o.outputPath, o.contentSha256])).toEqual([
      ["reports/north/summary.md", sha256(NORTH)],
      ["reports/south/summary.md", sha256(SOUTH)],
    ]);
    for (const output of record.registeredOutputs) {
      const sent = new TextDecoder().decode(hermeticUploads.get(`/${output.uploadRef}`));
      expect(sent, output.outputPath).toBe(output.outputPath.includes("north") ? NORTH : SOUTH);
      expect(output.persistedBefore, "registered before the final write").toBeLessThan(record.persisted.length);
    }
    expect(record.persisted[record.persisted.length - 1]?.phase).toBe(RunPhase.RUN_COMPLETED);

    const events = record.rows?.fileReviewEventStream?.events ?? [];
    const candidate = events.find((e) => e.payload.case === "candidateCaptured")?.payload;
    if (candidate?.case !== "candidateCaptured") throw new Error("the repository's edit was not captured");
    expect(candidate.value.changes.map((c) => c.pathAfter), "the edit, and no output").toEqual(["notes.md"]);
  });
});
