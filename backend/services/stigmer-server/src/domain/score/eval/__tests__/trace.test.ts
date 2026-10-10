/**
 * Pins the eval's transcript reader (trace.ts) over a native and a Cursor
 * transcript: engine names read as Claude's (Write for a file the run
 * created, Edit for one it changed), an MCP call as
 * `mcp__plugin_<plugin>_<server>__<tool>`, a read of a mounted skill's
 * SKILL.md (the workspace link and the platform directory) as `Skill`,
 * the trace as Claude Code's JSON lines, the final message, created paths
 * from the ledger's last candidate per change set, contents inline, read
 * back from the artifact store, binary, deleted or unreadable, and a run
 * with no capture event read as "not recorded". A tool message reads as
 * a user line of its result; a message type this server does not know
 * (an engine newer than it) is left out as a system message is, never
 * answered in place of the trace; a run with no assistant text has an
 * empty final message; a change with no captured body reads as empty
 * text.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeKind,
  FileReviewEventType,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CapturedFileChangeSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { SKILL_READ_PATH, evalTraceOf } from "../trace.js";
import type { EvalTraceDeps } from "../trace.js";

function call(
  id: string,
  name: string,
  args: Record<string, string>,
  extra: { readonly error?: string; readonly mcpServerSlug?: string } = {},
): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    args,
    result: `result of ${id}`,
    ...extra,
  });
}

function candidate(changeSetId: string, changes: CapturedFileChange[]) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.CANDIDATE_CAPTURED,
    payload: { case: "candidateCaptured", value: { changeSetId, changes } },
  });
}

function baseline(changeSetId: string) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.BASELINE_CAPTURED,
  });
}

function runOf(
  calls: ToolCall[],
  events = [baseline("t1")],
  finalText = "All done.",
): Run {
  return create(RunSchema, {
    metadata: { id: "run_try", org: "acme" },
    spec: { message: "rename getUser" },
    status: create(RunStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_HUMAN,
          content: "rename getUser",
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: "Looking.",
          toolCalls: calls,
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_THINKING,
          content: "hmm",
        }),
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: finalText,
        }),
      ],
      fileReviewEventStream: create(FileReviewEventStreamSchema, { events }),
    }),
  });
}

function deps(
  harness: Harness,
  overrides: Partial<EvalTraceDeps> = {},
): EvalTraceDeps {
  return {
    pluginName: "thermos",
    harness,
    wantedFiles: [],
    readArtifact: async (key) => new TextEncoder().encode(`bytes of ${key}`),
    ...overrides,
  };
}

const created = create(CapturedFileChangeSchema, {
  pathAfter: "CHANGELOG.md",
  kind: FileChangeKind.ADD,
  after: { body: { case: "inline", value: "## 1.0.0" } },
});

describe("the eval trace, native transcript", () => {
  const native = runOf(
    [
      call("c1", "read_file", {
        file_path: "/work/.stigmer/skills/commit-message/SKILL.md",
      }),
      call("c2", "read_file", { file_path: "src/a.ts" }),
      call("c3", "write_file", { file_path: "CHANGELOG.md", content: "x" }),
      call("c4", "edit_file", { file_path: "src/a.ts" }),
      call("c5", "execute", { command: "npm test" }, { error: "exit 1" }),
      call("c6", "search_issues", { q: "bug" }, { mcpServerSlug: "github" }),
      call("c7", "some_engine_tool", {}),
    ],
    [baseline("t1"), candidate("t1", [created])],
  );

  it("names every call as Claude Code does", async () => {
    const trace = await evalTraceOf(native, deps(Harness.NATIVE));
    expect(trace.toolCalls.map((c) => c.name)).toEqual([
      "Skill",
      "Read",
      "Write",
      "Edit",
      "Bash",
      "mcp__plugin_thermos_github__search_issues",
      "some_engine_tool",
    ]);
    expect(trace.toolCalls[0]?.input).toBe(
      JSON.stringify({ skill: "thermos:commit-message" }),
    );
    expect(trace.toolCalls[4]?.input).toBe(
      JSON.stringify({ command: "npm test" }),
    );
  });

  it("writes the trace as Claude Code's JSON lines and keeps the final message", async () => {
    const trace = await evalTraceOf(native, deps(Harness.NATIVE));
    expect(trace.lastMessage).toBe("All done.");
    const lines = trace.traceLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(lines.map((line) => line["type"])).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(trace.traceLines[1]).toContain('"type":"tool_use"');
    expect(trace.traceLines[1]).toContain('"name":"Skill"');
    expect(trace.traceLines[2]).toContain('"is_error":true');
  });

  it("reads the created paths and the wanted contents", async () => {
    const trace = await evalTraceOf(
      native,
      deps(Harness.NATIVE, { wantedFiles: ["./CHANGELOG.md", "missing.md"] }),
    );
    expect(trace.files).toEqual({
      kind: "recorded",
      created: ["CHANGELOG.md"],
      contents: new Map([
        ["CHANGELOG.md", { kind: "text", text: "## 1.0.0" }],
        ["missing.md", { kind: "absent" }],
      ]),
    });
  });
});

describe("the eval trace, Cursor transcript", () => {
  it("reads the SDK's names, a created file's edit as Write and a changed one's as Edit", async () => {
    const cursor = runOf(
      [
        call("k1", "read", {
          path: "/home/u/.stigmer/sessions/s/platform/skills/review/SKILL.md",
        }),
        call("k2", "edit", { path: "CHANGELOG.md" }),
        call("k3", "edit", { path: "src/a.ts" }),
        call("k4", "shell", { command: "ls" }),
        call("k5", "readLints", {}),
      ],
      [baseline("t1"), candidate("t1", [created])],
    );
    const trace = await evalTraceOf(cursor, deps(Harness.CURSOR));
    expect(trace.toolCalls.map((c) => c.name)).toEqual([
      "Skill",
      "Write",
      "Edit",
      "Bash",
      "readLints",
    ]);
    expect(trace.toolCalls[0]?.input).toBe(
      JSON.stringify({ skill: "thermos:review" }),
    );
  });
});

describe("the eval trace's files", () => {
  it("is not recorded when the run's ledger holds no capture", async () => {
    const trace = await evalTraceOf(
      runOf([], []),
      deps(Harness.NATIVE, { wantedFiles: ["a"] }),
    );
    expect(trace.files).toEqual({ kind: "not-recorded" });
  });

  it("takes each change set's last candidate, offloaded, binary, deleted and unreadable bodies", async () => {
    const events = [
      baseline("t1"),
      candidate("t1", [
        create(CapturedFileChangeSchema, {
          pathAfter: "stale.md",
          kind: FileChangeKind.ADD,
        }),
      ]),
      candidate("t1", [
        create(CapturedFileChangeSchema, {
          pathAfter: "big.md",
          kind: FileChangeKind.ADD,
          after: {
            body: {
              case: "ref",
              value: { storageKey: "artifacts/run_try/big" },
            },
          },
        }),
        create(CapturedFileChangeSchema, {
          pathAfter: "logo.png",
          kind: FileChangeKind.ADD,
          after: { isBinary: true },
        }),
        create(CapturedFileChangeSchema, {
          pathBefore: "old.md",
          kind: FileChangeKind.DELETE,
        }),
        create(CapturedFileChangeSchema, {
          pathAfter: "lost.md",
          kind: FileChangeKind.MODIFY,
          after: {
            body: {
              case: "ref",
              value: { storageKey: "artifacts/run_try/lost" },
            },
          },
        }),
      ]),
    ];
    const trace = await evalTraceOf(
      runOf([], events),
      deps(Harness.NATIVE, {
        wantedFiles: ["big.md", "logo.png", "old.md", "lost.md"],
        readArtifact: async (key) => {
          if (key.endsWith("lost")) throw new Error("gone");
          return new TextEncoder().encode("big body");
        },
      }),
    );
    expect(trace.files.kind).toBe("recorded");
    if (trace.files.kind !== "recorded") return;
    expect(trace.files.created).toEqual(["big.md", "logo.png"]);
    expect(trace.files.contents.get("big.md")).toEqual({
      kind: "text",
      text: "big body",
    });
    expect(trace.files.contents.get("logo.png")).toEqual({ kind: "binary" });
    expect(trace.files.contents.get("old.md")).toEqual({ kind: "absent" });
    expect(trace.files.contents.get("lost.md")).toMatchObject({
      kind: "unreadable",
    });
  });

  it("adds the request line when the transcript has none, and matches the skill mount", async () => {
    const run = runOf([]);
    run.status!.messages = run.status!.messages.filter(
      (m) => m.type !== MessageType.MESSAGE_HUMAN,
    );
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(JSON.parse(trace.traceLines[0] ?? "{}")).toEqual({
      type: "user",
      message: { role: "user", content: "rename getUser" },
    });
    expect(SKILL_READ_PATH.test(".stigmer/skills/x/SKILL.md")).toBe(true);
    expect(SKILL_READ_PATH.test("docs/skills/x/SKILL.md")).toBe(false);
  });
});

describe("the eval trace's edges", () => {
  it("reads a tool message as a user line of its result", async () => {
    const run = runOf([]);
    run.status!.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_TOOL,
        content: "exit 0",
      }),
    );
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(JSON.parse(trace.traceLines.at(-1) ?? "{}")).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "exit 0" }],
      },
    });
  });

  it("leaves out a message type this server does not know, and still answers the trace", async () => {
    const run = runOf([]);
    run.status!.messages.splice(
      1,
      0,
      create(AgentMessageSchema, {
        type: 99 as MessageType,
        content: "from a newer engine",
      }),
    );
    // Proto enums are open: the stored run decodes the unknown type as its number.
    const stored = fromBinary(RunSchema, toBinary(RunSchema, run));
    expect(stored.status?.messages[1]?.type).toBe(99);
    const trace = await evalTraceOf(stored, deps(Harness.NATIVE));
    expect(trace.lastMessage).toBe("All done.");
    expect(trace.traceLines).toHaveLength(3);
    expect(trace.traceLines.join("\n")).not.toContain("from a newer engine");
  });

  it("has an empty final message when no assistant message carries text", async () => {
    const run = runOf(
      [call("c1", "read_file", { file_path: "a.ts" })],
      undefined,
      "",
    );
    run.status!.messages[1]!.content = "";
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(trace.lastMessage).toBe("");
  });

  it("reads a change with no captured body as empty text", async () => {
    const events = [
      baseline("t1"),
      candidate("t1", [
        create(CapturedFileChangeSchema, {
          pathAfter: "empty.md",
          kind: FileChangeKind.ADD,
        }),
        create(CapturedFileChangeSchema, {
          pathAfter: "blank.md",
          kind: FileChangeKind.ADD,
          after: {},
        }),
      ]),
    ];
    const trace = await evalTraceOf(
      runOf([], events),
      deps(Harness.NATIVE, { wantedFiles: ["empty.md", "blank.md"] }),
    );
    expect(trace.files.kind).toBe("recorded");
    if (trace.files.kind !== "recorded") return;
    expect(trace.files.contents.get("empty.md")).toEqual({
      kind: "text",
      text: "",
    });
    expect(trace.files.contents.get("blank.md")).toEqual({
      kind: "text",
      text: "",
    });
  });
});
