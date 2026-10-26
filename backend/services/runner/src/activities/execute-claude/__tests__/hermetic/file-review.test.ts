/**
 * Hermetic goldens: file review on a Claude turn keeps what git cannot,
 * on the real engine: the gate records a file's bytes before the engine
 * writes it (`gate.ts`), and the runtime captures the change from them, as
 * the native engine's backend lets it.
 *
 *  - A write to a git-ignored path in a git workspace flows, and comes back
 *    in the turn's change set beside the tracked one.
 *  - A write in a workspace that is no git repository flows and comes back
 *    the same way.
 *  - A write to a secret-like ignored path is refused, never written, and
 *    listed in the change set as a change nobody can review.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/file-review.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { FileReviewBlockReason } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { secretBlockMessage } from "../../../../shared/file-edit-policy.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

/** Each `Write` once, in order, then `closing`; a file that exists is read first, as the engine requires before it overwrites one. */
function writes(list: readonly { readonly id: string; readonly path: string; readonly content: string; readonly readFirst?: boolean }[], closing: string): WireScript {
  const calls = list.flatMap((step) => [
    ...(step.readFirst === true ? [{ id: `${step.id}_read`, name: "Read", input: { file_path: step.path } }] : []),
    { id: step.id, name: "Write", input: { file_path: step.path, content: step.content } },
  ]);
  return (c: WireConversation) => {
    const next = calls.find((call) => !c.issued.has(call.id));
    return next === undefined ? anthropicText(closing) : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }]);
  };
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

/** The changes the turn's change set holds, from the review ledger's candidate. */
function capturedChanges(record: ExecutionRecord) {
  const events = record.rowsOf(record.lastFullStatus!).fileReviewEventStream?.events ?? [];
  return events.flatMap((event) => (event.payload.case === "candidateCaptured" ? event.payload.value.changes : []));
}

/** The paths the turn's change set holds. */
function capturedPaths(record: ExecutionRecord): string[] {
  return capturedChanges(record).map((change) => change.pathAfter || change.pathBefore);
}

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

describe("ExecuteClaude hermetic — file review beyond git", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("a git-ignored write flows and is kept for review beside a tracked one; a secret-like one is refused and listed as unreviewable", async () => {
    const repo = join(env.workspaceRootDir, "repos", "app");
    initGitWorkspace(repo, { "notes.md": "# Notes\n", ".gitignore": "dist/\n.env.local\n" });
    mkdirSync(join(repo, "dist"), { recursive: true });
    writeFileSync(join(repo, "dist", "out.js"), "old();\n");
    const record = claudeExecutionRecord({ message: "Build it.", resources: [localPathEntry("app", repo)], fileReview: true });
    const invocation = await file.run(
      record,
      writes(
        [
          { id: "toolu_tracked", path: join(repo, "notes.md"), content: "# Notes\nbuilt\n", readFirst: true },
          { id: "toolu_ignored", path: join(repo, "dist", "out.js"), content: "built();\n", readFirst: true },
          { id: "toolu_secret", path: join(repo, ".env.local"), content: "TOKEN=1\n" },
        ],
        "Built.",
      ),
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    expect(record.waitingToolCalls(), "the review is on the file card, never a gate row").toHaveLength(0);
    expect(readFileSync(join(repo, "dist", "out.js"), "utf8")).toBe("built();\n");
    expect(existsSync(join(repo, ".env.local")), "the secret was never written").toBe(false);
    const secret = record.toolCalls().find((r) => r.id === "toolu_secret")!;
    expect([secret.status, secret.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, secretBlockMessage("Write", "/.env.local")]);
    expect(capturedPaths(record).sort()).toEqual([".env.local", "dist/out.js", "notes.md"]);
    const changes = capturedChanges(record);
    expect(changes.find((change) => change.pathAfter === ".env.local" || change.pathBefore === ".env.local")?.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
    expect(changes.find((change) => change.pathAfter === "dist/out.js")?.diffComplete).toBe(true);
    await goldens(record, "review-ignored");
  });

  it("a write in a workspace that is no git repository flows and is kept for review", async () => {
    const record = claudeExecutionRecord({ message: "Write the report.", fileReview: true });
    const invocation = await file.run(record, (c) => {
      mkdirSync(sessionWorkspaceDir(env), { recursive: true });
      return writes([{ id: "toolu_plain", path: join(sessionWorkspaceDir(env), "report.md"), content: "# Report\n" }], "Written.")(c);
    });

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    expect(record.waitingToolCalls()).toHaveLength(0);
    expect(readFileSync(join(sessionWorkspaceDir(env), "report.md"), "utf8")).toBe("# Report\n");
    expect(capturedPaths(record)).toEqual(["report.md"]);
  });
});
