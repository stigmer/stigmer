// The canonical session transcript (stigmer/stigmer#814): assembly rules
// over the session's event log, offload resolution through each tool use's
// full-output location, and the two serializations.
//
// The Markdown format is a pinned contract: transcript.golden.md freezes the
// exact rendering of a transcript exercising every construct (thinking,
// the platform's notes, a compaction, tool calls with input and output,
// asks and their answers, offloaded outputs resolved and noted, sub-agent
// nesting, a structured output, build-from-plan and in-progress markers).
// A deliberate format change regenerates the golden with
//   UPDATE_TRANSCRIPT_GOLDEN=1 npx vitest run src/run/__tests__/transcript.test.ts
// and reviews the diff; an accidental one fails here.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  RunListSchema,
  GetArtifactContentResponseSchema,
  type GetArtifactContentRequest,
  type GetArtifactContentResponse,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  SessionEventListSchema,
  type ListSessionEventsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { foldSession } from "@stigmer/session-log";
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

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

const text = (t: string) => [{ type: "text", text: t }];

/** A log under construction: each event gets the next place. */
function logBuilder() {
  let seq = 0n;
  const events: SessionEvent[] = [];
  return {
    events,
    add(runId: string, event: EventInit, threadId = ""): void {
      seq += 1n;
      events.push(create(SessionEventSchema, { seq, sessionId: "ses_01", runId, threadId, event }));
    },
  };
}

function session() {
  return create(SessionSchema, {
    metadata: { id: "ses_01" },
    spec: {
      subject: "Fix the flaky test",
      agentRef: { org: "acme", slug: "ci-fixer", kind: ApiResourceKind.agent },
    },
  });
}

function run(id: string, spec: { message: string; supersedesRunId?: string; buildFromPlan?: boolean }, startedAt?: string): Run {
  return create(RunSchema, {
    metadata: { id },
    spec: { target: { case: "sessionId", value: "ses_01" }, ...spec },
    status: { phase: RunPhase.RUN_COMPLETED, startedAt },
  });
}

/**
 * The runs' records: run_01b was replaced by run_01c's edit-and-resubmit,
 * run_01d builds from a plan. Deliberately scrambled — the log, not the
 * list, orders the turns.
 */
function allRuns(): Run[] {
  return [
    run("run_01c", { message: "edited prompt", supersedesRunId: "run_01b" }, "2026-08-20T11:00:00Z"),
    run("run_01a", { message: "Why is CI red?" }, "2026-08-20T10:00:00Z"),
    run("run_01d", { message: "Build from plan", buildFromPlan: true }, "2026-08-20T12:00:00Z"),
    run("run_01b", { message: "old prompt" }),
  ];
}

/**
 * The session's log:
 *   Turn 1 (run_01a): thinking, a message, a shell call that asked and was
 *     allowed (2s), a read whose output was offloaded, a screenshot stored as
 *     an image, an MCP call denied with a reason, a note, a compaction.
 *   run_01b: superseded by run_01c.
 *   Turn 2 (run_01c): a sub-agent thread with an offloaded grep output, a
 *     structured output.
 *   Turn 3 (run_01d): a Build-from-plan turn still running.
 * Plus the session's own status, which belongs to no turn.
 */
function allEvents(): SessionEvent[] {
  const log = logBuilder();
  const A = "run_01a";
  log.add(A, { case: "userMessage", value: { id: `${A}.user`, content: text("Why is CI red?"), processedAt: "2026-08-20T10:00:01Z" } });
  log.add(A, { case: "stigmerRunStatus", value: { id: `${A}.s1`, phase: "running" } });
  log.add(A, { case: "agentThinking", value: { id: `${A}.root.t0` } });
  log.add(A, { case: "stigmerAgentThinking", value: { id: `${A}.root.t0.text`, thinkingId: `${A}.root.t0`, text: "The failure is in the retry loop.\nLet me check." } });
  log.add(A, { case: "agentMessage", value: { id: `${A}.root.m0`, content: text("Let me look.") } });
  log.add(A, {
    case: "agentToolUse",
    value: { id: `${A}.c1`, name: "shell_command", input: { command: "go test ./..." }, evaluatedPermission: "ask", processedAt: "2026-08-20T10:00:05Z" },
  });
  log.add(A, { case: "stigmerPermissionAsked", value: { id: `${A}.c1.ask`, toolUseId: `${A}.c1`, message: "Run go test" } });
  log.add(A, { case: "userToolConfirmation", value: { id: `${A}.c1.ok`, toolUseId: `${A}.c1`, result: "allow" } });
  log.add(A, { case: "agentToolResult", value: { id: `${A}.c1.r`, toolUseId: `${A}.c1`, content: text("FAIL: TestRetry"), processedAt: "2026-08-20T10:00:07Z" } });
  log.add(A, { case: "agentToolUse", value: { id: `${A}.c2`, name: "read_file", input: { path: "retry.go" } } });
  log.add(A, { case: "agentToolResult", value: { id: `${A}.c2.r`, toolUseId: `${A}.c2`, content: text("package retry…") } });
  log.add(A, {
    case: "stigmerToolResultFullOutput",
    value: { id: `${A}.c2.full`, toolUseId: `${A}.c2`, storageKey: "artifacts/run_01a/toolcalls/c2.txt", sizeBytes: 2048n, mimeType: "text/plain" },
  });
  log.add(A, { case: "agentToolUse", value: { id: `${A}.c3`, name: "screenshot" } });
  log.add(A, { case: "agentToolResult", value: { id: `${A}.c3.r`, toolUseId: `${A}.c3`, content: text("") } });
  log.add(A, {
    case: "stigmerToolResultFullOutput",
    value: { id: `${A}.c3.full`, toolUseId: `${A}.c3`, storageKey: "artifacts/run_01a/toolcalls/c3.png", sizeBytes: 4096n, mimeType: "image/png", isImage: true },
  });
  log.add(A, {
    case: "agentMcpToolUse",
    value: { id: `${A}.c4`, name: "create_issue", mcpServerName: "github", input: { title: "flaky" }, evaluatedPermission: "ask" },
  });
  log.add(A, { case: "userToolConfirmation", value: { id: `${A}.c4.no`, toolUseId: `${A}.c4`, result: "deny", denyMessage: "not yet" } });
  log.add(A, { case: "stigmerHarnessNote", value: { id: `${A}.root.n0`, text: "Approval received" } });
  log.add(A, { case: "agentThreadContextCompacted", value: { id: `${A}.cmp` } });
  log.add(A, { case: "stigmerRunStatus", value: { id: `${A}.s2`, phase: "completed" } });
  log.add("", { case: "sessionStatusIdle", value: { id: "idle1", stopReason: { type: "end_turn" } } });

  const B = "run_01b";
  log.add(B, { case: "userMessage", value: { id: `${B}.user`, content: text("old prompt") } });
  log.add(B, { case: "stigmerRunStatus", value: { id: `${B}.s`, phase: "completed" } });

  const C = "run_01c";
  const thread = `${C}.task1`;
  log.add(C, { case: "userMessage", value: { id: `${C}.user`, content: text("edited prompt") } });
  log.add(C, { case: "agentMessage", value: { id: `${C}.root.m0`, content: text("Delegating.") } });
  log.add(C, { case: "agentToolUse", value: { id: thread, name: "task", input: { description: "explore" }, processedAt: "2026-08-20T11:00:01Z" } });
  log.add(C, { case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "explore", sessionThreadId: thread } });
  log.add(C, { case: "agentThreadMessageSent", value: { id: `${thread}.sent`, toSessionThreadId: thread, content: text("find tests") } });
  log.add(C, { case: "agentMessage", value: { id: `${thread}.m0`, content: text("Scanning.") } }, thread);
  log.add(C, { case: "agentToolUse", value: { id: `${thread}.g1`, name: "grep", input: { pattern: "Test" } } }, thread);
  log.add(C, { case: "agentToolResult", value: { id: `${thread}.g1.r`, toolUseId: `${thread}.g1`, content: text("3 matches…") } }, thread);
  log.add(C, {
    case: "stigmerToolResultFullOutput",
    value: { id: `${thread}.g1.full`, toolUseId: `${thread}.g1`, storageKey: "artifacts/run_01c/toolcalls/g1.txt", sizeBytes: 64n, mimeType: "text/plain" },
  });
  log.add(C, { case: "agentThreadMessageReceived", value: { id: `${thread}.received`, fromSessionThreadId: thread, content: text("found 3") } });
  log.add(C, { case: "sessionThreadStatusIdle", value: { id: `${thread}.idle`, sessionThreadId: thread, stopReason: { type: "end_turn" } } });
  log.add(C, { case: "agentToolResult", value: { id: `${thread}.r`, toolUseId: thread, content: text("found 3"), processedAt: "2026-08-20T11:00:06Z" } });
  log.add(C, { case: "stigmerAgentStructuredOutput", value: { id: `${C}.output`, output: { flaky: 1 } } });
  log.add(C, { case: "stigmerRunStatus", value: { id: `${C}.s`, phase: "completed" } });

  const D = "run_01d";
  log.add(D, { case: "userMessage", value: { id: `${D}.user`, content: text("Build from plan") } });
  log.add(D, { case: "stigmerRunStatus", value: { id: `${D}.s`, phase: "running" } });
  log.add(D, { case: "agentMessage", value: { id: `${D}.root.m0`, content: text("Working on it.") } });
  return log.events;
}

/** One turn's log alone, for the narrower serializer cases. */
function oneTurn(build: (log: ReturnType<typeof logBuilder>) => void): SessionEvent[] {
  const log = logBuilder();
  log.add("run_x", { case: "userMessage", value: { id: "run_x.user", content: text("prompt") } });
  build(log);
  log.add("run_x", { case: "stigmerRunStatus", value: { id: "run_x.done", phase: "completed" } });
  return log.events;
}

const RESOLVED: Record<string, ResolvedToolOutput> = {
  "artifacts/run_01a/toolcalls/c2.txt": {
    storageKey: "artifacts/run_01a/toolcalls/c2.txt",
    content: "package retry\n\nfunc Do() {}",
    truncated: false,
    totalSizeBytes: 2048,
    mimeType: "text/plain",
    isImage: false,
  },
  "artifacts/run_01a/toolcalls/c3.png": {
    storageKey: "artifacts/run_01a/toolcalls/c3.png",
    truncated: false,
    totalSizeBytes: 4096,
    mimeType: "image/png",
    isImage: true,
  },
  "artifacts/run_01c/toolcalls/g1.txt": {
    storageKey: "artifacts/run_01c/toolcalls/g1.txt",
    content: "3 matches in test/",
    truncated: false,
    totalSizeBytes: 64,
    mimeType: "text/plain",
    isImage: false,
  },
};

function assembleAll(options?: Parameters<typeof assembleSessionTranscript>[3]) {
  return assembleSessionTranscript(session(), allEvents(), allRuns(), options);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

describe("assembleSessionTranscript", () => {
  it("reads the turns from the log, in log order, each with its own events", () => {
    const t = assembleAll();
    expect(t.turns.map((x) => x.runId)).toEqual(["run_01a", "run_01c", "run_01d"]);
    expect(t.turns[0].events.every((e) => e.runId === "run_01a")).toBe(true);
    expect(t.turns[0].events).toHaveLength(20);
    expect(t.turns[0].turn.answer).toBe("Let me look.");
  });

  it("excludes superseded turns by default, matching the conversation view", () => {
    const t = assembleAll();
    expect(t.turns.some((x) => x.runId === "run_01b")).toBe(false);
    expect(t.includesSuperseded).toBe(false);
  });

  it("keeps superseded turns, marked, when includeSuperseded is set", () => {
    const t = assembleAll({ includeSuperseded: true });
    expect(t.turns.map((x) => x.runId)).toEqual(["run_01a", "run_01b", "run_01c", "run_01d"]);
    expect(t.turns.map((x) => x.superseded)).toEqual([false, true, false, false]);
  });

  it("takes the user prompt from the turn's message; a Build-from-plan label is no prompt", () => {
    const t = assembleAll();
    expect(t.turns[0].userPrompt).toBe("Why is CI red?");
    expect(t.turns[2].userPrompt).toBeNull();
    expect(t.turns[2].isBuildFromPlan).toBe(true);
  });

  it.each([
    ["the 'execute' placeholder", "execute"],
    ["an empty message", ""],
  ])("synthesizes no prompt from %s", (_case, message) => {
    const log = logBuilder();
    log.add("run_x", { case: "userMessage", value: { id: "run_x.user", content: text(message) } });
    const t = assembleSessionTranscript(session(), log.events, []);
    expect(t.turns[0].userPrompt).toBeNull();
    expect(t.turns[0].isBuildFromPlan).toBe(false);
  });

  it("marks a turn that had not ended in progress, and takes each turn's start from its run", () => {
    const t = assembleAll();
    expect(t.turns.map((x) => x.inProgress)).toEqual([false, false, true]);
    expect(t.turns.map((x) => x.startedAt)).toEqual([
      "2026-08-20T10:00:00Z",
      "2026-08-20T11:00:00Z",
      "2026-08-20T12:00:00Z",
    ]);
    // A turn whose run the list does not hold has no start.
    expect(assembleSessionTranscript(session(), allEvents(), []).turns[0].startedAt).toBeUndefined();
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
      run: {
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

const allTurns = () => foldSession(allEvents()).turns;

describe("resolveOffloadedOutputs", () => {
  it("resolves the primary thread's and a sub-agent's outputs, each from its tool use's run", async () => {
    const { client, requests } = fakeArtifactClient({
      "artifacts/run_01a/toolcalls/c2.txt": { content: "full file" },
      "artifacts/run_01c/toolcalls/g1.txt": { content: "3 matches in test/" },
    });
    const resolved = await resolveOffloadedOutputs(client, allTurns());

    expect(resolved["artifacts/run_01a/toolcalls/c2.txt"].content).toBe("full file");
    // The sub-agent's call is its turn's: its output is read from run_01c.
    const subAgentRequest = requests.find((r) => r.storageKey === "artifacts/run_01c/toolcalls/g1.txt");
    expect(subAgentRequest?.runId).toBe("run_01c");
  });

  it("never fetches image outputs, but records them for the serializers", async () => {
    const { client, requests } = fakeArtifactClient({
      "artifacts/run_01a/toolcalls/c2.txt": { content: "full file" },
      "artifacts/run_01c/toolcalls/g1.txt": { content: "x" },
    });
    const resolved = await resolveOffloadedOutputs(client, allTurns());

    const imageKey = "artifacts/run_01a/toolcalls/c3.png";
    expect(requests.some((r) => r.storageKey === imageKey)).toBe(false);
    expect(resolved[imageKey]).toMatchObject({
      isImage: true,
      mimeType: "image/png",
      totalSizeBytes: 4096,
    });
  });

  it("tolerates individual fetch failures — the rest still resolve", async () => {
    const { client } = fakeArtifactClient({
      "artifacts/run_01a/toolcalls/c2.txt": new Error("storage unavailable"),
      "artifacts/run_01c/toolcalls/g1.txt": { content: "3 matches in test/" },
    });
    const resolved = await resolveOffloadedOutputs(client, allTurns());

    expect(resolved["artifacts/run_01a/toolcalls/c2.txt"].error).toBe("storage unavailable");
    expect(resolved["artifacts/run_01a/toolcalls/c2.txt"].content).toBeUndefined();
    expect(resolved["artifacts/run_01c/toolcalls/g1.txt"].content).toBe("3 matches in test/");
  });

  it("records a failure that is not an Error by its text", async () => {
    const client = {
      run: {
        listBySession: () => Promise.reject(new Error("not under test")),
        getArtifactContent: () => Promise.reject("gone"),
      },
    };
    const resolved = await resolveOffloadedOutputs(client, allTurns());
    expect(resolved["artifacts/run_01a/toolcalls/c2.txt"].error).toBe("gone");
  });

  it("carries the server's truncation flag and true size", async () => {
    const { client } = fakeArtifactClient({
      "artifacts/run_01a/toolcalls/c2.txt": {
        content: "first half…",
        truncated: true,
        totalSizeBytes: 1048576,
      },
      "artifacts/run_01c/toolcalls/g1.txt": { content: "x" },
    });
    const resolved = await resolveOffloadedOutputs(client, allTurns());
    expect(resolved["artifacts/run_01a/toolcalls/c2.txt"]).toMatchObject({
      truncated: true,
      totalSizeBytes: 1048576,
    });
  });

  it("holds at most `concurrency` fetches in flight and still resolves every output", async () => {
    // Six text outputs on one turn, a pool of two. The fake parks every
    // fetch on a deferred so the in-flight count is observable, then releases
    // them one at a time; the pool must never exceed two and must drain all six.
    const keys = Array.from({ length: 6 }, (_, i) => `artifacts/run_x/toolcalls/c${i}.txt`);
    const events = oneTurn((log) => {
      keys.forEach((storageKey, i) => {
        log.add("run_x", { case: "agentToolUse", value: { id: `run_x.c${i}`, name: "read_file" } });
        log.add("run_x", { case: "agentToolResult", value: { id: `run_x.c${i}.r`, toolUseId: `run_x.c${i}`, content: text("head") } });
        log.add("run_x", {
          case: "stigmerToolResultFullOutput",
          value: { id: `run_x.c${i}.full`, toolUseId: `run_x.c${i}`, storageKey, mimeType: "text/plain" },
        });
      });
    });

    const releases: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
      run: {
        listBySession: () => Promise.reject(new Error("not under test")),
        getArtifactContent: (input: GetArtifactContentRequest) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise<GetArtifactContentResponse>((resolveFetch) => {
            releases.push(() => {
              inFlight--;
              resolveFetch(
                create(GetArtifactContentResponseSchema, {
                  content: new TextEncoder().encode(input.storageKey),
                }),
              );
            });
          });
        },
      },
    };

    const resolving = resolveOffloadedOutputs(client, foldSession(events).turns, { concurrency: 2 });
    // Release the six fetches one at a time. A macrotask boundary between
    // releases lets the pool's microtask chain run to its next fetch, so the
    // observation is deterministic: no timers, no races.
    let released = 0;
    while (released < keys.length) {
      const release = releases.shift();
      if (release) {
        release();
        released++;
      } else {
        await new Promise((tick) => setTimeout(tick, 0));
      }
    }
    const resolved = await resolving;

    // Exactly two: never more (the bound holds) and never fewer (the pool is
    // genuinely parallel, not a serial loop wearing a `concurrency` option).
    expect(maxInFlight).toBe(2);
    for (const key of keys) {
      expect(resolved[key].content).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

describe("fetchSessionTranscript", () => {
  function fakeClient(overrides?: { totalPages?: number }) {
    const artifacts = fakeArtifactClient({
      "artifacts/run_01a/toolcalls/c2.txt": { content: "full file" },
      "artifacts/run_01c/toolcalls/g1.txt": { content: "3 matches" },
    });
    const eventRequests: ListSessionEventsRequest[] = [];
    const log = allEvents();
    return {
      eventRequests,
      session: {
        get: () => Promise.resolve(session()),
        // Two pages: the log's first twenty events, then the rest.
        listEvents: (input: ListSessionEventsRequest) => {
          eventRequests.push(input);
          return Promise.resolve(
            input.pageToken === ""
              ? create(SessionEventListSchema, { events: log.slice(0, 20), nextPageToken: "p2" })
              : create(SessionEventListSchema, { events: log.slice(20) }),
          );
        },
      },
      run: {
        ...artifacts.client.run,
        listBySession: () =>
          Promise.resolve(
            create(RunListSchema, {
              totalPages: overrides?.totalPages ?? 1,
              entries: allRuns(),
            }),
          ),
      },
    };
  }

  it("reads the whole log, every page, and assembles the transcript with outputs resolved", async () => {
    const client = fakeClient();
    const t = await fetchSessionTranscript(client, "ses_01");
    expect(client.eventRequests.map((r) => [r.sessionId, r.pageToken])).toEqual([
      ["ses_01", ""],
      ["ses_01", "p2"],
    ]);
    expect(t.turns).toHaveLength(3);
    expect(t.resolvedOutputs["artifacts/run_01a/toolcalls/c2.txt"].content).toBe("full file");
  });

  it("keeps superseded turns when asked", async () => {
    const t = await fetchSessionTranscript(fakeClient(), "ses_01", { includeSuperseded: true });
    expect(t.turns).toHaveLength(4);
  });

  it("skips output resolution when disabled", async () => {
    const t = await fetchSessionTranscript(fakeClient(), "ses_01", {
      resolveOutputs: false,
    });
    expect(Object.keys(t.resolvedOutputs)).toHaveLength(0);
  });

  it("refuses to export when the server paginates the session's runs", async () => {
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
    const t = assembleAll({ resolvedOutputs: RESOLVED });
    const goldenPath = resolve(here, "transcript.golden.md");
    const actual = transcriptToMarkdown(t);
    if (process.env.UPDATE_TRANSCRIPT_GOLDEN) {
      writeFileSync(goldenPath, actual);
    }
    expect(actual).toBe(readFileSync(goldenPath, "utf8"));
  });

  it("names a deleted agent as deleted: the server returns its reference with an id and no slug", () => {
    const gone = session();
    gone.spec!.agentRef = create(ApiResourceReferenceSchema, {
      org: "acme",
      kind: ApiResourceKind.agent,
      id: "agt_01gone",
    });
    const md = transcriptToMarkdown(assembleSessionTranscript(gone, allEvents(), allRuns()));
    expect(md).toContain("- Agent: deleted agent");
    expect(md).not.toContain("agt_01gone");
  });

  it("titles a session with no subject by its id, and names no agent for the built-in assistant", () => {
    const bare = create(SessionSchema, { metadata: { id: "ses_bare" } });
    const md = transcriptToMarkdown(assembleSessionTranscript(bare, [], []));
    expect(md).toContain("# Session ses_bare");
    expect(md).not.toContain("- Agent:");
  });

  it("stamps the export time only when provided", () => {
    const t = assembleAll();
    expect(transcriptToMarkdown(t)).not.toContain("Exported:");
    expect(
      transcriptToMarkdown(t, { generatedAt: "2026-08-22T06:00:00Z" }),
    ).toContain("- Exported: 2026-08-22T06:00:00Z");
  });

  it("falls back to the result's head, with an honest note, when an output is unresolved", () => {
    const md = transcriptToMarkdown(assembleAll());
    expect(md).toContain("_Offloaded output not resolved — showing its head._");
    expect(md).toContain("package retry…");
  });

  it("notes the fetch failure when resolution was attempted and failed", () => {
    const t = assembleAll({
      resolvedOutputs: {
        "artifacts/run_01a/toolcalls/c2.txt": {
          storageKey: "artifacts/run_01a/toolcalls/c2.txt",
          truncated: false,
          mimeType: "text/plain",
          isImage: false,
          error: "storage unavailable",
        },
      },
    });
    expect(transcriptToMarkdown(t)).toContain(
      "_Offloaded output unavailable (storage unavailable) — showing its head._",
    );
  });

  it("marks server-truncated outputs with the byte counts", () => {
    const t = assembleAll({
      resolvedOutputs: {
        "artifacts/run_01a/toolcalls/c2.txt": {
          storageKey: "artifacts/run_01a/toolcalls/c2.txt",
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

  it("names an image output with no recorded type as an image", () => {
    const events = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c1", name: "screenshot" } });
      log.add("run_x", {
        case: "stigmerToolResultFullOutput",
        value: { id: "run_x.c1.full", toolUseId: "run_x.c1", storageKey: "k.png", sizeBytes: 9n, isImage: true },
      });
    });
    expect(transcriptToMarkdown(assembleSessionTranscript(session(), events, []))).toContain(
      "_Image output (image, 9 bytes) — not inlined._",
    );
  });

  it("sizes fences past backtick runs in the content", () => {
    const events = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c1", name: "shell_command" } });
      log.add("run_x", { case: "agentToolResult", value: { id: "run_x.c1.r", toolUseId: "run_x.c1", content: text("a fence: ```md\ninside\n```") } });
    });
    const md = transcriptToMarkdown(assembleSessionTranscript(session(), events, []));
    expect(md).toContain("````\na fence: ```md\ninside\n```\n````");
  });

  it("shows a failed call's output as its error, and a call still running or stopped by its state", () => {
    const failed = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c1", name: "shell_command" } });
      log.add("run_x", { case: "agentToolResult", value: { id: "run_x.c1.r", toolUseId: "run_x.c1", content: text("exit 1"), isError: true } });
      log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c2", name: "read_file" } });
    });
    const md = transcriptToMarkdown(assembleSessionTranscript(session(), failed, []));
    expect(md).toContain("**Tool — `shell_command`** (failed)\n\nError:\n\n```\nexit 1\n```");
    // The turn ended before the read returned.
    expect(md).toContain("**Tool — `read_file`** (stopped)");

    const running = failed.slice(0, -1);
    expect(transcriptToMarkdown(assembleSessionTranscript(session(), running, []))).toContain(
      "**Tool — `read_file`** (running)",
    );
  });

  it("shows a call that waits for an answer, one allowed with its class, and a timing that cannot be read", () => {
    const log = logBuilder();
    log.add("run_x", { case: "userMessage", value: { id: "run_x.user", content: text("prompt") } });
    log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c1", name: "write_file", evaluatedPermission: "ask", processedAt: "later" } });
    log.add("run_x", { case: "stigmerPermissionAsked", value: { id: "run_x.c1.ask", toolUseId: "run_x.c1" } });
    log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c2", name: "shell", evaluatedPermission: "ask", processedAt: "2026-08-20T10:00:05Z" } });
    log.add("run_x", { case: "userToolConfirmation", value: { id: "run_x.c2.ok", toolUseId: "run_x.c2", result: "allow" } });
    log.add("run_x", { case: "stigmerPermissionGrant", value: { id: "run_x.c2.grant", toolUseId: "run_x.c2", scope: "turn" } });
    log.add("run_x", { case: "agentToolResult", value: { id: "run_x.c2.r", toolUseId: "run_x.c2", content: text("ok"), processedAt: "2026-08-20T10:00:05.250Z" } });
    log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c3", name: "shell", evaluatedPermission: "deny" } });
    log.add("run_x", { case: "userToolConfirmation", value: { id: "run_x.c3.no", toolUseId: "run_x.c3", result: "deny" } });
    const md = transcriptToMarkdown(assembleSessionTranscript(session(), log.events, []));
    expect(md).toContain("**Tool — `write_file`** (waiting for approval)\n\n_Asked for approval._");
    expect(md).toContain("**Tool — `shell`** (completed · 250ms)\n\n_Allowed, with every call of its class for the rest of the turn._");
    expect(md).toContain("**Tool — `shell`** (denied)\n\n_Denied._");
  });

  it("drops a duration whose end precedes its start", () => {
    const events = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: "run_x.c1", name: "shell", processedAt: "2026-08-20T10:00:05Z" } });
      log.add("run_x", { case: "agentToolResult", value: { id: "run_x.c1.r", toolUseId: "run_x.c1", content: text("ok"), processedAt: "2026-08-20T10:00:04Z" } });
    });
    expect(transcriptToMarkdown(assembleSessionTranscript(session(), events, []))).toContain("**Tool — `shell`** (completed)\n");
  });

  it("shows a sub-agent that failed by its error, and one its turn stopped", () => {
    const thread = "run_x.task1";
    const failed = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: thread, name: "task" } });
      log.add("run_x", { case: "sessionThreadCreated", value: { id: `${thread}.created`, sessionThreadId: thread } });
      log.add("run_x", { case: "agentThreadMessageReceived", value: { id: `${thread}.received`, fromSessionThreadId: thread, content: text("ran out of retries") } });
      log.add("run_x", { case: "sessionThreadStatusIdle", value: { id: `${thread}.idle`, sessionThreadId: thread, stopReason: { type: "retries_exhausted" } } });
    });
    const md = transcriptToMarkdown(assembleSessionTranscript(session(), failed, []));
    expect(md).toContain("> **Sub-agent — sub-agent**\n>\n> Error:\n>\n> ```\n> ran out of retries\n> ```");

    const stopped = oneTurn((log) => {
      log.add("run_x", { case: "agentToolUse", value: { id: thread, name: "task" } });
      log.add("run_x", { case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "explore", sessionThreadId: thread } });
    });
    expect(transcriptToMarkdown(assembleSessionTranscript(session(), stopped, []))).toContain(
      "> **Sub-agent — explore**\n>\n> _Stopped before it finished._",
    );
  });

  it("quotes a failed turn's error, and each other error of the turn once", () => {
    const log = logBuilder();
    log.add("run_f", { case: "userMessage", value: { id: "run_f.user", content: text("prompt") } });
    log.add("run_f", { case: "sessionError", value: { id: "e1", error: { type: "model_overloaded_error", message: "retrying" } } });
    log.add("run_f", { case: "sessionError", value: { id: "e2", error: { type: "unknown_error", message: "provider refused the request\n\nquota exceeded" } } });
    log.add("run_f", {
      case: "stigmerRunStatus",
      value: { id: "run_f.s", phase: "failed", error: "provider refused the request\n\nquota exceeded" },
    });
    const md = transcriptToMarkdown(assembleSessionTranscript(session(), log.events, []));
    expect(md).toContain("**Error** (`model_overloaded_error`)\n\n> retrying");
    expect(md).toContain(
      "**Run error**\n\n> provider refused the request\n>\n> quota exceeded",
    );
    // The error the status already states is not repeated.
    expect(md).not.toContain("(`unknown_error`)");
  });

  it("omits the error block for a turn that carries no error", () => {
    const md = transcriptToMarkdown(assembleAll());
    expect(md).not.toContain("**Run error**");
  });

  it("marks kept superseded turns", () => {
    const md = transcriptToMarkdown(assembleAll({ includeSuperseded: true }));
    expect(md).toContain("- Includes superseded (edited-and-resubmitted) turns");
    expect(md).toContain("_Superseded by an edited resubmission._");
    expect(md).toContain("old prompt");
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe("transcriptToJson", () => {
  it("carries each turn's events as Managed Agents JSON, JSON.stringify-safe despite bigint fields", () => {
    const t = assembleAll({ resolvedOutputs: RESOLVED });
    // sizeBytes is int64 → bigint on the proto; a raw stringify of the
    // transcript would throw. The projection must not.
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(t), null, 2));
    expect(parsed.format).toBe("stigmer.ai/session-transcript/v3");
    expect(parsed.session.metadata.id).toBe("ses_01");
    expect(parsed.turns).toHaveLength(3);
    expect(parsed.turns[0].run_id).toBe("run_01a");
    expect(parsed.turns[0].started_at).toBe("2026-08-20T10:00:00Z");
    expect(parsed.turns[0].events[0]).toMatchObject({
      type: "user.message",
      id: "run_01a.user",
      content: [{ type: "text", text: "Why is CI red?" }],
    });
    const full = parsed.turns[0].events.find((e: { type: string }) => e.type === "stigmer.tool_result.full_output");
    // int64 as a string.
    expect(full.size_bytes).toBe("2048");
  });

  it("leaves out an event of a member this build does not know", () => {
    const events = oneTurn((log) => {
      log.add("run_x", undefined);
    });
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(assembleSessionTranscript(session(), events, []))));
    expect(parsed.turns[0].events.map((e: { type: string }) => e.type)).toEqual(["user.message", "stigmer.run.status"]);
  });

  it("carries the canonical-rule verdicts per turn", () => {
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(assembleAll({ includeSuperseded: true }))));
    expect(parsed.includes_superseded).toBe(true);
    expect(parsed.turns[0].user_prompt).toBe("Why is CI red?");
    expect(parsed.turns[1].superseded).toBe(true);
    expect(parsed.turns[3].build_from_plan).toBe(true);
    expect(parsed.turns[3].in_progress).toBe(true);
    expect(parsed.turns[0].superseded).toBeUndefined();
  });

  it("keys resolved outputs by storage key with plain-JSON fields", () => {
    const parsed = JSON.parse(JSON.stringify(transcriptToJson(assembleAll({ resolvedOutputs: RESOLVED }))));
    expect(parsed.resolved_outputs["artifacts/run_01a/toolcalls/c2.txt"]).toMatchObject({
      content: "package retry\n\nfunc Do() {}",
      mime_type: "text/plain",
      total_size_bytes: 2048,
    });
    expect(parsed.resolved_outputs["artifacts/run_01a/toolcalls/c3.png"].is_image).toBe(true);
  });
});
