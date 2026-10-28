/**
 * `runClaudeTurn`'s own branches, over a scripted engine: what the real
 * engine in the hermetic goldens never does on cue.
 *
 * The goldens (`__tests__/hermetic/`) run the real engine, which answers
 * every stop in time, never fails its interrupt, writes nothing to stderr,
 * and is never handed a refused turn. Here the SDK is a stand-in whose
 * `query` plays a script, so each of the turn's own decisions is pinned:
 *
 *  - the refusals, each actionable with its sentence: the fast tier, a
 *    model that is not Claude, skills that cannot be named apart;
 *  - the engine is handed the turn's skills as plugins it can load, with
 *    their exact allowlist, and its sub-agents as definitions, and a skill
 *    or sub-agent the engine did not load is warned of;
 *  - the turn's internal failures: no turn key (the engine runs only in the
 *    agent host), no model lane, an http store with no endpoint, an engine
 *    that fails before any result;
 *  - a stop the engine does not answer within its grace is aborted, and an
 *    interrupt that fails changes nothing;
 *  - a message sent while a call is open and nothing streams is taken then,
 *    and a continued turn opens with the messages its run took that the
 *    engine never read;
 *  - the engine's stderr reaches the runner's log, bounded;
 *  - an agent's tool list naming an MCP tool no server offers is warned of;
 *  - a teardown that fails is logged and never masks the outcome.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { Config } from "../../../config.js";
import type { TurnInput, TurnSubagent } from "../../../harness/types.js";
import type { TurnInputChannel, TurnMessage } from "../../../harness/turn-input.js";
import { runWithExecutionContext } from "../../../shared/execution-context.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { getClaudeEngineDir, getClaudeTranscriptDir } from "../../../shared/workspace/platform-dir.js";
import { createHermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { FIXTURE_CLAUDE_MODEL, stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { HttpMcpServer } from "../../../__test-utils__/http-mcp-server.js";
import { runMessageIdOf, sentMessageIdOf } from "../engine-session-id.js";
import { ApprovalPolicySource, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { ROOT_CALLER, type GateVerdict } from "../gate.js";
import { STOP_GRACE_MS, proposeDeferred, runClaudeTurn, type ClaudeAdapterConfig, type ClaudeSdk } from "../turn.js";

const env = createHermeticEnvironment();
const SESSION = "ses_turn_unit";
const CONFIG: ClaudeAdapterConfig = {
  checkpointerType: "memory",
  checkpointerProxyEndpoint: null,
  stigmerTokenRef: { current: null },
  proxyEndpoint: "http://127.0.0.1:1",
  shellTimeoutMaxSeconds: 60,
  mode: "local" satisfies Config["mode"],
  cursorStreamStallTimeoutMs: 300_000,
  openOperationMaxMs: 3_600_000,
};

/** What a scripted engine is handed, and how a script tells the test where it is. */
interface Played {
  readonly options: Options;
  readonly prompt: AsyncIterable<SDKUserMessage> | string;
  readonly interrupted: { count: number };
}

type Script = (played: Played) => AsyncGenerator<SDKMessage, void, undefined>;

/** An SDK whose `query` plays `script`; `interrupt` rejects when `interruptFails`. */
function scriptedSdk(script: Script, interruptFails = false): { readonly sdk: ClaudeSdk; readonly played: Played[] } {
  const played: Played[] = [];
  const query = (args: { prompt: AsyncIterable<SDKUserMessage> | string; options?: Options }): Query => {
    const run: Played = { options: args.options ?? {}, prompt: args.prompt, interrupted: { count: 0 } };
    played.push(run);
    const messages = script(run);
    const handle = {
      [Symbol.asyncIterator]: () => messages,
      next: () => messages.next(),
      interrupt: async (): Promise<void> => {
        run.interrupted.count += 1;
        if (interruptFails) throw new Error("the engine refused the interrupt");
      },
      close: (): void => {},
    };
    return handle as unknown as Query;
  };
  return { sdk: { query } as unknown as ClaudeSdk, played };
}

function init(plugins: readonly string[] = []): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    tools: ["Read"],
    mcp_servers: [],
    agents: [],
    plugins: plugins.map((name) => ({ name, path: `/plugins/${name}` })),
    skills: [],
    model: "claude-sonnet-4-6",
    cwd: "/",
    session_id: "s",
    uuid: "00000000-0000-4000-8000-000000000001",
  } as unknown as SDKMessage;
}

function result(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done.",
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    session_id: "s",
    uuid: "00000000-0000-4000-8000-000000000002",
  } as unknown as SDKMessage;
}

function toolCall(id: string): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: `msg_${id}`, type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id, name: "Read", input: { file_path: "/a" } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    session_id: "s",
    uuid: "00000000-0000-4000-8000-000000000003",
  } as unknown as SDKMessage;
}

/** An input channel a test raises the pending hint on, holding `waiting` until claimed. */
function heldInput(waiting: TurnMessage[]): TurnInputChannel & { raise(): void; readonly claims: number[] } {
  const listeners = new Set<() => void>();
  const claims: number[] = [];
  let pending = false;
  return {
    claims,
    pending: () => pending,
    onPending: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    claim: async () => {
      claims.push(waiting.length);
      pending = false;
      return waiting.splice(0);
    },
    claimed: async () => [],
    raise: () => {
      pending = true;
      for (const listener of listeners) listener();
    },
  };
}

function input(overrides: Parameters<typeof turnInputFixture>[0] = {}): TurnInput {
  return turnInputFixture({
    sessionId: SESSION,
    threadId: `thread-${SESSION}`,
    workspaceDir: env.workspaceRootDir,
    model: { requested: FIXTURE_CLAUDE_MODEL, serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED },
    ...overrides,
  });
}

/** One turn as the agent host runs it: inside the turn's execution context, holding its key. */
function turn(turnInput: TurnInput, sink: RecordingTurnSink, sdk: ClaudeSdk, config: ClaudeAdapterConfig = CONFIG) {
  return runWithExecutionContext(turnInput.executionId, () => runClaudeTurn(turnInput, sink, config, sdk), "turn-key");
}

const NEVER: Script = async function* () {};

describe("runClaudeTurn", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;
  const docs = new HttpMcpServer([{ name: "lookup", description: "Look up.", inputSchema: { type: "object" } }], async () => "Found.");

  beforeAll(async () => {
    await docs.start();
    registry = stubRegistryFetch({ localOrigins: [docs.url] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    registry.restore();
    await docs.stop();
    env.dispose();
  });

  it("refuses what it cannot run yet, each with the sentence that says how", async () => {
    const refusals: [Parameters<typeof turnInputFixture>[0], RegExp][] = [
      [
        {
          skills: {
            root: [
              { name: "notes.style", description: "d", path: ".stigmer/skills/notes.style/SKILL.md" },
              { name: "notes-style", description: "d", path: ".stigmer/skills/notes-style/SKILL.md" },
            ],
            bySubAgent: new Map(),
          },
        },
        /both load on the Claude Agent harness as 'agent:notes-style'/,
      ],
      [{ model: { requested: FIXTURE_CLAUDE_MODEL, serviceTier: ServiceTier.FAST, thinkingMode: ThinkingMode.DISABLED } }, /fast tier/],
      [{ model: { requested: "fixture-model", serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED } }, /Claude models only/],
    ];
    const { sdk, played } = scriptedSdk(NEVER);
    for (const [overrides, sentence] of refusals) {
      const outcome = await turn(input(overrides), new RecordingTurnSink(), sdk);
      expect(outcome).toMatchObject({ kind: "failed", surface: "actionable" });
      expect(outcome.kind === "failed" ? outcome.message : "").toMatch(sentence);
    }
    expect(played, "a refused turn never starts the engine").toEqual([]);
  });

  it("fails internally without the turn's key, without a model lane, and with an http store that has no endpoint", async () => {
    const { sdk, played } = scriptedSdk(NEVER);
    // Outside the agent host's execution context: no turn's key to hand the engine.
    const noKey = await runClaudeTurn(input(), new RecordingTurnSink(), CONFIG, sdk);
    expect(noKey.kind === "failed" ? [noKey.surface, noKey.message] : []).toEqual(["internal", expect.stringContaining("agent host")]);
    const noLane = await turn(input(), new RecordingTurnSink(), sdk, { ...CONFIG, proxyEndpoint: null });
    expect(noLane.kind === "failed" ? noLane.message : "").toMatch(/no model lane/);
    const noStore = await turn(input(), new RecordingTurnSink(), sdk, { ...CONFIG, checkpointerType: "http", checkpointerProxyEndpoint: null });
    expect(noStore.kind === "failed" ? noStore.message : "").toMatch(/no proxy endpoint/);
    expect(played).toEqual([]);
  });

  it("fails internally when the engine fails before any result", async () => {
    const { sdk } = scriptedSdk(async function* () {
      yield init();
      throw new Error("the engine's process exited with code 1");
    });
    const outcome = await turn(input(), new RecordingTurnSink(), sdk);
    expect(outcome.kind === "failed" ? [outcome.surface, outcome.message] : []).toEqual(["internal", expect.stringContaining("exited with code 1")]);
  });

  it("logs the engine's stderr bounded, and its plugins at init", async () => {
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    const { sdk } = scriptedSdk(async function* (played) {
      played.options.stderr?.(`${"x".repeat(3_000)}\n`);
      yield init(["seen-plugin"]);
      yield result();
    });
    const outcome = await turn(input(), new RecordingTurnSink(), sdk);
    expect(outcome.kind).toBe("completed");
    const stderr = warn.mock.calls.map((args) => String(args[0])).find((line) => line.startsWith("[claude-engine]")) ?? "";
    expect(stderr.length).toBeLessThan(2_100);
    expect(log.mock.calls.some((args) => String(args[0]).includes("plugins=seen-plugin"))).toBe(true);
  });

  it("aborts a stopped engine that does not end within its grace, whatever its interrupt said", async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { sdk, played } = scriptedSdk(async function* (run) {
      yield init();
      started();
      await new Promise<void>((resolve) => run.options.abortController!.signal.addEventListener("abort", () => resolve()));
      throw new Error("aborted");
    }, true);
    const sink = new RecordingTurnSink();
    const outcome = turn(input(), sink, sdk);
    await running;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    sink.abort();
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    vi.useRealTimers();
    expect((await outcome).kind).toBe("interrupted");
    expect(played[0]!.interrupted.count).toBe(1);
    expect(played[0]!.options.abortController!.signal.aborted, "aborted at the grace").toBe(true);
  });

  it("takes a message sent while a call is open and nothing streams", async () => {
    const channel = heldInput([{ id: "evt_msg_1", text: "Also this.", message: [], visionImages: [], visionNotViewable: [] }]);
    const { sdk } = scriptedSdk(async function* () {
      yield init();
      yield toolCall("toolu_open");
      channel.raise();
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield result();
    });
    const outcome = await turn(input(), new RecordingTurnSink({ input: channel }), sdk);
    expect(outcome.kind).toBe("completed");
    expect(channel.claims[0], "taken while the call was open").toBe(1);
  });

  it("opens a continued turn with the messages its run took that the engine never read", async () => {
    const turnInput = input();
    const thread = turnInput.threadId;
    const file = join(getClaudeTranscriptDir(SESSION), encodeURIComponent(thread), "transcript.jsonl");
    mkdirSync(join(file, ".."), { recursive: true });
    // The run's own message was taken; the model's last word called a tool.
    const taken = { type: "user", uuid: runMessageIdOf(turnInput.executionId), message: { role: "user", content: "Task." } };
    const calling = { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } };
    writeFileSync(file, `${JSON.stringify(taken)}\n${JSON.stringify(calling)}\n`);
    const owed: TurnMessage = { id: "evt_owed_1", text: "And this.", message: [], visionImages: [], visionNotViewable: [] };
    const channel: TurnInputChannel = { pending: () => false, onPending: () => () => {}, claim: async () => [], claimed: async () => [owed] };
    let opened: SDKUserMessage | undefined;
    const { sdk } = scriptedSdk(async function* (run) {
      const first = await (run.prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]().next();
      opened = first.value as SDKUserMessage;
      yield init();
      yield result();
    });
    const outcome = await turn(turnInput, new RecordingTurnSink({ input: channel }), sdk, { ...CONFIG, checkpointerType: "sqlite" });
    expect(outcome.kind).toBe("completed");
    expect(opened?.uuid, "the owed message, under its own id, never the task").toBe(sentMessageIdOf(owed.id));
  });

  it("hands the engine the turn's skills as plugins and its sub-agents as definitions, and warns of what it did not load", async () => {
    const warn = vi.spyOn(console, "warn");
    const skillDir = join(env.workspaceRootDir, ".stigmer", "skills", "review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: review\nallowed-tools: Bash\n---\nReview carefully.\n");
    const review = { name: "review", description: "Reviews a change.", path: ".stigmer/skills/review/SKILL.md" };
    const runner: TurnSubagent = {
      name: "test-runner",
      description: "Runs the tests.",
      instructions: "You run the tests.",
      model: undefined,
      toolScope: ToolScope.of("Subagent \"test-runner\"", { tools: [], disallowedTools: ["Agent"] }),
      servers: [],
      skills: [],
      hooks: [],
      values: { RUNNER_ONLY: "1" },
      bringsOwn: { plugins: false, hooks: false, lists: false, mcpServers: false },
    };
    let written = "";
    const { sdk, played } = scriptedSdk(async function* (run) {
      const plugin = run.options.plugins?.[0];
      written = plugin === undefined ? "" : readFileSync(join(plugin.path, "skills", "review", "SKILL.md"), "utf8");
      yield init();
      yield result();
    });
    const outcome = await turn(input({ skills: { root: [review], bySubAgent: new Map() }, subagents: [runner] }), new RecordingTurnSink(), sdk);
    expect(outcome.kind).toBe("completed");
    const options = played[0]!.options;
    expect(options.skills).toEqual(["agent:review"]);
    expect(options.plugins).toHaveLength(1);
    expect(options.pluginDelivery).toBe("initialize");
    expect(written).toBe('---\nname: "review"\ndescription: "Reviews a change."\n---\n\nReview carefully.\n');
    expect(options.tools).toEqual(expect.arrayContaining(["Skill", "Agent", "Bash"]));
    expect(Object.keys(options.agents ?? {})).toEqual(["test-runner"]);
    expect(options.agents?.["test-runner"]).toMatchObject({ description: "Runs the tests.", model: "inherit", mcpServers: ["stigmer"] });
    expect(options.agents?.["test-runner"]?.tools).not.toContain("Agent");
    expect(options.agents?.["test-runner"]?.tools).not.toContain("Skill");
    const warned = warn.mock.calls.map((args) => String(args[0]));
    expect(warned.some((line) => line.includes("the engine did not load skill agent:review, sub-agent test-runner"))).toBe(true);
  });

  it("warns of an agent's tool list naming an MCP tool no server offers", async () => {
    const warn = vi.spyOn(console, "warn");
    const scoped = input();
    const turnInput: TurnInput = {
      ...scoped,
      mcp: {
        ...scoped.mcp,
        servers: [{ slug: "docs", connectionType: "http", url: `${docs.url}/mcp`, headers: {}, home: { kind: "agent", agentId: "agt", subagent: null, server: "docs" } }],
        toolScope: ToolScope.of("agent", { tools: ["Read", "mcp__docs__lookup", "mcp__docs__missing"], disallowedTools: [] }),
      },
    };
    const { sdk } = scriptedSdk(async function* () {
      yield init();
      yield result();
    });
    expect((await turn(turnInput, new RecordingTurnSink(), sdk)).kind).toBe("completed");
    expect(warn.mock.calls.some((args) => String(args[0]).startsWith("[claude-turn]") && String(args[0]).includes("mcp__docs__missing"))).toBe(true);
  });

  it("logs a teardown that fails and keeps the turn's outcome", async () => {
    const warn = vi.spyOn(console, "warn");
    const engineDir = getClaudeEngineDir(SESSION);
    const { sdk } = scriptedSdk(async function* () {
      yield init();
      // The turn's own directory cannot be removed once its parent is read-only.
      mkdirSync(engineDir, { recursive: true });
      chmodSync(engineDir, 0o500);
      yield result();
    });
    try {
      expect((await turn(input(), new RecordingTurnSink(), sdk)).kind).toBe("completed");
    } finally {
      chmodSync(engineDir, 0o700);
    }
    expect(warn.mock.calls.some((args) => String(args[0]).includes("engine directory cleanup failed"))).toBe(true);
  });
});

describe("proposeDeferred", () => {
  const paused = (toolName: string, hook?: string): GateVerdict => ({
    kind: "pause",
    message: "Run rm -rf build?",
    source: hook === undefined ? "builtin_category" : "hook",
    caller: ROOT_CALLER,
    toolName,
    args: { command: "rm -rf build" },
    hook,
  });
  const bridge = { serverOf: (name: string) => (name === "mcp__ops__purge" ? { slug: "ops", tool: "purge" } : undefined) };

  it("opens the deferred call's WAITING row from the gate's pause: the shell as Bash, an MCP call with its server, the asking hook named", () => {
    const sink = new RecordingTurnSink();
    proposeDeferred(sink, { verdictOf: () => paused("mcp__stigmer__bash") }, bridge, "toolu_shell");
    proposeDeferred(sink, { verdictOf: () => paused("mcp__ops__purge", "safety") }, bridge, "toolu_mcp");
    const rows = sink.rows.messages.flatMap((message) => message.toolCalls);
    expect(rows.map((row) => [row.id, row.name, row.mcpServerSlug, row.status, row.approvalMessage, row.approvalPolicySource, row.approvalPolicyHook])).toEqual([
      ["toolu_shell", "Bash", "", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, "Run rm -rf build?", ApprovalPolicySource.BUILTIN_CATEGORY, ""],
      ["toolu_mcp", "purge", "ops", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, "Run rm -rf build?", ApprovalPolicySource.HOOK, "safety"],
    ]);
    expect(rows.every((row) => row.args === undefined || Object.keys(row.args).length === 0), "the proposal carries no arguments: the row keeps the model's call").toBe(true);
  });

  it("refuses a deferral the gate did not hold for a person", () => {
    expect(() => proposeDeferred(new RecordingTurnSink(), { verdictOf: () => undefined }, bridge, "toolu_x")).toThrow(/did not hold for a person/);
  });
});
