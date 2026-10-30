/**
 * Proves the `@stigmer/react-sdk/test` factories (../samples.ts): each resource
 * factory's defaults and overrides; the session-event builders (ids derived
 * from the run and arguments, the events of a whole turn, a folded turn and
 * tool use, list and stream responses numbered in order); that no factory
 * reads the live clock (identical output a day apart, the frozen instant on
 * every timestamp, a stable 1.2s tool duration); and the reader offset
 * window that fixes the anchor at 11:00 UTC.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { formatDuration } from "../../run/ToolCallDetail";
import { samples, SAMPLE_INSTANT, sampleInstant, sampleDate } from "@stigmer/react-core/test";

describe("samples", () => {
  describe("session", () => {
    it("creates a session with defaults", () => {
      const s = samples.session();
      expect(s.apiVersion).toBe("agentic.stigmer.ai/v1");
      expect(s.kind).toBe("Session");
      expect(s.metadata?.name).toBe("demo-session");
      expect(s.metadata?.org).toBe("demo");
      expect(s.spec?.subject).toBe("Demo conversation");
    });

    it("applies overrides", () => {
      const s = samples.session({ name: "my-chat", subject: "Custom topic", org: "acme" });
      expect(s.metadata?.name).toBe("my-chat");
      expect(s.metadata?.org).toBe("acme");
      expect(s.spec?.subject).toBe("Custom topic");
    });
  });

  describe("agent", () => {
    it("creates an agent with defaults", () => {
      const a = samples.agent();
      expect(a.kind).toBe("Agent");
      expect(a.metadata?.name).toBe("Demo Agent");
      expect(a.spec?.description).toContain("sample agent");
    });

    it("derives slug from name override", () => {
      const a = samples.agent({ name: "My Custom Agent" });
      expect(a.metadata?.slug).toBe("my-custom-agent");
    });
  });

  describe("run", () => {
    it("creates a completed run started with a greeting", () => {
      const ex = samples.run();
      expect(ex.kind).toBe("Run");
      expect(ex.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(ex.spec?.message).toBe("Hello! Can you help me get started?");
      expect(ex.spec?.target).toEqual({ case: "sessionId", value: "ses_00000000000000000000000001" });
    });

    it("uses the provided id, phase and message", () => {
      const ex = samples.run({
        id: "run_x",
        sessionId: "ses_x",
        phase: RunPhase.RUN_IN_PROGRESS,
        message: "test input",
      });
      expect(ex.metadata?.id).toBe("run_x");
      expect(ex.spec?.target.value).toBe("ses_x");
      expect(ex.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
      expect(ex.spec?.message).toBe("test input");
    });
  });

  describe("skill", () => {
    it("creates a skill with SKILL.md content", () => {
      const sk = samples.skill();
      expect(sk.kind).toBe("Skill");
      expect(sk.spec?.skillMd).toContain("# Demo Skill");
    });

    it("applies custom skillMd", () => {
      const sk = samples.skill({ skillMd: "# My Skill\nCustom content" });
      expect(sk.spec?.skillMd).toContain("# My Skill");
    });
  });

  describe("plugin", () => {
    it("creates a plugin holding one server that signs in", () => {
      const p = samples.plugin();
      expect(p.kind).toBe("Plugin");
      expect(p.metadata?.name).toBe("demo-plugin");
      expect(p.status?.mcpServers[0]?.transport.case).toBe("http");
      expect(p.status?.mcpServers[0]?.signIn).toBeDefined();
    });
  });

  describe("vault", () => {
    it("creates a shared vault with defaults", () => {
      const v = samples.vault();
      expect(v.kind).toBe("Vault");
      expect(v.metadata?.name).toBe("demo-vault");
      expect(v.spec?.owner.case).toBe("org");
    });
  });

  describe("session events", () => {
    it("files each event under the demo run, with an id derived from it", () => {
      const user = samples.userMessageEvent("Hello");
      expect(user.runId).toBe("run_00000000000000000000000001");
      expect(user.threadId).toBe("");
      expect(user.event.case).toBe("userMessage");
      expect(user.event.value?.id).toBe("run_00000000000000000000000001.user");

      const reply = samples.agentMessageEvent("Hi", { runId: "r2", id: "r2.root.m3", threadId: "r2.sub" });
      expect(reply.runId).toBe("r2");
      expect(reply.threadId).toBe("r2.sub");
      expect(reply.event.value?.id).toBe("r2.root.m3");
    });

    it("writes a thinking as its event and the text that follows it", () => {
      const [thinking, text] = samples.thinkingEvents("weigh it", { runId: "r" });
      expect(thinking!.event).toMatchObject({ case: "agentThinking", value: { id: "r.root.t0" } });
      expect(text!.event).toMatchObject({
        case: "stigmerAgentThinking",
        value: { id: "r.root.t0.text", thinkingId: "r.root.t0", text: "weigh it" },
      });
    });

    it("writes built-in and MCP tool uses and results", () => {
      const builtIn = samples.toolUseEvent("read", { path: "a.md" }, { evaluatedPermission: "ask" });
      expect(builtIn.event).toMatchObject({
        case: "agentToolUse",
        value: { id: "run_00000000000000000000000001.tc-read", evaluatedPermission: "ask", input: { path: "a.md" } },
      });
      const mcp = samples.toolUseEvent("create_issue", undefined, { mcpServerName: "github" });
      expect(mcp.event).toMatchObject({ case: "agentMcpToolUse", value: { mcpServerName: "github", input: {} } });

      const result = samples.toolResultEvent("tu-1", "done", { isError: true });
      expect(result.event).toMatchObject({ case: "agentToolResult", value: { id: "tu-1.r", toolUseId: "tu-1", isError: true } });
      const mcpResult = samples.toolResultEvent("tu-2", "", { mcp: true });
      expect(mcpResult.event).toMatchObject({ case: "agentMcpToolResult", value: { mcpToolUseId: "tu-2", content: [] } });
    });

    it("writes an ask and a run status", () => {
      expect(samples.permissionAskedEvent("tu-1").event).toMatchObject({
        case: "stigmerPermissionAsked",
        value: { id: "tu-1.ask", toolUseId: "tu-1", policySource: "builtin_category", message: "" },
      });
      expect(
        samples.permissionAskedEvent("tu-1", { message: "Run it?", argsPreview: "{}", policySource: "hook", policyHook: "safety" }).event,
      ).toMatchObject({ value: { message: "Run it?", argsPreview: "{}", policySource: "hook", policyHook: "safety" } });
      expect(samples.runStatusEvent("failed", { error: "boom", stopCause: "failed" }).event).toMatchObject({
        case: "stigmerRunStatus",
        value: { id: "run_00000000000000000000000001.status.failed", phase: "failed", error: "boom", stopCause: "failed" },
      });
    });

    it("writes a whole turn in log order, and folds it", () => {
      const events = samples.turnEvents({
        runId: "r",
        message: "check",
        tools: [
          { name: "read", input: { path: "a" }, result: "contents" },
          { name: "create_issue", mcpServerName: "github", result: "nope", isError: true },
          { name: "shell" },
        ],
        reply: "Done.",
      });
      expect(events.map((e) => e.event.case)).toEqual([
        "userMessage",
        "stigmerRunStatus",
        "agentToolUse",
        "agentToolResult",
        "agentMcpToolUse",
        "agentMcpToolResult",
        "agentToolUse",
        "agentMessage",
        "stigmerRunStatus",
      ]);

      const turn = samples.fold(events).turns[0]!;
      expect(turn.userMessage?.text).toBe("check");
      expect(turn.answer).toBe("Done.");
      expect(turn.status?.phase).toBe("completed");
      expect(turn.items.filter((i) => i.kind === "tool_use").map((i) => i.kind === "tool_use" && i.state)).toEqual([
        "completed",
        "failed",
        "stopped",
      ]);
    });

    it("leaves a running turn open and a turn with no reply without one", () => {
      const events = samples.turnEvents({ phase: "running", reply: "" });
      expect(events.map((e) => e.event.case)).toEqual(["userMessage", "stigmerRunStatus"]);
      const turn = samples.turn({ phase: "running", reply: "" });
      expect(turn.ended).toBe(false);
      expect(turn.answer).toBe("");
    });

    it("folds a default turn: the greeting and its answer", () => {
      const turn = samples.turn();
      expect(turn.userMessage?.text).toBe("Hello! Can you help me get started?");
      expect(turn.ended).toBe(true);
    });

    it("folds a single tool use, returned or still running", () => {
      const done = samples.toolUse("read", "contents", { input: { path: "a.md" } });
      expect(done).toMatchObject({ name: "read", state: "completed", input: { path: "a.md" }, result: { text: "contents" } });
      const failed = samples.toolUse("create_issue", "nope", { mcpServerName: "github", isError: true });
      expect(failed).toMatchObject({ mcpServerName: "github", state: "failed" });
      expect(samples.toolUse("shell").state).toBe("running");
    });

    it("numbers list and stream responses in order", () => {
      const list = samples.sessionEventList([samples.userMessageEvent("a"), samples.agentMessageEvent("b")]);
      expect(list.events.map((e) => e.seq)).toEqual([1n, 2n]);
      const frame = samples.eventFrame(samples.userMessageEvent("a"));
      expect(frame.frame.case).toBe("event");
    });
  });

  describe("output File primitive", () => {
    it("is a File the demo run returned, saved at its filename by default", () => {
      const f = samples.outputFile("report.md");
      expect(f.spec?.filename).toBe("report.md");
      expect(f.status?.runId).toBe(samples.run().metadata?.id);
      expect(f.status?.outputPath).toBe("report.md");
    });
  });

  describe("list responses", () => {
    it("sessionList wraps sessions", () => {
      const list = samples.sessionList();
      expect(list.entries).toHaveLength(1);
      expect(list.nextPageToken).toBe("");
    });

    it("sessionList accepts custom entries", () => {
      const sessions = [
        samples.session({ name: "s1" }),
        samples.session({ name: "s2" }),
      ];
      const list = samples.sessionList(sessions);
      expect(list.entries).toHaveLength(2);
    });

    it("runList wraps runs", () => {
      const list = samples.runList();
      expect(list.entries).toHaveLength(1);
      expect(list.nextPageToken).toBe("");
    });

    it("searchResponse wraps search results", () => {
      const resp = samples.searchResponse();
      expect(resp.entries).toHaveLength(1);
      expect(resp.countsByKind).toEqual({ agent: 1 });
      expect(resp.nextPageToken).toBe("");
    });

    it("searchResult accepts overrides", () => {
      const r = samples.searchResult({
        kind: ApiResourceKind.skill,
        name: "My Skill",
        slug: "my-skill",
        org: "acme",
      });
      expect(r.kind).toBe(ApiResourceKind.skill);
      expect(r.name).toBe("My Skill");
      expect(r.qualifiedSlug).toBe("acme/my-skill");
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism — the reason these factories exist. A `samples.*` value is
// rendered into tests and stories that must give the same result on every
// run, so any live-clock read paints a pixel that changes between runs. These tests are the regression lock: each one
// FAILS if a factory is reverted to reading the clock.
// ---------------------------------------------------------------------------

describe("samples determinism", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A zero-arg call for every factory, with representative arguments. The
  // completeness test below asserts this map covers `samples` exactly, so a
  // newly-added factory that reads the clock cannot slip past the stability
  // sweep unnoticed.
  const invoke: Record<keyof typeof samples, () => unknown> = {
    session: () => samples.session(),
    agent: () => samples.agent(),
    run: () => samples.run(),
    skill: () => samples.skill(),
    plugin: () => samples.plugin(),
    vault: () => samples.vault(),
    apiKey: () => samples.apiKey(),
    organization: () => samples.organization(),
    organizationList: () => samples.organizationList(),
    userMessageEvent: () => samples.userMessageEvent("hello"),
    agentMessageEvent: () => samples.agentMessageEvent("hi"),
    thinkingEvents: () => samples.thinkingEvents("hm"),
    toolUseEvent: () => samples.toolUseEvent("lookup_order", { orderId: "123" }),
    toolResultEvent: () => samples.toolResultEvent("tu", "{}"),
    permissionAskedEvent: () => samples.permissionAskedEvent("tu"),
    runStatusEvent: () => samples.runStatusEvent("completed"),
    turnEvents: () => samples.turnEvents({ tools: [{ name: "read", result: "x" }] }),
    fold: () => samples.fold(samples.turnEvents()),
    turn: () => samples.turn(),
    toolUse: () => samples.toolUse("lookup_order", "{}"),
    sessionEventList: () => samples.sessionEventList(samples.turnEvents()),
    eventFrame: () => samples.eventFrame(samples.userMessageEvent("x")),
    outputFile: () => samples.outputFile("report.md"),
    sessionList: () => samples.sessionList(),
    runList: () => samples.runList(),
    searchResponse: () => samples.searchResponse(),
    apiKeyList: () => samples.apiKeyList(),
    searchResult: () => samples.searchResult(),
  };

  it("the stability sweep covers every factory", () => {
    expect(Object.keys(invoke).sort()).toEqual(Object.keys(samples).sort());
  });

  // Two calls under system clocks a full calendar day apart must produce
  // identical objects. The day boundary is deliberate: it is what reproduces
  // the `apiKey` bug (a `createdAt` date that changed daily) and the message
  // and tool-use timestamp drift, none of which a same-millisecond back-to-
  // back call would expose.
  it.each(Object.keys(invoke) as (keyof typeof samples)[])(
    "%s is identical across a day boundary",
    (name) => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-03-01T08:15:00Z"));
      const first = invoke[name]();

      vi.setSystemTime(new Date("2026-03-02T21:45:30Z"));
      const second = invoke[name]();

      expect(second).toEqual(first);
    },
  );

  it("stamps the frozen instant on every timestamped primitive", () => {
    expect(samples.userMessageEvent("x").event.value?.processedAt).toBe(SAMPLE_INSTANT);
    expect(samples.agentMessageEvent("x").event.value?.processedAt).toBe(SAMPLE_INSTANT);
    expect(samples.toolUse("x", "y").processedAt).toBe(SAMPLE_INSTANT);
    expect(samples.agentMessageEvent("x", { processedAt: sampleInstant(5_000) }).event.value?.processedAt).toBe(
      sampleInstant(5_000),
    );

    const createdAt = samples.apiKey().status?.audit?.specAudit?.createdAt;
    expect(createdAt).toBeDefined();
    expect(timestampDate(createdAt!).toISOString()).toBe(SAMPLE_INSTANT);
  });

  it("renders a stable duration chip rather than the old 0ms flake", () => {
    const tu = samples.toolUse("lookup_order", "{}");
    expect(formatDuration(tu.processedAt, tu.result!.processedAt)).toBe("1.2s");
  });

  it("derives a clock-free tool-use id from the run and the name", () => {
    expect(samples.toolUse("process_return", "{}").id).toBe("run_00000000000000000000000001.tc-process_return");
  });

  it("honors an ApiKeyOverrides.createdAt override", () => {
    const frozen = "2026-01-02T03:04:05.000Z";
    const key = samples.apiKey({ createdAt: frozen });
    const createdAt = key.status?.audit?.specAudit?.createdAt;
    expect(timestampDate(createdAt!).toISOString()).toBe(frozen);
  });
});

// ---------------------------------------------------------------------------
// The reader offset window — why SAMPLE_INSTANT is 11:00 UTC. Components
// format dates in the reader's local time, and real UTC offsets span −11:00
// to +14:00 (25 hours against a 24-hour day), so no instant renders one
// calendar date everywhere. The supported window is UTC−11:00 (Midway)
// through UTC+12:45 (Chatham, southern winter): every inhabited zone except
// Tongatapu (+13) and Kiritimati (+14). Local date is monotonic in offset,
// so agreement at the two boundaries proves agreement throughout.
// ---------------------------------------------------------------------------

describe("SAMPLE_INSTANT reader offset window", () => {
  const WEST_OFFSET_MINUTES = -11 * 60; // UTC−11:00, Midway
  const EAST_OFFSET_MINUTES = 12 * 60 + 45; // UTC+12:45, Chatham (Jul)

  /** Calendar date (YYYY-MM-DD) the instant renders at a fixed UTC offset. */
  const localDateAtOffset = (iso: string, offsetMinutes: number): string =>
    new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);

  it("renders one calendar date at both window boundaries", () => {
    const west = localDateAtOffset(SAMPLE_INSTANT, WEST_OFFSET_MINUTES);
    const east = localDateAtOffset(SAMPLE_INSTANT, EAST_OFFSET_MINUTES);
    expect(west).toBe("2026-07-20");
    expect(east).toBe("2026-07-20");
  });

  // The two anchors this one replaced, kept as negative cases so nobody
  // "corrects" the constant back: 09:30Z was the original tour-world instant
  // (read Jul 19 in Honolulu); noon was SAMPLE_INSTANT's first value and the
  // once-planned fix (read Jul 21 in Auckland, Fiji, and Chatham).
  it.each([
    ["2026-07-20T09:30:00.000Z", "drifts at the west boundary"],
    ["2026-07-20T12:00:00.000Z", "drifts at the east boundary"],
  ])("rejected anchor %s %s", (iso) => {
    expect(localDateAtOffset(iso, WEST_OFFSET_MINUTES)).not.toBe(
      localDateAtOffset(iso, EAST_OFFSET_MINUTES),
    );
  });
});

describe("sampleInstant / sampleDate derivation", () => {
  it("sampleInstant with no delta is the anchor itself", () => {
    expect(sampleInstant()).toBe(SAMPLE_INSTANT);
  });

  it("applies positive and negative deltas exactly", () => {
    expect(sampleInstant(2_400)).toBe("2026-07-20T11:00:02.400Z");
    expect(sampleInstant(-86_400_000)).toBe("2026-07-19T11:00:00.000Z");
  });

  it("sampleDate agrees with sampleInstant at every delta", () => {
    for (const deltaMs of [0, 1_200, 2_400, -3_600_000, 86_400_000]) {
      expect(sampleDate(deltaMs).toISOString()).toBe(sampleInstant(deltaMs));
    }
  });

  it("the default tool-use span derives from the anchor", () => {
    const tu = samples.toolUse("lookup_order", "{}");
    expect(tu.processedAt).toBe(sampleInstant());
    expect(tu.result?.processedAt).toBe(sampleInstant(1_200));
  });
});
