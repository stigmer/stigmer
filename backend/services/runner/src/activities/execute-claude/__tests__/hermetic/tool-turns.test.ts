/**
 * Hermetic goldens: a Claude turn's tool calls, on the real engine, as the
 * session's log and rows hold them.
 *
 *  - A file edit under file review in a git workspace flows (the gate's
 *    capture rule, `shared/file-edit-policy.ts`) and comes back as one change
 *    set under this engine's file-review id, with the edit applied.
 *  - A to-do list the model writes with `TodoWrite` lands as the session's
 *    to-do rows through the shared projection; the engine keeps the tool
 *    behind `ToolSearch`, so the model loads it first, as a real one does.
 *  - The shell, under "trust this whole run", runs through the host's shell:
 *    its parent is the host (here, the test process the loopback host runs
 *    in), never the engine, and its environment carries none of the
 *    engine's variables and no credential.
 *  - The shell under the default is refused with the one sentence this
 *    engine has until its pause lands, and nothing runs.
 *  - On an unattended lane the same call is skipped with the shared
 *    sentence, as every engine's gate skips it, and nothing runs.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/tool-turns.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { unattendedSkipMessage } from "../../../../shared/approval-policy.js";
import { ToolCallStatus, TodoStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";
import { PROGRESS_CAPTURE_MIN_INTERVAL_MS } from "../../../../shared/filereview/progress.js";
import { NEEDS_APPROVAL_MESSAGE } from "../../gate.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

/** A script that makes each call once, in order, then answers `closing`. */
function calls(steps: readonly { readonly id: string; readonly name: string; readonly input: Record<string, unknown> }[], closing: string): WireScript {
  return (c: WireConversation) => {
    const next = steps.find((step) => !c.issued.has(step.id));
    return next === undefined ? anthropicText(closing) : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }]);
  };
}

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

describe("ExecuteClaude hermetic — tool turns", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("a file edit under review flows, is applied, and comes back as one change set under the engine's id", async () => {
    const repo = join(env.workspaceRootDir, "repos", "notes");
    initGitWorkspace(repo, { "notes.md": "# Notes\n\nfirst\n" });
    const record = claudeExecutionRecord({ message: "Append a second line to notes.md.", resources: [localPathEntry("notes", repo)], fileReview: true });

    const script = calls(
      [
        { id: "toolu_edit_read", name: "Read", input: { file_path: join(repo, "notes.md") } },
        { id: "toolu_edit_1", name: "Edit", input: { file_path: join(repo, "notes.md"), old_string: "first\n", new_string: "first\nsecond\n" } },
      ],
      "Appended.",
    );
    const invocation = await file.run(record, (c) => {
      // Past the progress strip's floor once the edit has landed, so the
      // turn's last write carries the strip as a person would see it.
      if (c.toolResults.has("toolu_edit_1")) clock.tick(PROGRESS_CAPTURE_MIN_INTERVAL_MS);
      return script(c);
    });

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    expect(readFileSync(join(repo, "notes.md"), "utf-8")).toBe("# Notes\n\nfirst\nsecond\n");
    const edit = record.toolCalls().find((row) => row.id === "toolu_edit_1")!;
    expect([edit.name, edit.status]).toEqual(["Edit", ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(record.waitingToolCalls(), "the review is on the file card, never a gate row").toHaveLength(0);
    const events = record.rowsOf(record.lastFullStatus!).fileReviewEventStream?.events ?? [];
    expect(events.map((e) => e.payload.case)).toEqual(["baselineCaptured", "candidateCaptured"]);
    const [baseline, candidate] = [events[0]!.payload, events[1]!.payload];
    expect(baseline.case === "baselineCaptured" ? baseline.value.harnessId : undefined).toBe("claude");
    expect(candidate.case === "candidateCaptured" ? candidate.value.changes.map((c) => c.pathAfter) : undefined).toEqual(["notes.md"]);
    expect(record.lastFullStatus!.fileChangeProgress?.filesChanged).toBe(1);
  });

  it("a to-do list lands as the session's to-do rows", async () => {
    const record = claudeExecutionRecord({ message: "Plan the work." });
    const todos = [
      { content: "Read the fixture", status: "pending", activeForm: "Reading the fixture" },
      { content: "Summarise it", status: "in_progress", activeForm: "Summarising it" },
    ];
    const invocation = await file.run(
      record,
      calls(
        [
          { id: "toolu_todo_load", name: "ToolSearch", input: { query: "select:TodoWrite", max_results: 1 } },
          { id: "toolu_todo_1", name: "TodoWrite", input: { todos } },
        ],
        "Planned.",
      ),
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    expect(
      record.toolCalls().map((row) => [row.name, row.status]),
      "the tool search the engine keeps the list behind is one the turn offers",
    ).toEqual([
      ["ToolSearch", ToolCallStatus.TOOL_CALL_COMPLETED],
      ["TodoWrite", ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);
    const rows = record.rowsOf(record.lastFullStatus!);
    expect(Object.values(rows.todos).map((t) => [t.content, t.status])).toEqual([
      ["Read the fixture", TodoStatus.TODO_PENDING],
      ["Summarise it", TodoStatus.TODO_IN_PROGRESS],
    ]);
    await goldens(record, "todo-list");
  });

  it("the shell runs in the host under a trusted run: the host's child, with none of the engine's environment", async () => {
    const record = claudeExecutionRecord({ message: "Show the environment.", autoApproveAll: true });
    const hostKeysBefore = new Set(Object.keys(process.env));
    const command = 'echo "ppid=$PPID"; env | cut -d= -f1 | sort | tr "\\n" " "; echo; echo made > made.txt';
    const invocation = await file.run(record, calls([{ id: "toolu_shell_ok", name: "Bash", input: { command, description: "Show the environment" } }], "Shown."));

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const row = record.toolCalls().find((r) => r.id === "toolu_shell_ok")!;
    expect([row.name, row.status]).toEqual(["Bash", ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(row.result).toContain(`ppid=${process.pid}`);
    const names = (/\n(.*)\n/.exec(row.result)?.[1] ?? "").trim().split(" ");
    expect(names).toContain("PATH");
    // The shell holds the host's environment (here, the test process's) and
    // what a shell sets itself; nothing of the engine's own.
    const shellOwn = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
    expect(names.filter((n) => !hostKeysBefore.has(n) && !shellOwn.has(n)), "only the host's environment reaches the shell").toEqual([]);
    for (const engineOnly of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PROJECT_DIR_NAME", "CLAUDE_AGENT_SDK_VERSION"]) {
      expect(names, `${engineOnly} reached the shell`).not.toContain(engineOnly);
    }
    const added = Object.keys(process.env).filter((k) => !hostKeysBefore.has(k));
    expect(added, "a Claude turn writes nothing into the host's own environment").toEqual([]);
    expect(existsSync(join(sessionWorkspaceDir(env), "made.txt")), "it ran in the workspace").toBe(true);
  });

  it("the shell under the default is refused, and nothing runs", async () => {
    const record = claudeExecutionRecord({ message: "Clean up." });
    const invocation = await file.run(record, calls([{ id: "toolu_shell_no", name: "Bash", input: { command: "echo ran > ran.txt", description: "Clean up" } }], "I could not run that."));

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const row = record.toolCalls().find((r) => r.id === "toolu_shell_no")!;
    expect([row.status, row.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, NEEDS_APPROVAL_MESSAGE]);
    expect(file.wire().conversations.at(-1)!.toolResults.get("toolu_shell_no")?.text, "the model reads the same sentence").toContain(NEEDS_APPROVAL_MESSAGE);
    expect(existsSync(join(sessionWorkspaceDir(env), "ran.txt"))).toBe(false);
    await goldens(record, "shell-refused");
  });

  it("on an unattended lane the call is skipped with the shared sentence, and nothing runs", async () => {
    const record = claudeExecutionRecord({ message: "Clean up.", approvalMode: ApprovalMode.UNATTENDED });
    const invocation = await file.run(record, calls([{ id: "toolu_shell_skip", name: "Bash", input: { command: "echo ran > ran.txt", description: "Clean up" } }], "Skipped it."));

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    expect(file.wire().conversations.at(-1)!.toolResults.get("toolu_shell_skip")?.text).toContain(unattendedSkipMessage("Bash"));
    expect(existsSync(join(sessionWorkspaceDir(env), "ran.txt"))).toBe(false);
    expect(FIXTURE.executionId).toBe(record.executionId);
    await goldens(record, "unattended-skip");
  });
});
