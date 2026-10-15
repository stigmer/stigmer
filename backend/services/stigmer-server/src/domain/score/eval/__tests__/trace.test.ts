/**
 * Pins the eval's reader of a try (trace.ts) over a native and a Cursor
 * turn, read from the turn's session events and the files on its run: engine names read as Claude's (Write for a file the run
 * created, Edit for one it changed), an MCP call as
 * `mcp__<server>__<tool>`, its server slug read as written since a turn
 * already names a plugin's server `plugin_<plugin>_<server>`; a read of a
 * mounted skill's SKILL.md (the workspace link and the platform
 * directory) as `Skill`, and a read of a plugin skill's SKILL.md inside
 * the plugin's mounted tree as `Skill` named `<plugin>:<name>`, the name
 * looked up by the skill's path in the plugin's list and, for a path the
 * list lacks, the path's last segment; the trace as Claude Code's JSON lines, the final message, created paths
 * from each change set on the run's file record, as its last capture left
 * it, contents inline, read back from the artifact store, binary, deleted
 * or unreadable, and a run whose record holds no change set read as "not
 * recorded". A tool use after the
 * previous uses' results opens an assistant line of its own, and a call
 * that never returned reads as an empty result; an event type this
 * server does not know (a writer newer than it), a thinking and a harness
 * note add no line, never answered in place of the trace; a run with no
 * assistant text has an empty final message; a change with no captured body reads as empty
 * text. The mock calls are the calls to the servers the run's case mocked,
 * by the server's key, with the answer the mock gave. A path no change set
 * touched is read from the files the runner returned for the graders, a
 * change set's content winning where both have one.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { CapturedFileChange, FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { capturedSet } from "../../../run/__tests__/file-review-seed.js";

import {
  EvalCaseContextSchema,
  EvalMockServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";

import {
  PLUGIN_SKILL_READ_PATH,
  SKILL_READ_PATH,
  evalTraceOf,
} from "../trace.js";
import type { EvalTraceDeps } from "../trace.js";
import type { RunTranscript } from "../../../session/events/run-events.js";
import { RunEventsBuilder } from "../../../session/events/__tests__/run-events-fixture.js";
import type { FixtureCall } from "../../../session/events/__tests__/run-events-fixture.js";

function call(
  id: string,
  name: string,
  args: Record<string, string>,
  extra: { readonly error?: string; readonly mcpServerSlug?: string } = {},
): FixtureCall {
  return {
    id,
    name,
    input: args,
    result: extra.error ?? `result of ${id}`,
    ...(extra.error === undefined ? {} : { isError: true }),
    ...(extra.mcpServerSlug === undefined ? {} : { mcpServer: extra.mcpServerSlug }),
  };
}

/** A change set as its turn's capture records it, with `changes`. */
function candidate(changeSetId: string, changes: CapturedFileChange[]): FileChangeSet {
  return capturedSet(changeSetId, changes);
}

/** A change set the record holds with its baseline alone. */
function baseline(changeSetId: string): FileChangeSet {
  return capturedSet(changeSetId, [], false);
}

function runOf(
  calls: FixtureCall[],
  events = [baseline("t1")],
  finalText = "All done.",
  firstText = "Looking.",
): RunTranscript {
  const run = create(RunSchema, {
    metadata: { id: "run_try", org: "acme" },
    spec: { message: "rename getUser" },
    status: create(RunStatusSchema, {
      // The record as the trace reads it: one entry per change set id,
      // its newest write standing (the status merge's own rules are
      // record.test.ts's).
      fileChanges: [...new Map(events.map((set) => [set.id, set])).values()],
    }),
  });
  return {
    run,
    events: new RunEventsBuilder("run_try")
      .user("rename getUser")
      .turnMessage(firstText, calls)
      .thinking("hmm")
      .turnMessage(finalText)
      .build(),
  };
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
      call("c6", "search_issues", { q: "bug" }, { mcpServerSlug: "plugin_thermos_github" }),
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

  it("names an MCP call by its server slug as written: a plugin's segment, or a server outside any plugin", async () => {
    // A turn names a plugin's server `plugin_<plugin>_<server>`, as Claude
    // Code does, so the slug a call carries is already the grader's name.
    const run = runOf(
      [
        call("m1", "search", { q: "bug" }, { mcpServerSlug: "plugin_thermos_My_Server" }),
        call("m2", "list", {}, { mcpServerSlug: "github" }),
      ],
      [],
    );
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(trace.toolCalls.map((c) => c.name)).toEqual([
      "mcp__plugin_thermos_My_Server__search",
      "mcp__github__list",
    ]);
    expect(trace.traceLines[1]).toContain(
      '"name":"mcp__plugin_thermos_My_Server__search"',
    );
  });

  it("lists the calls to the servers the case mocked, by the server's key, with the mock's answer", async () => {
    const run = runOf(
      [
        call("m1", "create_issue", { title: "Crash" }, { mcpServerSlug: "tracker-acme" }),
        call("m2", "close_issue", { id: "9" }, { mcpServerSlug: "tracker-acme", error: "No such issue." }),
        call("m3", "search", { q: "bug" }, { mcpServerSlug: "github" }),
      ],
      [],
    );
    run.run.spec!.evalCase = create(EvalCaseContextSchema, {
      mocks: [create(EvalMockServerSchema, { server: "tracker", segment: "tracker-acme" })],
    });
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(trace.mockCalls.map((line) => JSON.parse(line) as unknown)).toEqual([
      { server: "tracker", tool: "create_issue", input: { title: "Crash" }, answer: "result of m1" },
      { server: "tracker", tool: "close_issue", input: { id: "9" }, answer: "No such issue." },
    ]);
    expect((await evalTraceOf(runOf([], []), deps(Harness.NATIVE))).mockCalls).toEqual([]);
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

describe("the eval trace, a plugin skill's read", () => {
  const DIGEST = "d".repeat(64);
  const skillNames = new Map([
    ["skills/review", "code-review"],
    ["nested/tools/skills/lint", "lint"],
  ]);

  it("reads as Skill named by the plugin's list, on either engine and at any depth in the plugin", async () => {
    const run = runOf(
      [
        call("p1", "read_file", {
          file_path: `/work/.stigmer/plugins/${DIGEST}/skills/review/SKILL.md`,
        }),
        call("p2", "read_file", {
          file_path: `.stigmer/plugins/${DIGEST}/nested/tools/skills/lint/SKILL.md`,
        }),
      ],
      [],
    );
    const trace = await evalTraceOf(run, deps(Harness.NATIVE, { skillNames }));
    expect(trace.toolCalls).toEqual([
      { name: "Skill", input: JSON.stringify({ skill: "thermos:code-review" }) },
      { name: "Skill", input: JSON.stringify({ skill: "thermos:lint" }) },
    ]);

    const cursor = runOf(
      [
        call("k1", "read", {
          path: `/home/u/.stigmer/sessions/s/platform/plugins/${DIGEST}/skills/review/SKILL.md`,
        }),
      ],
      [],
    );
    const viaCursor = await evalTraceOf(cursor, deps(Harness.CURSOR, { skillNames }));
    expect(viaCursor.toolCalls[0]?.input).toBe(
      JSON.stringify({ skill: "thermos:code-review" }),
    );
  });

  it("falls back to the path's last segment for a skill the list lacks, or with no list", async () => {
    const run = runOf(
      [
        call("p1", "read_file", {
          file_path: `.stigmer/plugins/${DIGEST}/skills/unlisted/SKILL.md`,
        }),
      ],
      [],
    );
    for (const overrides of [{ skillNames }, {}]) {
      const trace = await evalTraceOf(run, deps(Harness.NATIVE, overrides));
      expect(trace.toolCalls).toEqual([
        { name: "Skill", input: JSON.stringify({ skill: "thermos:unlisted" }) },
      ]);
    }
  });

  it("matches only a SKILL.md inside a mounted plugin's tree", () => {
    expect(
      PLUGIN_SKILL_READ_PATH.exec(`.stigmer/plugins/${DIGEST}/skills/review/SKILL.md`)?.slice(1),
    ).toEqual([DIGEST, "skills/review"]);
    expect(PLUGIN_SKILL_READ_PATH.test(`docs/plugins/${DIGEST}/skills/x/SKILL.md`)).toBe(false);
    expect(PLUGIN_SKILL_READ_PATH.test(`.stigmer/plugins/${DIGEST}/SKILL.md`)).toBe(false);
  });
});

describe("the eval trace's created paths", () => {
  it("lists a path every change set created once, in capture order", async () => {
    const other = create(CapturedFileChangeSchema, {
      pathAfter: "./src/new.ts",
      kind: FileChangeKind.ADD,
    });
    const run = runOf(
      [],
      [baseline("t1"), candidate("t1", [created, other]), candidate("t2", [created])],
    );
    const trace = await evalTraceOf(run, deps(Harness.NATIVE));
    expect(trace.files).toMatchObject({
      kind: "recorded",
      created: ["CHANGELOG.md", "src/new.ts"],
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

  it("reads a path no change set touched from the files the runner returned, a change set winning", async () => {
    const run = runOf([], [baseline("t1"), candidate("t1", [created])]);
    run.run.status!.evalFiles = create(RunStatusSchema, {
      evalFiles: {
        files: [
          { path: "./app.txt", content: { case: "text", value: "version = 1\n" } },
          { path: "logo.png", content: { case: "binary", value: true } },
          { path: "huge.log", content: { case: "unreadable", value: "'huge.log' is larger than 128 KiB" } },
          { path: "gone.md", content: { case: "absent", value: true } },
          { path: "CHANGELOG.md", content: { case: "text", value: "stale" } },
        ],
      },
    }).evalFiles;
    const trace = await evalTraceOf(
      run,
      deps(Harness.NATIVE, { wantedFiles: ["app.txt", "logo.png", "huge.log", "gone.md", "CHANGELOG.md", "never.md"] }),
    );
    const contents = trace.files.kind === "recorded" ? trace.files.contents : new Map();
    expect(Object.fromEntries(contents)).toEqual({
      "app.txt": { kind: "text", text: "version = 1\n" },
      "logo.png": { kind: "binary" },
      "huge.log": { kind: "unreadable", reason: "'huge.log' is larger than 128 KiB" },
      "gone.md": { kind: "absent" },
      "CHANGELOG.md": { kind: "text", text: "## 1.0.0" },
      "never.md": { kind: "absent" },
    });
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
    const trace = await evalTraceOf(
      { run: run.run, events: run.events.filter((e) => e.event.case !== "userMessage") },
      deps(Harness.NATIVE),
    );
    expect(JSON.parse(trace.traceLines[0] ?? "{}")).toEqual({
      type: "user",
      message: { role: "user", content: "rename getUser" },
    });
    expect(SKILL_READ_PATH.test(".stigmer/skills/x/SKILL.md")).toBe(true);
    expect(SKILL_READ_PATH.test("docs/skills/x/SKILL.md")).toBe(false);
  });
});

describe("the eval trace's edges", () => {
  it("opens an assistant line for a tool use after the previous uses' results, and reads a call that never returned as an empty result", async () => {
    const run = runOf([]);
    const events = new RunEventsBuilder("run_try")
      .user("rename getUser")
      .turnMessage("Looking.", [call("c1", "read_file", { file_path: "a.ts" })])
      .turnMessage("", [{ id: "c2", name: "read_file", input: { file_path: "b.ts" } }])
      .build();
    const trace = await evalTraceOf({ run: run.run, events }, deps(Harness.NATIVE));
    expect(trace.traceLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: "user", message: { role: "user", content: "rename getUser" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", id: "c1", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "result of c1" }] },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "c2", name: "Read", input: { file_path: "b.ts" } }],
        },
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: "" }] },
      },
    ]);
  });

  it("leaves out a message type this server does not know, and still answers the trace", async () => {
    const run = runOf([]);
    const events = new RunEventsBuilder("run_try")
      .user("rename getUser")
      .unknown()
      .note("the harness retried")
      .turnMessage("All done.")
      .build();
    const trace = await evalTraceOf({ run: run.run, events }, deps(Harness.NATIVE));
    expect(trace.lastMessage).toBe("All done.");
    expect(trace.traceLines).toHaveLength(2);
    expect(trace.traceLines.join("\n")).not.toContain("the harness retried");
  });

  it("has an empty final message when no assistant message carries text", async () => {
    const run = runOf(
      [call("c1", "read_file", { file_path: "a.ts" })],
      undefined,
      "",
      "",
    );
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
