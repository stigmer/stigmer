/**
 * Pins that the three scoring readers read a turn from its session's
 * events: a run whose transcript rows are empty, and whose events carry
 * the tool calls, the final answer and the structured output, reads as
 * the same actions (the free checks), the same subject (the judge) and
 * the same trace (a plugin eval's graders) as the rows of the same turn
 * read before the readers moved to the log. The expected values below are
 * what the rows of this turn read as.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { RunEventsBuilder } from "../../session/events/__tests__/run-events-fixture.js";
import { actionsOf } from "../checks/actions.js";
import { evalTraceOf } from "../eval/trace.js";
import { subjectPartsOf } from "../judge/subject.js";

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** The turn, with no transcript rows: everything it did is in its events. */
const run = create(RunSchema, {
  metadata: { id: "run_1", org: "acme" },
  spec: {
    target: { case: "sessionId", value: "ses_1" },
    message: "Fix the failing test.",
    structuredOutputSchema: { type: "object" },
    pluginEvalCase: {
      mocks: [{ segment: "plugin_thermos_github", server: "github" }],
    },
  },
  status: {},
});

const events = new RunEventsBuilder("run_1")
  .user("Fix the failing test.")
  .turnMessage("Looking at the test.", [
    {
      id: "c1",
      name: "read_file",
      input: { file_path: "src/a.ts" },
      result: "contents",
    },
    {
      id: "c2",
      name: "execute",
      input: { command: "npm test" },
      result: "exit 1",
      isError: true,
    },
  ])
  .turnMessage("", [
    {
      id: "c3",
      name: "search_issues",
      input: { q: "flaky" },
      mcpServer: "plugin_thermos_github",
      result: "head of the hits",
      offloadedHash: "h1",
    },
  ])
  .turnMessage("Fixed it.")
  .structuredOutput({ fixed: true })
  .build();

describe("the scoring readers, from a turn's events", () => {
  it("read the same actions as the turn's rows", () => {
    expect(actionsOf({ run, events })).toEqual({
      actions: [
        {
          name: "read_file",
          argsKey: sha256('{"file_path":"src/a.ts"}'),
          resultKey: `sha256:${sha256("contents")}`,
          status: "completed",
          step: 1,
        },
        {
          name: "execute",
          argsKey: sha256('{"command":"npm test"}'),
          resultKey: `sha256:${sha256("")}`,
          status: "failed",
          step: 2,
        },
        {
          name: "search_issues",
          argsKey: sha256('{"q":"flaky"}'),
          resultKey: "ref:h1",
          status: "completed",
          step: 3,
        },
      ],
      schemaSet: true,
      outputPresent: true,
    });
  });

  it("read the same judge subject as the turn's rows", () => {
    expect(subjectPartsOf({ run, events }, [])).toEqual({
      earlierTurns: [],
      request: "Fix the failing test.",
      toolCalls: [
        {
          name: "read_file",
          args: '{"file_path":"src/a.ts"}',
          status: "completed",
          error: "",
          result: "contents",
          resultCut: false,
        },
        {
          name: "execute",
          args: '{"command":"npm test"}',
          status: "failed",
          error: "exit 1",
          result: "",
          resultCut: false,
        },
        {
          name: "search_issues",
          args: '{"q":"flaky"}',
          status: "completed",
          error: "",
          result: "head of the hits",
          resultCut: true,
        },
      ],
      answer: '{"fixed":true}',
    });
  });

  it("read the same eval trace as the turn's rows", async () => {
    const trace = await evalTraceOf(
      { run, events },
      {
        pluginName: "thermos",
        harness: Harness.NATIVE,
        wantedFiles: [],
        readArtifact: () => Promise.reject(new Error("no artifacts")),
      },
    );
    expect(trace.lastMessage).toBe("Fixed it.");
    expect(trace.toolCalls).toEqual([
      { name: "Read", input: '{"file_path":"src/a.ts"}' },
      { name: "Bash", input: '{"command":"npm test"}' },
      {
        name: "mcp__plugin_thermos_github__search_issues",
        input: '{"q":"flaky"}',
      },
    ]);
    expect(trace.mockCalls).toEqual([
      '{"server":"github","tool":"search_issues","input":{"q":"flaky"},"answer":"head of the hits"}',
    ]);
    expect(trace.traceLines.map((line) => JSON.parse(line) as unknown)).toEqual(
      [
        {
          type: "user",
          message: { role: "user", content: "Fix the failing test." },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Looking at the test." },
              {
                type: "tool_use",
                id: "c1",
                name: "Read",
                input: { file_path: "src/a.ts" },
              },
              {
                type: "tool_use",
                id: "c2",
                name: "Bash",
                input: { command: "npm test" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "c1", content: "contents" },
              {
                type: "tool_result",
                tool_use_id: "c2",
                content: "exit 1",
                is_error: true,
              },
            ],
          },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "c3",
                name: "mcp__plugin_thermos_github__search_issues",
                input: { q: "flaky" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "c3",
                content: "head of the hits",
              },
            ],
          },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Fixed it." }],
          },
        },
      ],
    );
    expect(trace.files).toEqual({ kind: "not-recorded" });
  });
});
