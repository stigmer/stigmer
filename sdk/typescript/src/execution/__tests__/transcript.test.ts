// The canonical session transcript (stigmer/stigmer#814): assembly rules,
// offload resolution, and the two serializations.
//
// The Markdown format is a pinned contract: transcript.golden.md freezes the
// exact rendering of a transcript exercising every construct (thinking,
// system, tool calls with args/results, offloaded outputs resolved and
// noted, sub-agent nesting, build-from-plan and in-progress markers). A
// deliberate format change regenerates the golden with
//   UPDATE_TRANSCRIPT_GOLDEN=1 npx vitest run src/execution/__tests__/transcript.test.ts
// and reviews the diff; an accidental one fails here.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  AgentExecutionListSchema,
  GetArtifactContentResponseSchema,
  type GetArtifactContentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  assembleSessionTranscript,
  fetchSessionTranscript,
  resolveOffloadedOutputs,
  transcriptToJson,
  transcriptToMarkdown,
  type ResolvedToolOutput,
} from "../transcript";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function session() {
  return create(SessionSchema, {
    metadata: { id: "ses_01" },
    spec: { subject: "Fix the flaky test", agentInstanceId: "agi_01" },
  });
}

/** Turn 1: prompt echo dedupe, thinking, tool call with args + inline
 * result + duration, offloaded text output, image output, raw system. */
function exec1(): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_01a" },
    spec: { sessionId: "ses_01", message: "Why is CI red?" },
    status: {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: "2026-08-20T10:00:00Z",
      completedAt: "2026-08-20T10:01:00Z",
      messages: [
        {
          type: MessageType.MESSAGE_HUMAN,
          content: "Why is CI red?",
          timestamp: "2026-08-20T10:00:01Z",
        },
        {
          type: MessageType.MESSAGE_THINKING,
          content: "The failure is in the retry loop.\nLet me check.",
          timestamp: "2026-08-20T10:00:02Z",
        },
        {
          type: MessageType.MESSAGE_AI,
          content: "Let me look.",
          timestamp: "2026-08-20T10:00:04Z",
          toolCalls: [
            {
              id: "tc_1",
              name: "shell_command",
              args: { command: "go test ./..." } as JsonObject,
              result: "FAIL: TestRetry",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
              startedAt: "2026-08-20T10:00:05Z",
              completedAt: "2026-08-20T10:00:07Z",
            },
          ],
        },
        {
          type: MessageType.MESSAGE_AI,
          content: "",
          timestamp: "2026-08-20T10:00:10Z",
          toolCalls: [
            {
              id: "tc_2",
              name: "read_file",
              args: { path: "retry.go" } as JsonObject,
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
              outputRef: {
                storageKey: "artifacts/aex_01a/toolcalls/tc_2.txt",
                sizeBytes: 2048n,
                mimeType: "text/plain",
                truncatedPreview: "package retry…",
              },
            },
            {
              id: "tc_3",
              name: "screenshot",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
              outputRef: {
                storageKey: "artifacts/aex_01a/toolcalls/tc_3.png",
                sizeBytes: 4096n,
                mimeType: "image/png",
                isImage: true,
              },
            },
          ],
        },
        {
          type: MessageType.MESSAGE_SYSTEM,
          content: "Approval received",
          timestamp: "2026-08-20T10:00:20Z",
        },
      ],
    },
  });
}

/** Superseded by exec3's edit-and-resubmit — excluded by default. */
function exec2(): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_01b" },
    spec: { sessionId: "ses_01", message: "old prompt" },
    status: { phase: ExecutionPhase.EXECUTION_COMPLETED },
  });
}

/** Turn 2: edit-and-resubmit successor with a sub-agent delegation. */
function exec3(): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_01c" },
    spec: {
      sessionId: "ses_01",
      message: "edited prompt",
      supersedesExecutionId: "aex_01b",
    },
    status: {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: "2026-08-20T11:00:00Z",
      messages: [
        {
          type: MessageType.MESSAGE_AI,
          content: "Delegating.",
          toolCalls: [
            {
              id: "tc_sa",
              name: "task",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
            },
          ],
        },
      ],
      subAgentExecutions: [
        {
          id: "tc_sa",
          name: "explore",
          subject: "Explore the repo",
          input: "find tests",
          output: "found 3",
          startedAt: "2026-08-20T11:00:01Z",
          completedAt: "2026-08-20T11:00:06Z",
          messages: [
            {
              type: MessageType.MESSAGE_AI,
              content: "Scanning.",
              toolCalls: [
                {
                  id: "tc_sa_1",
                  name: "grep",
                  result: "3 matches",
                  status: ToolCallStatus.TOOL_CALL_COMPLETED,
                  outputRef: {
                    // Sub-agent outputs are stored under the PARENT
                    // execution's id — the storage key is the record of it.
                    storageKey: "artifacts/aex_01c/toolcalls/tc_sa_1.txt",
                    sizeBytes: 64n,
                    mimeType: "text/plain",
                    truncatedPreview: "3 matches…",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

/** Turn 3: an in-flight Build-from-plan turn. */
function exec4(): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id: "aex_01d" },
    spec: {
      sessionId: "ses_01",
      message: "Build from plan",
      executionConfig: { buildFromPlan: true },
    },
    status: {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      startedAt: "2026-08-20T12:00:00Z",
      messages: [{ type: MessageType.MESSAGE_AI, content: "Working on it." }],
    },
  });
}

function allExecutions(): AgentExecution[] {
  // Deliberately scrambled: assembly must restore ULID order.
  return [exec3(), exec1(), exec4(), exec2()];
}

const RESOLVED: Record<string, ResolvedToolOutput> = {
  "artifacts/aex_01a/toolcalls/tc_2.txt": {
    storageKey: "artifacts/aex_01a/toolcalls/tc_2.txt",
    content: "package retry\n\nfunc Do() {}",
    truncated: false,
    totalSizeBytes: 2048,
    mimeType: "text/plain",
    isImage: false,
  },
  "artifacts/aex_01a/toolcalls/tc_3.png": {
    storageKey: "artifacts/aex_01a/toolcalls/tc_3.png",
    truncated: false,
    totalSizeBytes: 4096,
    mimeType: "image/png",
    isImage: true,
  },
  "artifacts/aex_01c/toolcalls/tc_sa_1.txt": {
    storageKey: "artifacts/aex_01c/toolcalls/tc_sa_1.txt",
    content: "3 matches in test/",
    truncated: false,
    totalSizeBytes: 64,
    mimeType: "text/plain",
    isImage: false,
  },
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

describe("assembleSessionTranscript", () => {
  it("orders turns chronologically by ULID regardless of input order", () => {
    const t = assembleSessionTranscript(session(), allExecutions());
    expect(t.turns.map((x) => x.execution.metadata?.id)).toEqual([
      "aex_01a",
      "aex_01c",
      "aex_01d",
    ]);
  });

  it("excludes superseded turns by default, matching the conversation view", () => {
    const t = assembleSessionTranscript(session(), allExecutions());
    expect(
      t.turns.some((x) => x.execution.metadata?.id === "aex_01b"),
    ).toBe(false);
    expect(t.includesSuperseded).toBe(false);
  });

  it("keeps superseded turns, marked, when includeSuperseded is set", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      includeSuperseded: true,
    });
    const ids = t.turns.map((x) => x.execution.metadata?.id);
    expect(ids).toEqual(["aex_01a", "aex_01b", "aex_01c", "aex_01d"]);
    expect(t.turns.map((x) => x.superseded)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("synthesizes user prompts by the shared rule", () => {
    const t = assembleSessionTranscript(session(), allExecutions());
    expect(t.turns[0].userPrompt).toBe("Why is CI red?");
    // Build-from-plan: machine label, no user prose.
    expect(t.turns[2].userPrompt).toBeNull();
    expect(t.turns[2].isBuildFromPlan).toBe(true);
  });

  it("suppresses the 'execute' placeholder prompt", () => {
    const exec = create(AgentExecutionSchema, {
      metadata: { id: "aex_x" },
      spec: { sessionId: "ses_01", message: "execute" },
      status: { phase: ExecutionPhase.EXECUTION_COMPLETED },
    });
    const t = assembleSessionTranscript(session(), [exec]);
    expect(t.turns[0].userPrompt).toBeNull();
    expect(t.turns[0].isBuildFromPlan).toBe(false);
  });

  it("marks non-terminal executions in progress", () => {
    const t = assembleSessionTranscript(session(), allExecutions());
    expect(t.turns.map((x) => x.inProgress)).toEqual([false, false, true]);
  });
});

// ---------------------------------------------------------------------------
// Offload resolution
// ---------------------------------------------------------------------------

type ContentByKey = Record<
  string,
  { content: string; truncated?: boolean; totalSizeBytes?: number } | Error
>;

function fakeArtifactClient(contentByKey: ContentByKey) {
  const requests: GetArtifactContentRequest[] = [];
  return {
    requests,
    client: {
      agentExecution: {
        listBySession: () => Promise.reject(new Error("not under test")),
        getArtifactContent: (input: GetArtifactContentRequest) => {
          requests.push(input);
          const entry = contentByKey[input.storageKey];
          if (entry === undefined) {
            return Promise.reject(new Error(`no such key: ${input.storageKey}`));
          }
          if (entry instanceof Error) return Promise.reject(entry);
          return Promise.resolve(
            create(GetArtifactContentResponseSchema, {
              content: new TextEncoder().encode(entry.content),
              truncated: entry.truncated ?? false,
              totalSizeBytes: BigInt(entry.totalSizeBytes ?? entry.content.length),
            }),
          );
        },
      },
    },
  };
}

describe("resolveOffloadedOutputs", () => {
  it("resolves parent and sub-agent refs, deriving each execution id from the storage key", async () => {
    const { client, requests } = fakeArtifactClient({
      "artifacts/aex_01a/toolcalls/tc_2.txt": { content: "full file" },
      "artifacts/aex_01c/toolcalls/tc_sa_1.txt": { content: "3 matches in test/" },
    });
    const resolved = await resolveOffloadedOutputs(client, allExecutions());

    expect(resolved["artifacts/aex_01a/toolcalls/tc_2.txt"].content).toBe(
      "full file",
    );
    // The sub-agent's ref (nested in exec3's sub_agent_executions) resolved
    // under the PARENT execution's id, taken from the key itself.
    const subAgentRequest = requests.find(
      (r) => r.storageKey === "artifacts/aex_01c/toolcalls/tc_sa_1.txt",
    );
    expect(subAgentRequest?.executionId).toBe("aex_01c");
  });

  it("never fetches image refs, but records them for the serializers", async () => {
    const { client, requests } = fakeArtifactClient({
      "artifacts/aex_01a/toolcalls/tc_2.txt": { content: "full file" },
      "artifacts/aex_01c/toolcalls/tc_sa_1.txt": { content: "x" },
    });
    const resolved = await resolveOffloadedOutputs(client, allExecutions());

    const imageKey = "artifacts/aex_01a/toolcalls/tc_3.png";
    expect(requests.some((r) => r.storageKey === imageKey)).toBe(false);
    expect(resolved[imageKey]).toMatchObject({
      isImage: true,
      mimeType: "image/png",
      totalSizeBytes: 4096,
    });
  });

  it("tolerates individual fetch failures — the rest still resolve", async () => {
    const { client } = fakeArtifactClient({
      "artifacts/aex_01a/toolcalls/tc_2.txt": new Error("storage unavailable"),
      "artifacts/aex_01c/toolcalls/tc_sa_1.txt": { content: "3 matches in test/" },
    });
    const resolved = await resolveOffloadedOutputs(client, allExecutions());

    expect(resolved["artifacts/aex_01a/toolcalls/tc_2.txt"].error).toBe(
      "storage unavailable",
    );
    expect(resolved["artifacts/aex_01a/toolcalls/tc_2.txt"].content).toBeUndefined();
    expect(
      resolved["artifacts/aex_01c/toolcalls/tc_sa_1.txt"].content,
    ).toBe("3 matches in test/");
  });

  it("carries the server's truncation flag and true size", async () => {
    const { client } = fakeArtifactClient({
      "artifacts/aex_01a/toolcalls/tc_2.txt": {
        content: "first half…",
        truncated: true,
        totalSizeBytes: 1048576,
      },
      "artifacts/aex_01c/toolcalls/tc_sa_1.txt": { content: "x" },
    });
    const resolved = await resolveOffloadedOutputs(client, allExecutions());
    expect(resolved["artifacts/aex_01a/toolcalls/tc_2.txt"]).toMatchObject({
      truncated: true,
      totalSizeBytes: 1048576,
    });
  });
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

describe("fetchSessionTranscript", () => {
  function fakeClient(overrides?: { totalPages?: number }) {
    const artifacts = fakeArtifactClient({
      "artifacts/aex_01a/toolcalls/tc_2.txt": { content: "full file" },
      "artifacts/aex_01c/toolcalls/tc_sa_1.txt": { content: "3 matches" },
    });
    return {
      session: { get: (id: string) => Promise.resolve(session()) },
      agentExecution: {
        ...artifacts.client.agentExecution,
        listBySession: () =>
          Promise.resolve(
            create(AgentExecutionListSchema, {
              totalPages: overrides?.totalPages ?? 1,
              entries: allExecutions(),
            }),
          ),
      },
    };
  }

  it("assembles the full transcript with outputs resolved", async () => {
    const t = await fetchSessionTranscript(fakeClient(), "ses_01");
    expect(t.turns).toHaveLength(3);
    expect(
      t.resolvedOutputs["artifacts/aex_01a/toolcalls/tc_2.txt"].content,
    ).toBe("full file");
  });

  it("skips output resolution when disabled", async () => {
    const t = await fetchSessionTranscript(fakeClient(), "ses_01", {
      resolveOutputs: false,
    });
    expect(Object.keys(t.resolvedOutputs)).toHaveLength(0);
  });

  it("refuses to export a silently truncated conversation if the server ever paginates", async () => {
    await expect(
      fetchSessionTranscript(fakeClient({ totalPages: 2 }), "ses_01"),
    ).rejects.toThrow(/2 pages .* single page/s);
  });
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

describe("transcriptToMarkdown", () => {
  it("matches the pinned format contract (transcript.golden.md)", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      resolvedOutputs: RESOLVED,
    });
    const goldenPath = resolve(here, "transcript.golden.md");
    const actual = transcriptToMarkdown(t);
    if (process.env.UPDATE_TRANSCRIPT_GOLDEN) {
      writeFileSync(goldenPath, actual);
    }
    expect(actual).toBe(readFileSync(goldenPath, "utf8"));
  });

  it("stamps the export time only when provided", () => {
    const t = assembleSessionTranscript(session(), [exec1()]);
    expect(transcriptToMarkdown(t)).not.toContain("Exported:");
    expect(
      transcriptToMarkdown(t, { generatedAt: "2026-08-22T06:00:00Z" }),
    ).toContain("- Exported: 2026-08-22T06:00:00Z");
  });

  it("falls back to the ref's preview, with an honest note, when an output is unresolved", () => {
    const t = assembleSessionTranscript(session(), [exec1()]);
    const md = transcriptToMarkdown(t);
    expect(md).toContain("_Offloaded output not resolved — showing preview._");
    expect(md).toContain("package retry…");
  });

  it("notes the fetch failure when resolution was attempted and failed", () => {
    const t = assembleSessionTranscript(session(), [exec1()], {
      resolvedOutputs: {
        "artifacts/aex_01a/toolcalls/tc_2.txt": {
          storageKey: "artifacts/aex_01a/toolcalls/tc_2.txt",
          truncated: false,
          mimeType: "text/plain",
          isImage: false,
          error: "storage unavailable",
        },
      },
    });
    expect(transcriptToMarkdown(t)).toContain(
      "_Offloaded output unavailable (storage unavailable) — showing preview._",
    );
  });

  it("marks server-truncated outputs with the byte counts", () => {
    const t = assembleSessionTranscript(session(), [exec1()], {
      resolvedOutputs: {
        "artifacts/aex_01a/toolcalls/tc_2.txt": {
          storageKey: "artifacts/aex_01a/toolcalls/tc_2.txt",
          content: "0123456789",
          truncated: true,
          totalSizeBytes: 1048576,
          mimeType: "text/plain",
          isImage: false,
        },
      },
    });
    expect(transcriptToMarkdown(t)).toContain(
      "_Output truncated at 10 of 1048576 bytes (server content cap)._",
    );
  });

  it("sizes fences past backtick runs in the content", () => {
    const exec = create(AgentExecutionSchema, {
      metadata: { id: "aex_x" },
      spec: { sessionId: "ses_01", message: "prompt" },
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        messages: [
          {
            type: MessageType.MESSAGE_AI,
            content: "",
            toolCalls: [
              {
                id: "tc",
                name: "shell_command",
                result: "a fence: ```md\ninside\n```",
                status: ToolCallStatus.TOOL_CALL_COMPLETED,
              },
            ],
          },
        ],
      },
    });
    const md = transcriptToMarkdown(
      assembleSessionTranscript(session(), [exec]),
    );
    expect(md).toContain("````\na fence: ```md\ninside\n```\n````");
  });

  it("marks kept superseded turns", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      includeSuperseded: true,
    });
    const md = transcriptToMarkdown(t);
    expect(md).toContain("- Includes superseded (edited-and-resubmitted) turns");
    expect(md).toContain("_Superseded by an edited resubmission._");
    expect(md).toContain("old prompt");
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe("transcriptToJson", () => {
  it("is JSON.stringify-safe despite bigint proto fields (protojson contract)", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      resolvedOutputs: RESOLVED,
    });
    // sizeBytes is int64 → bigint on the proto; a raw stringify of the
    // transcript would throw. The projection must not.
    const text = JSON.stringify(transcriptToJson(t), null, 2);
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe("stigmer.ai/session-transcript/v1");
    expect(parsed.session.metadata.id).toBe("ses_01");
    expect(parsed.turns).toHaveLength(3);
    // protojson: snake_case field names, int64 as string.
    expect(
      parsed.turns[0].execution.status.messages[3].tool_calls[0].output_ref
        .size_bytes,
    ).toBe("2048");
  });

  it("carries the canonical-rule verdicts per turn", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      includeSuperseded: true,
    });
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(t)));
    expect(parsed.includes_superseded).toBe(true);
    expect(parsed.turns[0].user_prompt).toBe("Why is CI red?");
    expect(parsed.turns[1].superseded).toBe(true);
    expect(parsed.turns[3].build_from_plan).toBe(true);
    expect(parsed.turns[3].in_progress).toBe(true);
  });

  it("strips the internal Temporal callback token from execution status", () => {
    const exec = exec1();
    exec.status!.callbackToken = new TextEncoder().encode("task-token");
    const t = assembleSessionTranscript(session(), [exec]);
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(t)));
    expect(parsed.turns[0].execution.status.callback_token).toBeUndefined();
    // The strip is surgical — the rest of status is intact.
    expect(parsed.turns[0].execution.status.messages).toHaveLength(5);
  });

  it("keys resolved outputs by storage key with plain-JSON fields", () => {
    const t = assembleSessionTranscript(session(), allExecutions(), {
      resolvedOutputs: RESOLVED,
    });
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(t)));
    expect(
      parsed.resolved_outputs["artifacts/aex_01a/toolcalls/tc_2.txt"],
    ).toMatchObject({
      content: "package retry\n\nfunc Do() {}",
      mime_type: "text/plain",
      total_size_bytes: 2048,
    });
  });
});
