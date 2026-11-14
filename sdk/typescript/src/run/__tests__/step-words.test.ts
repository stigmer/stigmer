// Proves each step's own line (../step-words.ts): every kind reads in the
// present while it runs, the past once it returned and its failed form when
// it failed (an error result, a denial, or a command that exited non-zero);
// a file line names the file and keeps its folder beside it; a search names
// its pattern and the folder it searched, a search by file name says it found
// files; a command reads as the agent's own description when it wrote one;
// a call its turn stopped reads as one that couldn't, one waiting for a yes
// as what the agent wants to do; a connected app's tool
// and a tool the kit does not know read as their own
// names, humanized, with the app beside them; and the one word table the
// working phrase and the settled roll-up also read.

import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/session-log";
import { humanizeToolName, KIND_WORDS, stepPhrase, stepTense } from "../step-words";

type Outcome = "running" | "returned" | "failed" | "denied" | "stopped" | "waiting";

function call(name: string, input: JsonObject, outcome: Outcome = "returned", text = "ok", mcpServerName = ""): ToolUse {
  const returned = outcome === "returned" || outcome === "failed";
  return {
    kind: "tool_use",
    id: `run_1.tc-${name}`,
    runId: "run_1",
    threadId: "",
    name,
    mcpServerName,
    input,
    evaluatedPermission: "",
    state: outcome === "running" ? "running" : outcome === "denied" ? "denied" : outcome === "failed" ? "failed" : outcome === "stopped" ? "stopped" : outcome === "waiting" ? "waiting" : "completed",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: returned ? { id: `run_1.tc-${name}.r`, text, isError: outcome === "failed", processedAt: "2026-07-20T11:00:01.000Z" } : undefined,
    fullOutput: undefined,
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: "2026-07-20T11:00:00.000Z",
  };
}

describe("stepPhrase", () => {
  it("reads a file step in each tense, naming the file and keeping its folder beside the line", () => {
    const path = { path: "src/billing/invoice.ts" };
    expect(stepPhrase(call("edit_file", path, "running"))).toEqual({ text: "Editing invoice.ts", tense: "present", folder: "src/billing", app: "" });
    expect(stepPhrase(call("edit_file", path))).toMatchObject({ text: "Edited invoice.ts", tense: "past", folder: "src/billing" });
    expect(stepPhrase(call("edit_file", path, "failed", "not found"))).toMatchObject({ text: "Couldn't edit invoice.ts", tense: "failed" });
    expect(stepPhrase(call("Read", { file_path: "/notes.md" })).text).toBe("Read notes.md");
    expect(stepPhrase(call("Read", { file_path: "/notes.md" })).folder).toBe("");
    expect(stepPhrase(call("write_file", { path: "/.stigmer/outputs/audit.md" }))).toMatchObject({ text: "Wrote audit.md", folder: "/.stigmer/outputs" });
    expect(stepPhrase(call("delete_file", { path: "legacy.ts" }))).toMatchObject({ text: "Deleted legacy.ts", folder: "" });
    expect(stepPhrase(call("write_file", {})).text).toBe("Wrote a file");
  });

  it("names a search's pattern and the folder it searched, and says a search by name found files", () => {
    expect(stepPhrase(call("grep", { pattern: "round(", path: "src/billing/" })).text).toBe("Searched for round( in src/billing");
    expect(stepPhrase(call("Grep", { pattern: "round(" }, "running")).text).toBe("Searching for round(");
    expect(stepPhrase(call("grep", { path: "src" })).text).toBe("Searched");
    expect(stepPhrase(call("glob", { pattern: "**/*.test.ts" })).text).toBe("Found files matching **/*.test.ts");
    expect(stepPhrase(call("Glob", { pattern: "*.md" }, "running")).text).toBe("Finding files matching *.md");
    expect(stepPhrase(call("find_files", {}, "failed", "no")).text).toBe("Couldn't find files");
    expect(stepPhrase(call("ls", { path: "src/billing" })).text).toBe("Looked in src/billing");
    expect(stepPhrase(call("ls", { path: "/workspace/app/src/billing/" })).text).toBe("Looked in src/billing");
  });

  it("reads a command as the agent's description when it wrote one, and fails it on a non-zero exit", () => {
    expect(stepPhrase(call("execute", { command: "npm test" })).text).toBe("Ran a command");
    expect(stepPhrase(call("execute", { command: "npm test" }, "running")).text).toBe("Running a command");
    expect(stepPhrase(call("Bash", { command: "npm test", description: "  Run the   tests " })).text).toBe("Run the tests");
    const exited = call("execute", { command: "npm test" }, "returned", "1 failed\n[Command failed with exit code 1]");
    expect(stepPhrase(exited)).toMatchObject({ text: "Command failed", tense: "failed" });
    expect(stepTense(call("execute", { command: "true" }, "returned", "[Command succeeded]"))).toBe("past");
    expect(stepTense(call("execute", { command: "x" }, "failed", "boom"))).toBe("failed");
  });

  it("leaves a background command's tense to its start, never its exit", () => {
    const started = { ...call("execute", { command: "npm run dev", background: true }, "returned", "Started"), background: { state: "exited", timeoutSeconds: 0, startedAt: "", liveOutput: "", stopRequested: false, exitCode: 1, output: "", endedAt: "" } } as unknown as ToolUse;
    expect(stepTense(started)).toBe("past");
  });

  it("reads a call its turn stopped before it returned as one that couldn't, never as still running", () => {
    expect(stepPhrase(call("delete_file", { path: "src/x.ts" }, "stopped"))).toMatchObject({ text: "Couldn't delete x.ts", tense: "stopped", folder: "src" });
    expect(stepPhrase(call("execute", { command: "npm test" }, "stopped")).text).toBe("Command failed");
    expect(stepPhrase(call("glob", { pattern: "*.md" }, "stopped")).text).toBe("Couldn't find files matching *.md");
  });

  it("reads a call waiting for a person's yes as what the agent wants to do", () => {
    expect(stepPhrase(call("write_file", { path: "src/billing/rounding.ts" }, "waiting"))).toMatchObject({ text: "Wants to write rounding.ts", tense: "present", folder: "src/billing" });
    expect(stepPhrase(call("execute", { command: "git push" }, "waiting")).text).toBe("Wants to run a command");
    expect(stepPhrase(call("execute", { command: "git push", description: "Push the fix" }, "waiting")).text).toBe("Push the fix");
    expect(stepPhrase(call("glob", { pattern: "*.md" }, "waiting")).text).toBe("Wants to find files matching *.md");
    expect(stepPhrase(call("create_issue", {}, "waiting", "", "tracker")).text).toBe("Create issue");
  });

  it("reads a denied call as failed", () => {
    expect(stepPhrase(call("write_file", { path: "a.ts" }, "denied"))).toMatchObject({ text: "Couldn't write a.ts", tense: "failed" });
  });

  it("reads a connected app's tool and an unknown tool as their own names, the app beside them", () => {
    expect(stepPhrase(call("create_issue", { title: "x" }, "returned", "ok", "issue-tracker"))).toEqual({ text: "Create issue", tense: "past", folder: "", app: "issue-tracker" });
    expect(stepPhrase(call("lookupOrder", {}, "running")).text).toBe("Lookup order");
  });

  it("reads the remaining kinds from the table in every tense", () => {
    expect(stepPhrase(call("web_fetch", { url: "https://example.com/a" })).text).toBe("Read example.com");
    expect(stepPhrase(call("WebSearch", { query: "rounding" }, "running")).text).toBe("Searching the web for rounding");
    expect(stepPhrase(call("task", { description: "map credit notes" }, "running")).text).toBe("A helper is working on map credit notes");
    expect(stepPhrase(call("task", { description: "map credit notes" })).text).toBe("A helper worked on map credit notes");
    expect(stepPhrase(call("think", {})).text).toBe("Thought it through");
    expect(stepPhrase(call("write_todos", {})).text).toBe("Updated the plan");
  });
});

describe("humanizeToolName", () => {
  it("reads snake, camel and kebab names alike, in sentence case, and names nothing as a tool", () => {
    expect(humanizeToolName("create_issue")).toBe("Create issue");
    expect(humanizeToolName("createIssue")).toBe("Create issue");
    expect(humanizeToolName("Create-Issue")).toBe("Create issue");
    expect(humanizeToolName("list_merge_requests")).toBe("List merge requests");
    expect(humanizeToolName("__")).toBe("A tool");
  });
});

describe("KIND_WORDS", () => {
  it("gives every kind a present, past and failed form, and counts only the kinds a roll-up names", () => {
    for (const words of Object.values(KIND_WORDS)) {
      for (const form of [words.present, words.past, words.failed]) expect(form.every((part) => part !== "")).toBe(true);
    }
    const counted = Object.entries(KIND_WORDS).filter(([, words]) => words.counted !== undefined).map(([kind]) => kind);
    expect(counted.sort()).toEqual(["fetch", "file_delete", "file_edit", "file_read", "file_write", "list", "mcp", "search", "shell", "skill", "unknown", "web_search"]);
  });
});
