/**
 * The tool vocabulary's own suite: the reverse reading a grader names a
 * recorded call by, pinned with the engine names the runner's recorded
 * hermetic transcripts actually carry, and the table shapes the forward
 * reading depends on.
 *
 * The recorded names below are quoted from the runner's hermetic goldens
 * (`backend/services/runner/src/activities/execute-deep-agent/__tests__/hermetic/goldens/*.status.json`
 * and `.../execute-cursor/__tests__/hermetic/goldens/*.status.json`), each
 * case naming the golden it comes from. They are copied rather than read so
 * this package's suite reads nothing outside the package; a renamed engine
 * tool shows up there first, as a golden diff.
 */
import { describe, expect, it } from "vitest";

import {
  CLAUDE_TOOLS,
  CLAUDE_TOOL_ALIASES,
  CURSOR_HOOK_TOOL_COVERS,
  CURSOR_SDK_EXTRA_TOOLS,
  CURSOR_SDK_TOOL_COVERS,
  NATIVE_TOOL_COVERS,
  READ_ONLY_EVAL_TOOLS,
  claudeNameOf,
  isClaudeTool,
} from "../index.js";

describe("claudeNameOf on recorded native transcripts", () => {
  it.each([
    ["execute", "Bash", "approve.turn2"],
    ["read_file", "Read", "tool-call"],
    ["write_file", "Write", "inline-artifact.turn1"],
    ["edit_file", "Edit", "file-review-capture"],
    ["task", "Agent", "sub-agent-delegation"],
    ["write_todos", "TodoWrite", "write-todos"],
  ])("%s reads as %s (%s)", (engine, claude) => {
    expect(claudeNameOf("native", engine)).toBe(claude);
  });

  it("a native edit_file stays Edit and write_file stays Write whatever the file change", () => {
    expect(claudeNameOf("native", "edit_file", "add")).toBe("Edit");
    expect(claudeNameOf("native", "write_file", "modify")).toBe("Write");
  });

  it("ls reads as Glob, the first tool its entry covers", () => {
    expect(claudeNameOf("native", "ls")).toBe("Glob");
  });
});

describe("claudeNameOf on recorded Cursor transcripts", () => {
  it.each([
    ["shell", "Bash", "deny-and-retry.turn1"],
    ["read", "Read", "tool-call"],
    ["task", "Agent", "sub-agent-delegation"],
    ["updateTodos", "TodoWrite", "todo-write"],
  ])("%s reads as %s (%s)", (engine, claude) => {
    expect(claudeNameOf("cursor", engine)).toBe(claude);
  });

  it("edit, which writes and edits, reads by its file change (file-review-capture: a MODIFY of notes.md)", () => {
    expect(claudeNameOf("cursor", "edit", "modify")).toBe("Edit");
    expect(claudeNameOf("cursor", "edit")).toBe("Edit");
    expect(claudeNameOf("cursor", "edit", "add")).toBe("Write");
  });

  it("reads the SDK's names, not the hook's", () => {
    expect(claudeNameOf("cursor", "Shell"), "the hook's name is not recorded").toBe("Shell");
    expect(claudeNameOf("cursor", "semSearch")).toBe("Grep");
  });

  it("an engine extra keeps its own name", () => {
    for (const extra of CURSOR_SDK_EXTRA_TOOLS) expect(claudeNameOf("cursor", extra)).toBe(extra);
  });

  it("a bare MCP tool name the table does not carry keeps its own name (mcp-tool-call: search_docs)", () => {
    expect(claudeNameOf("cursor", "search_docs")).toBe("search_docs");
    expect(claudeNameOf("native", "search_docs")).toBe("search_docs");
  });
});

describe("the tables", () => {
  it("cover only Claude tools, and never Skill, which no engine tool is", () => {
    for (const table of [NATIVE_TOOL_COVERS, CURSOR_HOOK_TOOL_COVERS, CURSOR_SDK_TOOL_COVERS]) {
      for (const [name, covers] of table) {
        expect(covers.length, name).toBeGreaterThan(0);
        for (const t of covers) {
          expect(isClaudeTool(t), `${name} covers ${t}`).toBe(true);
          expect(t, name).not.toBe("Skill");
        }
      }
    }
  });

  it("keep the engine extras out of the SDK table", () => {
    for (const extra of CURSOR_SDK_EXTRA_TOOLS) expect(CURSOR_SDK_TOOL_COVERS.has(extra), extra).toBe(false);
  });

  it("every Claude tool but Agent's older spelling is a name, and Skill is one", () => {
    expect(isClaudeTool("Skill")).toBe(true);
    expect(isClaudeTool("Task"), "an alias, not a name").toBe(false);
    expect(CLAUDE_TOOL_ALIASES.get("Task")).toBe("Agent");
    expect(new Set(CLAUDE_TOOLS).size).toBe(CLAUDE_TOOLS.length);
  });
});

describe("READ_ONLY_EVAL_TOOLS", () => {
  it("is the format's read-only set, in its order", () => {
    expect(READ_ONLY_EVAL_TOOLS).toEqual([
      "Read",
      "Glob",
      "Grep",
      "NotebookRead",
      "Skill",
      "AskUserQuestion",
      "Agent",
      "TodoWrite",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskUpdate",
      "TaskStop",
    ]);
  });

  it("holds names Stigmer runs nothing for, which are not Claude tools here", () => {
    const notRun = READ_ONLY_EVAL_TOOLS.filter((t) => !isClaudeTool(t));
    expect(notRun).toEqual(["NotebookRead", "AskUserQuestion", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop"]);
  });
});
