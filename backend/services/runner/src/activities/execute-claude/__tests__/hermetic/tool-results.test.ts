/**
 * Hermetic capture: what the Claude engine's built-in tools answer, as the
 * session's rows hold them, on the real engine.
 *
 * Why it matters: the console, the terminal UI and the CLI read a tool's
 * result through one view model (`@stigmer/client` `normalizeToolResult`),
 * pinned by the shared fixtures in `test/fixtures/tool-view/`. Those
 * fixtures' Claude cases are this capture's rows, never written by hand, so a
 * change in what the engine answers (its read frame, its shell's exit line)
 * shows here first and the fixtures follow (`tool-view-fixtures.test.ts`
 * holds them equal).
 *
 * One trusted run makes each call once: the shell succeeding and failing,
 * a write, a read of what it wrote, an edit, a file search and a content
 * search. The workspace's own path is written `/workspace`, as the fixtures
 * write it.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/tool-results.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { anthropicText, anthropicToolUses, type WireConversation } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";
import { capturedCase } from "../../__test-utils__/tool-view-capture.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

describe("ExecuteClaude hermetic — tool results", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("captures each built-in's answer as its row holds it", async () => {
    const workspace = sessionWorkspaceDir(env);
    const notes = join(workspace, "notes.md");
    const steps = [
      { id: "toolu_shell_ok", name: "Bash", input: { command: "printf 'one\\ntwo\\n'", description: "Print two lines" } },
      { id: "toolu_shell_fail", name: "Bash", input: { command: "echo broken >&2; exit 3", description: "Fail on purpose" } },
      { id: "toolu_write", name: "Write", input: { file_path: notes, content: "# Notes\n\nfirst\n" } },
      { id: "toolu_read", name: "Read", input: { file_path: notes } },
      { id: "toolu_edit", name: "Edit", input: { file_path: notes, old_string: "first\n", new_string: "first\nsecond\n" } },
      { id: "toolu_glob", name: "Glob", input: { pattern: "*.md" } },
      { id: "toolu_grep", name: "Grep", input: { pattern: "second", output_mode: "content" } },
    ];
    const record = claudeExecutionRecord({ message: "Exercise the tools.", autoApproveAll: true });
    const invocation = await file.run(record, (c: WireConversation) => {
      const next = steps.find((step) => !c.issued.has(step.id));
      return next === undefined ? anthropicText("Done.") : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }]);
    });

    expect((invocation.outcome as { value?: Record<string, unknown> }).value?.phase).toBe("RUN_COMPLETED");
    const rows = record.toolCalls();
    expect(rows.map((row) => [row.id, row.status])).toEqual(
      steps.map((step) => [step.id, step.id === "toolu_shell_fail" ? ToolCallStatus.TOOL_CALL_FAILED : ToolCallStatus.TOOL_CALL_COMPLETED]),
    );
    const cases = rows.map((row) => capturedCase(row, workspace));
    await expect(`${JSON.stringify(cases, null, 2)}\n`).toMatchFileSnapshot("./goldens/tool-results.cases.json");
  });
});
