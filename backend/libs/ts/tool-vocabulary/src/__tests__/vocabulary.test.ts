/**
 * The tool vocabulary's own suite: the reverse reading a grader names a
 * recorded call by, pinned with the engine names the runner's recorded
 * hermetic transcripts actually carry, and the table shapes the forward
 * reading depends on.
 *
 * The recorded names below are quoted from the runner's hermetic goldens
 * (`backend/services/runner/src/activities/execute-deep-agent/__tests__/hermetic/goldens/*.status.json`
 * and `.../execute-claude/__tests__/hermetic/goldens/*.rows.json`), each
 * case naming the golden it comes from. They are copied rather than read so
 * this package's suite reads nothing outside the package; a renamed engine
 * tool shows up there first, as a golden diff.
 */
import { describe, expect, it } from "vitest";

import {
  CLAUDE_TOOLS,
  CLAUDE_TOOL_ALIASES,
  CLAUDE_TOOL_COVERS,
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
    expect(claudeNameOf("stigmer", engine)).toBe(claude);
  });

  it("ls reads as Glob, the first tool its entry covers", () => {
    expect(claudeNameOf("stigmer", "ls")).toBe("Glob");
  });

  it("a bare MCP tool name the table does not carry keeps its own name (mcp-tool-call: search_docs)", () => {
    expect(claudeNameOf("stigmer", "search_docs")).toBe("search_docs");
  });
});

describe("claudeNameOf on recorded Claude transcripts", () => {
  it.each([
    ["Bash", "shell-approved"],
    ["Glob", "own-skills"],
    ["TodoWrite", "todo-list"],
    ["Agent", "saved-subagent"],
    ["Skill", "plugin-skill"],
    ["ToolSearch", "todo-list"],
  ])("%s reads as itself (%s)", (name) => {
    expect(claudeNameOf("claude", name)).toBe(name);
  });

  it("names each Claude tool but Skill in its table, Skill and the engine's tool search reading as themselves unlisted", () => {
    expect([...CLAUDE_TOOL_COVERS.keys()]).toEqual(CLAUDE_TOOLS.filter((tool) => tool !== "Skill"));
    expect(CLAUDE_TOOL_COVERS.has("ToolSearch")).toBe(false);
  });
});

describe("the tables", () => {
  it("cover only Claude tools, and never Skill, which no engine tool is", () => {
    for (const table of [NATIVE_TOOL_COVERS, CLAUDE_TOOL_COVERS]) {
      for (const [name, covers] of table) {
        expect(covers.length, name).toBeGreaterThan(0);
        for (const t of covers) {
          expect(isClaudeTool(t), `${name} covers ${t}`).toBe(true);
          expect(t, name).not.toBe("Skill");
        }
      }
    }
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
