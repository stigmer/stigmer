/**
 * The Claude gate's decisions, one rule per case, in the order the gate
 * takes them (`gate.ts`).
 *
 * Why it matters: the gate is the only thing between the model and a side
 * effect, and nothing that needs a person may run without one. Pinned here,
 * each case written so that it fails if its rule is removed:
 *  - the closed world and scope: a tool the turn never offered, the engine's
 *    own shell, another caller's tools or skills, a helper the turn does not
 *    define or one whose definition a call would override, platform content
 *    and the engine's home, skill files for a caller whose lists deny
 *    `Skill`, and any read but the platform's content for a caller whose
 *    lists exclude `Read`: refused even when the whole run is trusted;
 *  - the pause: the main agent's call that needs a person pauses with the
 *    card's message; one deferral an invocation, a second refused with the
 *    sentence that asks for it alone, the deferral freed when the engine
 *    ignored it; a sub-agent's call is refused (or skipped, unattended);
 *  - a person's answer by the call's id: a refusal binds with their reason,
 *    an approval runs the call only as they saw it (a value the log cut
 *    compared on the head it kept), a hook's deny binds after an approval;
 *  - a call an earlier, stopped run left waiting, and one this run left
 *    pending without proposing it;
 *  - the agent's hooks in the native gate's order: deny, ask (with the
 *    hook named), allow (a lease on an ask included), a rewrite judged
 *    again and returned to the engine, an ask with a rewrite refused, under
 *    "trust this whole run" only the hooks, a sub-agent's own hooks and its
 *    hook's ask refused naming the hook;
 *  - observations: a write the gate lets run where review captures an
 *    ignored path is observed before it lands, a blocked secret recorded;
 *  - admission: the host's tools run a call only under its own allow
 *    verdict, for its tool, with exactly its arguments, once.
 *
 * The engine's mechanisms (`PreToolUse` and `canUseTool`) read one memoized
 * decision per call id.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

import { ApprovalAction } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { hookLeaseKey, resolveToolApproval, unattendedSkipMessage, type ActiveLeases, type McpApprovalDefault } from "../../../shared/approval-policy.js";
import { secretBlockMessage } from "../../../shared/file-edit-policy.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import { askWithRewriteMessage, hookRefusalMessage, personDecisionSentence } from "../../../shared/hooks/messages.js";
import type { HookProcessRunner, HookRunResult } from "../../../shared/hooks/run.js";
import { ELISION_MARKER } from "../../../shared/status-offload.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import {
  ASK_ALONE_MESSAGE,
  CHANGED_MESSAGE,
  ClaudeGate,
  HALTED_MESSAGE,
  HIDDEN_SKILLS_MESSAGE,
  PLATFORM_READ_ONLY_MESSAGE,
  NOT_ADMITTED_MESSAGE,
  READ_ONLY_MESSAGE,
  ROOT_CALLER,
  STALE_CALL_MESSAGE,
  SUBAGENT_APPROVAL_MESSAGE,
  UNKNOWN_CALLER_MESSAGE,
  canUseToolOf,
  gateFactsOf,
  gateHooks,
  helperOverrideMessage,
  helperStartAskMessage,
  notOfferedMessage,
  sameAsShown,
  skillNotOwnedMessage,
  subagentHookAskMessage,
  unknownHelperMessage,
  type Caller,
  type GateFacts,
  type GateVerdict,
  type Reach,
} from "../gate.js";
import { ClaudeToolViews } from "../hook-views.js";
import { NO_HOOKS, type TurnHookEvaluators } from "../hooks.js";

const WORKSPACE = "/work/repo";
const PLATFORM = "/sessions/ses_1/platform";
const HOME = "/sessions/ses_1/claude/aex_1-0";
const SHELL = "mcp__stigmer__bash";
const OFFERED = new Set(["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Bash", "TodoWrite", SHELL, "mcp__docs__search", "mcp__docs__drop", "mcp__plugin__any", "Skill", "Agent"]);

/** The main agent's reach: every tool above, two skills (one dotted, by both spellings), two helpers. */
const ROOT_REACH: Reach = {
  tools: OFFERED,
  skills: new Set(["agent:review", "agent:platform-x", "agent:platform.x"]),
  agentTypes: new Set(["test-runner", "acme:helper"]),
  hidesSkills: false,
  confinedRead: false,
};

/** A saved helper's reach: the read tools, the shell, its own server and skill, no `Agent`. */
const RUNNER_REACH: Reach = {
  tools: new Set(["Read", "Glob", "Grep", "Bash", SHELL, "mcp__ci__run", "Skill"]),
  skills: new Set(["agent:ci-checklist"]),
  agentTypes: new Set(),
  hidesSkills: false,
  confinedRead: false,
};

/** A plugin helper whose lists deny `Skill`. */
const HELPER_REACH: Reach = { tools: new Set(["Read", "Write"]), skills: new Set(), agentTypes: new Set(), hidesSkills: true, confinedRead: false };

const RUNNER: Caller = { kind: "subagent", type: "test-runner" };

/** An allow under `source`, judged as `caller`. */
function allowed(source: GateVerdict["source"], caller: Caller = ROOT_CALLER): unknown {
  return expect.objectContaining({ kind: "allow", source, caller });
}

/** A refusal no person made, judged as `caller`; `null` for a call whose caller could not be named. */
function refused(message: string, source?: GateVerdict["source"], caller: Caller | null = ROOT_CALLER, hook?: string): GateVerdict {
  return { kind: "refuse", message, source, caller: caller ?? undefined, hook, byPerson: false };
}

/** A pause with the card's `message`. */
function paused(message: string, source: GateVerdict["source"], hook?: string): unknown {
  return expect.objectContaining({ kind: "pause", message, source, caller: ROOT_CALLER, hook });
}

/** The default's card for a call. */
function cardOf(name: string, args: Record<string, unknown>, slug = ""): string {
  return resolveToolApproval(name, slug, args, mcpDefault({ destructive: ["docs/drop"] }), new Set()).message;
}

function leases(over: Partial<{ global: boolean; categories: ToolApprovalCategory[]; servers: string[]; hooks: string[] }> = {}): ActiveLeases {
  return { global: over.global ?? false, categories: new Set(over.categories ?? []), servers: new Set(over.servers ?? []), hooks: new Set(over.hooks ?? []) };
}

function mcpDefault(over: Partial<{ destructive: string[]; unlisted: string[]; leased: string[] }> = {}): McpApprovalDefault {
  return { destructive: new Set(over.destructive ?? []), unlisted: new Set(over.unlisted ?? []), leasedServers: new Set(over.leased ?? []) };
}

function serverOf(toolName: string): { slug: string; tool: string } | undefined {
  const match = /^mcp__([^_]+)__(.+)$/.exec(toolName);
  return match === null || match[1] === "stigmer" ? undefined : { slug: match[1]!, tool: match[2]! };
}

function facts(over: Partial<GateFacts> = {}): GateFacts {
  return {
    root: ROOT_REACH,
    subagents: new Map([
      ["test-runner", RUNNER_REACH],
      ["acme:helper", HELPER_REACH],
    ]),
    serverOf,
    leases: leases(),
    mcpDefault: mcpDefault(),
    unattended: false,
    posture: { fileCaptureMode: false, fileReviewOff: false, fileCaptureSubstrate: false, isCapturablePath: async () => false, captureIgnored: false },
    primaryDir: WORKSPACE,
    platformDir: PLATFORM,
    engineHome: HOME,
    readsSkillContent: async (path) => /^\/\.stigmer\/(skills|plugins)\//i.test(path),
    platformReadRoot: "",
    hooks: NO_HOOKS,
    decisions: new Map(),
    denyMessages: new Map(),
    waitingCallOf: () => undefined,
    staleCallId: undefined,
    unproposedCallId: undefined,
    observer: undefined,
    ...over,
  };
}

async function decide(gate: ClaudeGate, toolName: string, input: Record<string, unknown> = {}, id = `toolu_${toolName}`, agentId?: string): Promise<GateVerdict> {
  return gate.decide(toolName, id, input, agentId);
}

/** A gate with the test runner started under the engine's id `agent_runner`, and the plugin helper under `agent_helper`. */
function startedGate(over: Partial<GateFacts> = {}): ClaudeGate {
  const gate = new ClaudeGate(facts(over));
  gate.subagentStarted("agent_runner", "test-runner");
  gate.subagentStarted("agent_helper", "acme:helper");
  return gate;
}

/** The `safety` plugin's hooks, whose PreToolUse answer for every call they match is `pre`, and PostToolUse answer `post`. */
function hooksAnswering(pre: Partial<HookRunResult>, opts: { matcher?: string; leases?: string[]; seen?: Record<string, unknown>[] } = {}): HookEvaluator {
  const run: HookProcessRunner = async (spec) => {
    opts.seen?.push(JSON.parse(spec.stdin) as Record<string, unknown>);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...pre };
  };
  return new HookEvaluator({
    set: HookSet.of([
      {
        source: { plugin: "safety", root: "/p", data: "/d", options: new Map() },
        groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: opts.matcher ?? ".*", handlers: [create(HookHandlerSchema, { command: "pre" })] })],
      },
    ]),
    views: new ClaudeToolViews({ workspaceRoot: WORKSPACE, serverNames: new Map(), platformServerSlugs: new Set() }),
    sessionId: "ses",
    workspaceRoot: WORKSPACE,
    permissionMode: "default",
    baseEnv: {},
    homeDir: "/home",
    leases: new Set(opts.leases ?? []),
    run,
  });
}

/** A hook's PreToolUse answer, as its process prints it. */
function hookSays(permissionDecision: string, extra: Record<string, unknown> = {}): Partial<HookRunResult> {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, ...extra } }) };
}

const withRootHooks = (evaluator: HookEvaluator): TurnHookEvaluators => ({ root: evaluator, subagents: new Map() });

describe("the closed world: a tool the turn never offered", () => {
  it("is refused before any policy, even when the whole run is trusted", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "WebFetch", { url: "https://example.com" })).toEqual(refused(notOfferedMessage("WebFetch")));
    expect(await decide(gate, "mcp__other__call")).toEqual(refused(notOfferedMessage("mcp__other__call")));
  });
});

describe("the shell", () => {
  it("pauses under the default, the card the default's", async () => {
    const gate = new ClaudeGate(facts());
    expect(await decide(gate, SHELL, { command: "rm -rf build" })).toEqual(paused(cardOf("Bash", { command: "rm -rf build" }), "builtin_category"));
  });

  it("never runs as the engine's own, under its own name, even when the whole run is trusted", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "Bash", { command: "npm test" })).toEqual(refused(notOfferedMessage("Bash")));
  });

  it("runs under a shell lease and under a trusted run", async () => {
    expect(await decide(new ClaudeGate(facts({ leases: leases({ categories: ["shell"] }) })), SHELL, { command: "npm test" })).toEqual(allowed("approval_lease"));
    expect(await decide(new ClaudeGate(facts({ leases: leases({ global: true }) })), SHELL, { command: "npm test" })).toEqual(allowed("auto_approve_all"));
  });

  it("is skipped on an unattended turn, with the shared sentence under the engine's own name, and recorded for the settle", async () => {
    const gate = new ClaudeGate(facts({ unattended: true }));
    expect(await decide(gate, SHELL, { command: "make" }, "toolu_1")).toEqual(refused(unattendedSkipMessage("Bash"), "unattended_skip"));
    expect([...gate.unattendedSkips]).toEqual([["toolu_1", null]]);
  });
});

describe("file edits", () => {
  it("Write, Edit and NotebookEdit pause under review with nothing to capture into", async () => {
    const gate = new ClaudeGate(facts());
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toMatchObject({ kind: "pause", source: "builtin_category" });
    expect(await decide(gate, "Edit", { file_path: `${WORKSPACE}/a.ts`, old_string: "x", new_string: "y" })).toMatchObject({ kind: "pause", source: "builtin_category" });
    expect(await decide(gate, "NotebookEdit", { notebook_path: `${WORKSPACE}/n.ipynb`, new_source: "" })).toMatchObject({ kind: "pause", source: "builtin_category" });
  });

  it("flow with review off, and under capture for a capturable path, judged in the workspace's own dialect", async () => {
    const asked: string[] = [];
    const capture = facts({
      posture: { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: false, isCapturablePath: async (path) => (asked.push(path), true) },
    });
    expect(await decide(new ClaudeGate(capture), "Edit", { file_path: `${WORKSPACE}/src/a.ts` })).toEqual(allowed("file_capture"));
    expect(asked).toContain("/src/a.ts");
    const off = facts({ posture: { fileReviewOff: true, isCapturablePath: async () => false } });
    expect(await decide(new ClaudeGate(off), "Write", { file_path: `${WORKSPACE}/a.ts` })).toEqual(allowed("file_review_off"));
  });

  it("flow into the outputs folder where review is off or capture holds", async () => {
    const gate = new ClaudeGate(facts({ posture: { fileCaptureMode: true, isCapturablePath: async () => false } }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.stigmer/outputs/report.md` })).toEqual(allowed("outputs"));
  });

  it("outside the workspace are never capturable, so they fall to the default", async () => {
    const gate = new ClaudeGate(facts({ posture: { fileCaptureMode: true, fileCaptureSubstrate: true, isCapturablePath: async () => true } }));
    expect(await decide(gate, "Write", { file_path: "/etc/hosts" })).toMatchObject({ kind: "pause" });
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/../other/a.ts` }, "toolu_up")).toMatchObject({ kind: "pause" });
  });

  it("resolve against the workspace: a relative path that climbs out, or an absolute one outside, takes no flow", async () => {
    const asked: string[] = [];
    const capture = facts({
      posture: { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: false, isCapturablePath: async (path) => (asked.push(path), true) },
    });
    const gate = new ClaudeGate(capture);
    expect(await decide(gate, "Write", { file_path: "src/../../outside.txt", content: "x" }, "toolu_climb")).toMatchObject({ kind: "pause" });
    expect(await decide(gate, "Write", { file_path: "/.stigmer/outputs/x.md", content: "x" }, "toolu_root_outputs")).toMatchObject({ kind: "pause" });
    const reviewOff = new ClaudeGate(facts({ posture: { fileReviewOff: true, isCapturablePath: async () => false } }));
    expect(await decide(reviewOff, "Edit", { file_path: "/etc/hosts" }, "toolu_off_outside")).toMatchObject({ kind: "pause" });
    expect(await decide(gate, "Write", { file_path: "src/a.ts", content: "x" }, "toolu_relative")).toEqual(allowed("file_capture"));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/..notes`, content: "x" }, "toolu_dots_name")).toEqual(allowed("file_capture"));
    expect(asked, "only the paths inside the workspace were asked about, in its dialect").toEqual(["/src/a.ts", "/..notes"]);
    // A secret-like path outside the workspace is never the capture's to review, so it is blocked.
    expect(await decide(gate, "Write", { file_path: "/etc/app/.env", content: "KEY=1" }, "toolu_outside_secret")).toEqual(refused(secretBlockMessage("Write", "/etc/app/.env")));
  });

  it("a secret-like path is blocked even when a write lease would clear the category, and recorded for review", async () => {
    const blocked: string[] = [];
    const observer = { recordBefore: async () => undefined, recordBlockedSecret: (path: string) => void blocked.push(path) };
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["write"] }), posture: { fileReviewOff: true, isCapturablePath: async () => false }, observer }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.env`, content: "KEY=1" })).toEqual(refused(secretBlockMessage("Write", "/.env")));
    expect(blocked).toEqual(["/.env"]);
  });

  it("a write leased by category runs", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["write"] }) }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts` })).toEqual(allowed("approval_lease"));
  });
});

describe("reads and MCP tools", () => {
  it("a read-only built-in runs unasked", async () => {
    expect(await decide(new ClaudeGate(facts()), "Read", { file_path: `${WORKSPACE}/a.ts` })).toEqual(allowed(undefined));
  });

  it("a tool its server marks destructive pauses; one it does not mark runs; a leased server's runs", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"] }) }));
    expect(await decide(gate, "mcp__docs__drop")).toEqual(paused(cardOf("drop", {}, "docs"), "annotation_destructive_tighten"));
    expect(await decide(gate, "mcp__docs__search")).toEqual(allowed(undefined));
    const leased = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"], leased: ["docs"] }) }));
    expect(await decide(leased, "mcp__docs__drop")).toEqual(allowed("approval_lease"));
  });

  it("a tool of a server that could not be listed pauses", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ unlisted: ["plugin"] }) }));
    expect(await decide(gate, "mcp__plugin__any")).toMatchObject({ kind: "pause", source: "annotation_destructive_tighten" });
  });
});

describe("one decision per call", () => {
  it("is made once and read back by id; a halted turn refuses only calls it has not decided", async () => {
    let halted = false;
    const gate = new ClaudeGate(facts(), () => halted);
    expect(gate.verdictOf("toolu_a")).toBeUndefined();
    const first = await decide(gate, "Read", {}, "toolu_a");
    halted = true;
    expect(await decide(gate, "Read", {}, "toolu_a")).toBe(first);
    expect(gate.verdictOf("toolu_a")).toBe(first);
    expect(await decide(gate, "Read", {}, "toolu_b")).toEqual(refused(HALTED_MESSAGE));
  });
});

describe("the pause: one deferral an invocation", () => {
  const signal = new AbortController().signal;
  const hookInput = (name: string, id: string, input: Record<string, unknown>): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: name,
    tool_input: input,
    tool_use_id: id,
    session_id: "s",
    transcript_path: "",
    cwd: WORKSPACE,
  });

  it("defers the first call that needs a person, refuses a second with the sentence that asks for it alone, and allows a read", async () => {
    const gate = new ClaudeGate(facts());
    const preToolUse = gateHooks(gate).PreToolUse![0]!.hooks[0]!;
    expect(await preToolUse(hookInput(SHELL, "toolu_1", { command: "rm -rf build" }), "toolu_1", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } });
    expect(await preToolUse(hookInput(SHELL, "toolu_2", { command: "make release" }), "toolu_2", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_ALONE_MESSAGE },
    });
    expect(gate.deferredCall).toBe("toolu_1");
    expect(await preToolUse(hookInput(SHELL, "toolu_1", { command: "rm -rf build" }), "toolu_1", { signal }), "the same call asked again keeps its deferral").toMatchObject({ hookSpecificOutput: { permissionDecision: "defer" } });
    expect(await preToolUse(hookInput("Read", "toolu_r", { file_path: `${WORKSPACE}/a.ts` }), "toolu_r", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
    expect(await preToolUse({ ...hookInput("Read", "toolu_x", {}), hook_event_name: "PostToolUse", tool_response: "" } as HookInput, "toolu_x", { signal })).toEqual({});
  });

  it("canUseTool never runs a call that would pause: it refuses it, and frees the deferral the engine ran past", async () => {
    const gate = new ClaudeGate(facts());
    const preToolUse = gateHooks(gate).PreToolUse![0]!.hooks[0]!;
    const canUseTool = canUseToolOf(gate);
    await preToolUse(hookInput(SHELL, "toolu_1", { command: "rm -rf build" }), "toolu_1", { signal });
    expect(await canUseTool(SHELL, { command: "rm -rf build" }, { signal, toolUseID: "toolu_1", requestId: "r1" })).toEqual({ behavior: "deny", message: ASK_ALONE_MESSAGE });
    expect(gate.deferredCall).toBeUndefined();
    expect(await preToolUse(hookInput(SHELL, "toolu_3", { command: "rm -rf build" }), "toolu_3", { signal }), "the call asked for again alone defers").toMatchObject({ hookSpecificOutput: { permissionDecision: "defer" } });
    expect(await canUseTool("Read", {}, { signal, toolUseID: "toolu_r", requestId: "r2" })).toEqual({ behavior: "allow" });
    expect(await canUseTool("WebFetch", {}, { signal, toolUseID: "toolu_w", requestId: "r3" })).toEqual({ behavior: "deny", message: notOfferedMessage("WebFetch") });
  });

  it("a call this run left pending without proposing it is asked for again alone", async () => {
    const gate = new ClaudeGate(facts({ unproposedCallId: "toolu_old" }));
    expect(await decide(gate, SHELL, { command: "make" }, "toolu_old")).toEqual(refused(ASK_ALONE_MESSAGE, "builtin_category"));
    expect(await decide(gate, SHELL, { command: "make" }, "toolu_new")).toMatchObject({ kind: "pause" });
  });
});

describe("a call left waiting by a stopped run", () => {
  it("is refused by its id whatever the policy, even under a trusted run", async () => {
    const gate = new ClaudeGate(facts({ staleCallId: "toolu_stale", leases: leases({ global: true }) }));
    expect(await decide(gate, SHELL, { command: "rm -rf build" }, "toolu_stale")).toEqual(refused(STALE_CALL_MESSAGE));
    expect(await decide(gate, SHELL, { command: "ls" }, "toolu_fresh")).toEqual(allowed("auto_approve_all"));
  });
});

describe("a person's answer, by the call's id", () => {
  const SHOWN = { command: "rm -rf build", description: "clean" };
  const answered = (action: ApprovalAction, over: Partial<GateFacts> = {}): ClaudeGate =>
    new ClaudeGate(facts({ decisions: new Map([["toolu_w", action]]), waitingCallOf: (id) => (id === "toolu_w" ? { name: "Bash", args: SHOWN } : undefined), ...over }));

  it("an approval runs exactly the call the person saw, under the source that asked", async () => {
    expect(await decide(answered(ApprovalAction.APPROVE), SHELL, { ...SHOWN }, "toolu_w")).toEqual(allowed("builtin_category"));
    expect(await decide(answered(ApprovalAction.APPROVE_ALL), SHELL, { ...SHOWN }, "toolu_w")).toEqual(allowed("builtin_category"));
  });

  it("an approved call the engine re-runs with other arguments is refused", async () => {
    expect(await decide(answered(ApprovalAction.APPROVE), SHELL, { ...SHOWN, command: "rm -rf /" }, "toolu_w")).toEqual(refused(CHANGED_MESSAGE));
    expect(await decide(answered(ApprovalAction.APPROVE), SHELL, { command: "rm -rf build" }, "toolu_w"), "a missing argument is a change").toEqual(refused(CHANGED_MESSAGE));
    expect(await decide(answered(ApprovalAction.APPROVE, { leases: leases({ categories: ["write"] }) }), "Write", { ...SHOWN }, "toolu_w"), "another tool under the approved id").toEqual(refused(CHANGED_MESSAGE));
    expect(await decide(answered(ApprovalAction.APPROVE, { waitingCallOf: () => undefined }), SHELL, { ...SHOWN }, "toolu_w"), "an answer with no row to show").toEqual(refused(CHANGED_MESSAGE));
  });

  it("a value the log cut is compared on the head it kept", async () => {
    const head = "x".repeat(4000);
    const cut = { command: `${head}\n\n${ELISION_MARKER}` };
    const gate = (actual: string) => decide(new ClaudeGate(facts({ decisions: new Map([["toolu_c", ApprovalAction.APPROVE]]), waitingCallOf: () => ({ name: "Bash", args: cut }) })), SHELL, { command: actual }, "toolu_c");
    expect(await gate(`${head}${"y".repeat(10_000)}`)).toEqual(allowed("builtin_category"));
    expect(await gate(`z${head.slice(1)}${"y".repeat(10_000)}`)).toEqual(refused(CHANGED_MESSAGE));
    expect(sameAsShown([1, { a: "b" }], [1, { a: "b" }])).toBe(true);
    expect(sameAsShown([1], [1, 2])).toBe(false);
    expect(sameAsShown({ a: 1 }, ["a"])).toBe(false);
    expect(sameAsShown(cut, { command: 7 })).toBe(false);
  });

  it("a refusal never runs, the model reading the person's own reason, and is marked as theirs", async () => {
    const gate = answered(ApprovalAction.REJECT, { denyMessages: new Map([["toolu_w", "not today"]]) });
    expect(await decide(gate, SHELL, { ...SHOWN }, "toolu_w")).toEqual({
      kind: "refuse",
      message: personDecisionSentence("Bash", "reject", "not today"),
      source: undefined,
      caller: ROOT_CALLER,
      hook: undefined,
      byPerson: true,
    });
    expect(await decide(answered(ApprovalAction.SKIP), SHELL, { ...SHOWN }, "toolu_w")).toMatchObject({ kind: "refuse", message: personDecisionSentence("Bash", "skip", ""), byPerson: true });
  });

  it("a hook's deny binds after an approval; a person's refusal binds before a hook's allow", async () => {
    const denying = withRootHooks(hooksAnswering(hookSays("deny", { permissionDecisionReason: "frozen" })));
    expect(await decide(answered(ApprovalAction.APPROVE, { hooks: denying }), SHELL, { ...SHOWN }, "toolu_w")).toEqual(refused(hookRefusalMessage("safety", "frozen"), "hook", ROOT_CALLER, "safety"));
    const allowing = withRootHooks(hooksAnswering(hookSays("allow")));
    expect(await decide(answered(ApprovalAction.REJECT, { hooks: allowing }), SHELL, { ...SHOWN }, "toolu_w")).toMatchObject({ kind: "refuse", byPerson: true });
  });
});

describe("the agent's hooks", () => {
  it("a deny refuses, naming the hook", async () => {
    const gate = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("deny", { permissionDecisionReason: "no pushes on Friday" }))) }));
    expect(await decide(gate, SHELL, { command: "git push" })).toEqual(refused(hookRefusalMessage("safety", "no pushes on Friday"), "hook", ROOT_CALLER, "safety"));
  });

  it("an allow runs a call the default would ask about, named for the hook; a lease on its ask counts as its allow", async () => {
    const gate = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("allow"))) }));
    expect(await decide(gate, SHELL, { command: "git push" })).toMatchObject({ kind: "allow", source: "hook", hook: "safety", rewritten: false });
    const leased = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("ask"), { leases: [hookLeaseKey("safety", "", "Bash")] })) }));
    expect(await decide(leased, SHELL, { command: "git push" })).toMatchObject({ kind: "allow", source: "approval_lease", hook: "safety" });
  });

  it("an ask pauses a call the default lets run, with its reason or Claude's tool name, and the hook named", async () => {
    const gate = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("ask"))) }));
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/a.ts` })).toEqual(paused("The safety plugin asks before Read", "hook", "safety"));
    const reasoned = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("ask", { permissionDecisionReason: "Confirm the push" }))) }));
    expect(await decide(reasoned, SHELL, { command: "git push" })).toEqual(paused("Confirm the push", "hook", "safety"));
  });

  it("an ask a person approved runs; an unattended turn skips it with the hook recorded", async () => {
    const ask = withRootHooks(hooksAnswering(hookSays("ask")));
    const approved = new ClaudeGate(facts({ hooks: ask, decisions: new Map([["toolu_a", ApprovalAction.APPROVE]]), waitingCallOf: () => ({ name: "Read", args: { file_path: `${WORKSPACE}/a.ts` } }) }));
    expect(await decide(approved, "Read", { file_path: `${WORKSPACE}/a.ts` }, "toolu_a")).toMatchObject({ kind: "allow", source: "hook", hook: "safety" });
    const unattended = new ClaudeGate(facts({ hooks: ask, unattended: true }));
    expect(await decide(unattended, "Read", { file_path: `${WORKSPACE}/a.ts` }, "toolu_u")).toEqual(refused(unattendedSkipMessage("Read"), "unattended_skip", ROOT_CALLER, "safety"));
    expect([...unattended.unattendedSkips]).toEqual([["toolu_u", "safety"]]);
  });

  it("a rewrite runs as rewritten, returned to the engine by both mechanisms, after the rules are judged again", async () => {
    const rewrite = (input: Record<string, unknown>) => withRootHooks(hooksAnswering(hookSays("allow", { updatedInput: input })));
    const gate = new ClaudeGate(facts({ hooks: rewrite({ command: "npm test -- --ci" }) }));
    expect(await decide(gate, SHELL, { command: "npm test" }, "toolu_rw")).toMatchObject({ kind: "allow", args: { command: "npm test -- --ci" }, rewritten: true });
    const signal = new AbortController().signal;
    expect(await canUseToolOf(gate)(SHELL, { command: "npm test" }, { signal, toolUseID: "toolu_rw", requestId: "r" })).toEqual({ behavior: "allow", updatedInput: { command: "npm test -- --ci" } });
    const preToolUse = gateHooks(gate).PreToolUse![0]!.hooks[0]!;
    expect(await preToolUse({ hook_event_name: "PreToolUse", tool_name: SHELL, tool_input: { command: "npm test" }, tool_use_id: "toolu_rw", session_id: "s", transcript_path: "", cwd: WORKSPACE }, "toolu_rw", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { command: "npm test -- --ci" } },
    });
    const onto = (path: string) => new ClaudeGate(facts({ hooks: rewrite({ file_path: path, content: "x" }), leases: leases({ categories: ["write"] }) }));
    expect(await decide(onto(`${WORKSPACE}/.env`), "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toEqual(refused(secretBlockMessage("Write", "/.env")));
    expect(await decide(onto(`${WORKSPACE}/.stigmer/skills/x/SKILL.md`), "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toEqual(refused(READ_ONLY_MESSAGE));
  });

  it("an ask that also rewrites the call is refused: the card would show the model's call", async () => {
    const gate = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("ask", { updatedInput: { command: "git push --dry-run" } }))) }));
    expect(await decide(gate, SHELL, { command: "git push" })).toEqual(refused(askWithRewriteMessage("safety"), "hook", ROOT_CALLER, "safety"));
  });

  it("under a trusted run only the hooks: a deny binds, an ask is satisfied, a rewrite applies", async () => {
    const trusted = (pre: Partial<HookRunResult>) => new ClaudeGate(facts({ leases: leases({ global: true }), hooks: withRootHooks(hooksAnswering(pre)) }));
    expect(await decide(trusted(hookSays("deny")), SHELL, { command: "git push" })).toEqual(refused(hookRefusalMessage("safety", ""), "hook", ROOT_CALLER, "safety"));
    expect(await decide(trusted(hookSays("ask")), SHELL, { command: "git push" })).toMatchObject({ kind: "allow", source: "auto_approve_all", hook: "safety" });
    expect(await decide(trusted(hookSays("ask", { updatedInput: { command: "git push --dry-run" } })), SHELL, { command: "git push" })).toMatchObject({
      kind: "allow",
      source: "auto_approve_all",
      args: { command: "git push --dry-run" },
    });
    expect(await decide(trusted(hookSays("allow")), SHELL, { command: "git push" })).toMatchObject({ kind: "allow", source: "hook" });
    expect(await decide(trusted({}), SHELL, { command: "git push" })).toMatchObject({ kind: "allow", source: "auto_approve_all", hook: undefined });
  });

  it("an MCP call reaches a hook under Claude Code's name, its PreToolUse context kept for the result", async () => {
    const seen: Record<string, unknown>[] = [];
    const gate = new ClaudeGate(facts({ hooks: withRootHooks(hooksAnswering(hookSays("allow", { additionalContext: "logged" }), { seen })) }));
    expect(await decide(gate, "mcp__docs__search", { q: "x" })).toMatchObject({ kind: "allow", context: ["logged"] });
    expect(seen[0]).toMatchObject({ tool_name: "mcp__docs__search", tool_input: { q: "x" }, tool_use_id: "toolu_mcp__docs__search" });
  });

  it("a sub-agent runs its own evaluator, and its hook's ask is refused naming the hook", async () => {
    const own = hooksAnswering(hookSays("ask"));
    const gate = startedGate({ hooks: { root: null, subagents: new Map([["test-runner", own]]) } });
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/a.ts` }, "toolu_sub", "agent_runner")).toEqual(refused(subagentHookAskMessage("safety"), "hook", RUNNER, "safety"));
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/a.ts` }, "toolu_root")).toEqual(allowed(undefined));
    const plugin = startedGate({ hooks: withRootHooks(hooksAnswering(hookSays("deny"))) });
    expect(await decide(plugin, "Read", { file_path: `${WORKSPACE}/a.ts` }, "toolu_helper", "agent_helper"), "a plugin's helper runs the main agent's hooks").toMatchObject({ kind: "refuse", source: "hook" });
  });
});

describe("a hook's ask on the main agent's start of a helper", () => {
  it("is refused naming the hook, since the start reaches the log before an ask could ride it", async () => {
    const gate = startedGate({ hooks: withRootHooks(hooksAnswering(hookSays("ask"))) });
    expect(await decide(gate, "Agent", { description: "x", prompt: "y", subagent_type: "test-runner" }, "toolu_start")).toEqual(refused(helperStartAskMessage("safety"), "hook", ROOT_CALLER, "safety"));
  });
});

describe("decisions as they are made", () => {
  it("are told to each listener with the call's id, once per call", async () => {
    const gate = new ClaudeGate(facts());
    const told: [string, GateVerdict["kind"]][] = [];
    gate.onDecided((id, verdict) => told.push([id, verdict.kind]));
    await decide(gate, "Read", {}, "toolu_1");
    await decide(gate, "Read", {}, "toolu_1");
    await decide(gate, SHELL, { command: "make" }, "toolu_2");
    expect(told).toEqual([["toolu_1", "allow"], ["toolu_2", "pause"]]);
  });
});

describe("observations for review", () => {
  it("a write the gate lets run where review captures ignored paths is observed before it lands, whatever let it run", async () => {
    const recorded: string[] = [];
    const observer = { recordBefore: async (path: string) => void recorded.push(path), recordBlockedSecret: () => undefined };
    const posture = { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: true, isCapturablePath: async () => false };
    const gate = new ClaudeGate(facts({ posture, observer }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/dist/out.js`, content: "x" }, "toolu_1")).toEqual(allowed("file_capture"));
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/dist/out.js` }, "toolu_2")).toEqual(allowed(undefined));
    const trusted = new ClaudeGate(facts({ posture, observer, leases: leases({ global: true }) }));
    expect(await decide(trusted, "Edit", { file_path: `${WORKSPACE}/build/x.js`, old_string: "a", new_string: "b" }, "toolu_3")).toEqual(allowed("auto_approve_all"));
    expect(await decide(trusted, "Write", { file_path: "/etc/hosts", content: "x" }, "toolu_4")).toEqual(allowed("auto_approve_all"));
    expect(recorded).toEqual(["/dist/out.js", "/build/x.js"]);
  });

  it("nothing is observed where an ignored path is not captured", async () => {
    const recorded: string[] = [];
    const observer = { recordBefore: async (path: string) => void recorded.push(path), recordBlockedSecret: () => undefined };
    const gate = new ClaudeGate(facts({ observer, posture: { fileCaptureMode: true, captureIgnored: false, isCapturablePath: async () => true }, leases: leases({ categories: ["write"] }) }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toEqual(allowed("file_capture"));
    expect(recorded).toEqual([]);
  });
});

describe("admission to the host's tools", () => {
  it("runs a call only under its own allow verdict, for its tool, with exactly its arguments, once", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["shell"] }), mcpDefault: mcpDefault({ destructive: ["docs/drop"] }) }));
    await decide(gate, SHELL, { command: "npm test" }, "toolu_ok");
    await decide(gate, "mcp__docs__drop", {}, "toolu_paused");
    const call = (over: Partial<{ server: string; tool: string; args: Record<string, unknown>; toolUseId: string }> = {}) => ({ server: "stigmer", tool: "bash", args: { command: "npm test" }, toolUseId: "toolu_ok", ...over });
    expect(gate.admit(call({ args: { command: "rm -rf /" } }))).toBe(NOT_ADMITTED_MESSAGE);
    expect(gate.admit(call({ server: "docs", tool: "drop" }))).toBe(NOT_ADMITTED_MESSAGE);
    expect(gate.admit(call({ toolUseId: "toolu_unknown" }))).toBe(NOT_ADMITTED_MESSAGE);
    expect(gate.admit(call({ toolUseId: "toolu_paused", server: "docs", tool: "drop", args: {} }))).toBe(NOT_ADMITTED_MESSAGE);
    expect(gate.admit(call())).toBeUndefined();
    expect(gate.admit(call())).toBe("This call already ran; it was not run again.");
    await decide(gate, "WebFetch", {}, "toolu_refused");
    expect(gate.admit(call({ toolUseId: "toolu_refused" }))).toBe(notOfferedMessage("WebFetch"));
  });
});

describe("the gate's facts", () => {
  it("are read from the turn's record: leases, capture posture, the workspace root, the answers and whether anyone can approve", () => {
    const input = turnInputFixture({
      workspaceDir: WORKSPACE,
      execution: create(RunSchema, { status: create(RunStatusSchema, { approvalMode: ApprovalMode.UNATTENDED }) }),
    });
    const isCapturablePath = async (): Promise<boolean> => true;
    const subagents = new Map([["test-runner", RUNNER_REACH]]);
    const readsSkillContent = async (): Promise<boolean> => false;
    const waitingCallOf = (): undefined => undefined;
    const read = gateFactsOf(input, {
      agents: { root: ROOT_REACH, subagents },
      bridge: { serverOf, mcpDefault: mcpDefault() },
      paths: { platformDir: PLATFORM, engineHome: HOME, readsSkillContent, platformReadRoot: "/real/platform" },
      isCapturablePath,
      hooks: NO_HOOKS,
      waitingCallOf,
      pending: { staleCallId: "toolu_s", unproposedCallId: undefined },
      observer: undefined,
    });
    expect(read).toMatchObject({
      root: ROOT_REACH,
      subagents,
      unattended: true,
      primaryDir: WORKSPACE,
      leases: input.mcp.leases,
      platformDir: PLATFORM,
      engineHome: HOME,
      platformReadRoot: "/real/platform",
      decisions: input.approvalDecisions,
      denyMessages: input.approvalDenyMessages,
      staleCallId: "toolu_s",
    });
    expect(read.readsSkillContent).toBe(readsSkillContent);
    expect(read.waitingCallOf).toBe(waitingCallOf);
    expect(read.posture).toEqual({ fileCaptureMode: false, fileReviewOff: false, fileCaptureSubstrate: false, isCapturablePath, captureIgnored: false });
  });
});

describe("callers", () => {
  it("judges a call with no agent id as the main agent's, and one from a started sub-agent as its own", async () => {
    const gate = startedGate();
    expect(await decide(gate, "Read", {}, "toolu_main")).toEqual(allowed(undefined));
    expect(await decide(gate, "Read", {}, "toolu_sub", "agent_runner")).toEqual(allowed(undefined, RUNNER));
  });

  it("refuses a call from a sub-agent it was never told started, or whose reported type disagrees", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    expect(await decide(gate, "Read", {}, "toolu_ghost", "agent_ghost")).toEqual(refused(UNKNOWN_CALLER_MESSAGE, undefined, null));
    expect(await gate.decide("Read", "toolu_liar", {}, "agent_runner", "acme:helper")).toEqual(refused(UNKNOWN_CALLER_MESSAGE, undefined, null));
    expect(await gate.decide("Read", "toolu_true", {}, "agent_runner", "test-runner")).toEqual(allowed("auto_approve_all", RUNNER));
  });

  it("refuses a sub-agent started under a type the turn does not define", async () => {
    const gate = new ClaudeGate(facts());
    gate.subagentStarted("agent_x", "general-purpose");
    expect(await decide(gate, "Read", {}, "toolu_x", "agent_x")).toEqual(refused(UNKNOWN_CALLER_MESSAGE, undefined, null));
  });

  it("holds each caller to its own tools, even when the whole run is trusted", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts` }, "toolu_w", "agent_runner")).toEqual(refused(notOfferedMessage("Write"), undefined, RUNNER));
    expect(await decide(gate, "mcp__ci__run", {}, "toolu_ci_main")).toEqual(refused(notOfferedMessage("mcp__ci__run")));
    expect(await decide(gate, "mcp__ci__run", {}, "toolu_ci_sub", "agent_runner")).toEqual(allowed("auto_approve_all", RUNNER));
  });
});

describe("skills", () => {
  it("loads a skill of the caller's own, by either spelling, and decides it before any policy", async () => {
    const gate = startedGate();
    expect(await decide(gate, "Skill", { skill: "agent:review" }, "toolu_s1")).toEqual(allowed(undefined));
    expect(await decide(gate, "Skill", { skill: "agent:platform.x" }, "toolu_s2")).toEqual(allowed(undefined));
    expect(await decide(gate, "Skill", { skill: "/agent:platform-x" }, "toolu_s3")).toEqual(allowed(undefined));
    expect(await decide(gate, "Skill", { skill: "agent:ci-checklist" }, "toolu_s4", "agent_runner")).toEqual(allowed(undefined, RUNNER));
  });

  it("refuses another agent's skill, an unknown one, or none, even when the whole run is trusted", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    expect(await decide(gate, "Skill", { skill: "agent:ci-checklist" }, "toolu_s5")).toEqual(refused(skillNotOwnedMessage("agent:ci-checklist")));
    expect(await decide(gate, "Skill", { skill: "agent:review" }, "toolu_s6", "agent_runner")).toEqual(refused(skillNotOwnedMessage("agent:review"), undefined, RUNNER));
    expect(await decide(gate, "Skill", { skill: "dataviz" }, "toolu_s7")).toEqual(refused(skillNotOwnedMessage("dataviz")));
    expect(await decide(gate, "Skill", {}, "toolu_s8")).toEqual(refused(skillNotOwnedMessage("")));
  });

  it("refuses the Skill tool itself to a caller with no skills", async () => {
    const gate = startedGate();
    expect(await decide(gate, "Skill", { skill: "agent:review" }, "toolu_s9", "agent_helper")).toEqual(refused(notOfferedMessage("Skill"), undefined, { kind: "subagent", type: "acme:helper" }));
  });
});

describe("helpers", () => {
  it("starts a defined helper with the fields a definition leaves to the call", async () => {
    const gate = startedGate();
    expect(await decide(gate, "Agent", { description: "run tests", prompt: "run them", subagent_type: "test-runner", name: "runner-1" }, "toolu_a1")).toEqual(allowed(undefined));
  });

  it("refuses a helper the turn does not define, the engine's own types included", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    for (const type of ["general-purpose", "fork", "Explore", ""]) {
      expect(await decide(gate, "Agent", { description: "x", prompt: "y", subagent_type: type }, `toolu_type_${type}`)).toEqual(refused(unknownHelperMessage(type)));
    }
  });

  it("refuses a call that would set a model, an effort, an isolation or the background, naming each", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    const base = { description: "x", prompt: "y", subagent_type: "test-runner" };
    expect(await decide(gate, "Agent", { ...base, model: "opus" }, "toolu_m")).toEqual(refused(helperOverrideMessage(["model"])));
    expect(await decide(gate, "Agent", { ...base, isolation: "worktree", run_in_background: true }, "toolu_i")).toEqual(refused(helperOverrideMessage(["isolation", "run_in_background"])));
    expect(await decide(gate, "Agent", { ...base, effort: "max" }, "toolu_e")).toEqual(refused(helperOverrideMessage(["effort"])));
  });

  it("never lets a sub-agent hand work on", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    expect(await decide(gate, "Agent", { description: "x", prompt: "y", subagent_type: "test-runner" }, "toolu_nest", "agent_runner")).toEqual(refused(notOfferedMessage("Agent"), undefined, RUNNER));
  });
});

describe("a sub-agent's call that would ask", () => {
  it("is refused with the helper's sentence, never paused", async () => {
    const gate = startedGate();
    expect(await decide(gate, SHELL, { command: "npm test" }, "toolu_sub_shell", "agent_runner")).toEqual(refused(SUBAGENT_APPROVAL_MESSAGE, "builtin_category", RUNNER));
    expect(SUBAGENT_APPROVAL_MESSAGE).toContain("ask the agent that delegated to you to run this");
  });

  it("is skipped on an unattended turn with the shared sentence, as the main agent's is", async () => {
    const gate = startedGate({ unattended: true });
    expect(await decide(gate, SHELL, { command: "npm test" }, "toolu_sub_skip", "agent_runner")).toEqual(refused(unattendedSkipMessage("Bash"), "unattended_skip", RUNNER));
    expect([...gate.unattendedSkips]).toEqual([["toolu_sub_skip", null]]);
  });
});

describe("platform content and the engine's home", () => {
  it("refuse every file write and edit, even when the whole run is trusted, by any spelling of the path", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    const paths = [
      `${WORKSPACE}/.stigmer/skills/review/SKILL.md`,
      ".stigmer/plugins/abc/hooks/run.sh",
      `${WORKSPACE}/.Stigmer/skills/review/SKILL.md`,
      `${WORKSPACE}/.stigmer`,
      `${WORKSPACE}/.stigmer/outputs`,
      `${WORKSPACE}/.stigmer/outputs/../skills/review/SKILL.md`,
      `${PLATFORM}/skills/review/SKILL.md`,
      `${PLATFORM}/inputs/a.txt`,
      `${HOME}/plugins/agent/skills/review/SKILL.md`,
      `${HOME}/settings.json`,
    ];
    for (const [index, path] of paths.entries()) {
      expect(await decide(gate, "Write", { file_path: path, content: "x" }, `toolu_w${index}`), path).toEqual(refused(READ_ONLY_MESSAGE));
    }
    expect(await decide(gate, "Edit", { file_path: `${WORKSPACE}/.stigmer/skills/review/SKILL.md`, old_string: "a", new_string: "b" }, "toolu_edit")).toEqual(refused(READ_ONLY_MESSAGE));
    expect(await decide(gate, "NotebookEdit", { notebook_path: `${HOME}/n.ipynb`, new_source: "" }, "toolu_nb")).toEqual(refused(READ_ONLY_MESSAGE));
  });

  it("refuse the engine's home itself, and judge a call with no path, or a session with no platform folder, by the rest", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "Write", { file_path: HOME, content: "x" }, "toolu_home_itself")).toEqual(refused(READ_ONLY_MESSAGE));
    expect(await decide(gate, "Write", { content: "x" }, "toolu_no_path")).toEqual(allowed("auto_approve_all"));
    const noPlatform = new ClaudeGate(facts({ leases: leases({ global: true }), platformDir: undefined }));
    expect(await decide(noPlatform, "Write", { file_path: `${PLATFORM}/skills/x/SKILL.md`, content: "x" }, "toolu_no_platform")).toEqual(allowed("auto_approve_all"));
  });

  it("keep the outputs folder writable and every read open", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.stigmer/outputs/report.md`, content: "x" }, "toolu_out")).toEqual(allowed("auto_approve_all"));
    expect(await decide(gate, "Write", { file_path: `${PLATFORM}/outputs/report.md`, content: "x" }, "toolu_out_abs")).toEqual(allowed("auto_approve_all"));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.stigmerx/a.md`, content: "x" }, "toolu_lookalike")).toEqual(allowed("auto_approve_all"));
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/.stigmer/skills/review/SKILL.md` }, "toolu_read")).toEqual(allowed("auto_approve_all"));
  });
});

describe("a caller whose lists exclude Read", () => {
  /** A workspace whose `.stigmer` links to a platform folder holding an input and a skill, and one whose link points out of it. */
  function linkedWorkspace(): { workspace: string; platform: string; root: string } {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "gate-confined-read-")));
    onTestFinished(() => rmSync(base, { recursive: true, force: true }));
    const workspace = join(base, "repo");
    const platform = join(base, "platform");
    for (const dir of [join(workspace, "src"), join(platform, "inputs"), join(platform, "skills", "review")]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(workspace, "src", "a.ts"), "x");
    writeFileSync(join(platform, "inputs", "brief.md"), "the brief");
    writeFileSync(join(platform, "skills", "review", "SKILL.md"), "the skill");
    symlinkSync(join(workspace, "src", "a.ts"), join(platform, "inputs", "escape.md"));
    symlinkSync(platform, join(workspace, ".stigmer"), "dir");
    return { workspace, platform, root: platform };
  }

  const CONFINED: Reach = { tools: new Set(["Glob", "Grep", "Read"]), skills: new Set(), agentTypes: new Set(), hidesSkills: false, confinedRead: true };

  it("reads the platform's content through the link or by its own path, even trusted whole, and nothing else", async () => {
    const { workspace, platform, root } = linkedWorkspace();
    const gate = new ClaudeGate(facts({ root: CONFINED, primaryDir: workspace, platformDir: platform, platformReadRoot: root, leases: leases({ global: true }) }));
    expect(await decide(gate, "Read", { file_path: join(workspace, ".stigmer", "inputs", "brief.md") }, "toolu_link")).toEqual(allowed("auto_approve_all"));
    expect(await decide(gate, "Read", { file_path: ".stigmer/inputs/brief.md" }, "toolu_relative")).toEqual(allowed("auto_approve_all"));
    expect(await decide(gate, "Read", { file_path: join(platform, "inputs", "brief.md") }, "toolu_own")).toEqual(allowed("auto_approve_all"));
    for (const [index, input] of [{ file_path: join(workspace, "src", "a.ts") }, { file_path: join(workspace, ".stigmer", "inputs", "escape.md") }, { file_path: join(platform, "inputs", "missing.md") }, {}].entries()) {
      expect(await decide(gate, "Read", input, `toolu_out${index}`), JSON.stringify(input)).toEqual(refused(PLATFORM_READ_ONLY_MESSAGE));
    }
  });

  it("reads nothing on a turn whose .stigmer is not the platform's link", async () => {
    const { workspace, platform } = linkedWorkspace();
    const gate = new ClaudeGate(facts({ root: CONFINED, primaryDir: workspace, platformDir: platform, platformReadRoot: "" }));
    expect(await decide(gate, "Read", { file_path: join(workspace, ".stigmer", "inputs", "brief.md") }, "toolu_unlinked")).toEqual(refused(PLATFORM_READ_ONLY_MESSAGE));
  });

  it("still reads no skill's files when its lists deny Skill too", async () => {
    const { workspace, platform, root } = linkedWorkspace();
    const gate = new ClaudeGate(facts({ root: { ...CONFINED, hidesSkills: true }, primaryDir: workspace, platformDir: platform, platformReadRoot: root, readsSkillContent: async (path) => path.startsWith("/.stigmer/skills/") }));
    expect(await decide(gate, "Read", { file_path: join(workspace, ".stigmer", "skills", "review", "SKILL.md") }, "toolu_skill")).toEqual(refused(HIDDEN_SKILLS_MESSAGE));
    expect(await decide(gate, "Read", { file_path: join(workspace, ".stigmer", "inputs", "brief.md") }, "toolu_brief")).toEqual(allowed(undefined));
  });
});

describe("skill files for a caller whose lists deny Skill", () => {
  it("are refused to a read through the link, in the platform folder, or in the engine's home", async () => {
    const gate = startedGate({ leases: leases({ global: true }) });
    const helper: Caller = { kind: "subagent", type: "acme:helper" };
    for (const [index, path] of [`${WORKSPACE}/.stigmer/skills/review/SKILL.md`, `${PLATFORM}/plugins/abc/skills/x/SKILL.md`, `${HOME}/plugins/agent/skills/review/SKILL.md`].entries()) {
      expect(await decide(gate, "Read", { file_path: path }, `toolu_hidden${index}`, "agent_helper"), path).toEqual(refused(HIDDEN_SKILLS_MESSAGE, undefined, helper));
    }
    expect(await decide(gate, "Read", { file_path: `${WORKSPACE}/src/a.ts` }, "toolu_plain", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
    expect(await decide(gate, "Read", { file_path: `${PLATFORM}/inputs/a.txt` }, "toolu_input", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
  });

  it("leave that caller every other read: none with no path, none outside both folders, the platform folder itself", async () => {
    const helper: Caller = { kind: "subagent", type: "acme:helper" };
    const gate = startedGate({ leases: leases({ global: true }) });
    expect(await decide(gate, "Read", {}, "toolu_no_path", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
    expect(await decide(gate, "Read", { file_path: "/etc/hosts" }, "toolu_outside", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
    expect(await decide(gate, "Read", { file_path: PLATFORM }, "toolu_platform_itself", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
    const noPlatform = new ClaudeGate(facts({ leases: leases({ global: true }), platformDir: undefined }));
    noPlatform.subagentStarted("agent_helper", "acme:helper");
    expect(await decide(noPlatform, "Read", { file_path: `${PLATFORM}/skills/x/SKILL.md` }, "toolu_no_platform", "agent_helper")).toEqual(allowed("auto_approve_all", helper));
  });

  it("stay readable to a caller whose lists keep skills", async () => {
    const gate = startedGate();
    expect(await decide(gate, "Read", { file_path: `${HOME}/plugins/agent/skills/review/SKILL.md` }, "toolu_own")).toEqual(allowed(undefined));
  });
});

describe("the engine's callbacks", () => {
  it("name a sub-agent at SubagentStart, then judge its PreToolUse calls as its own, and canUseTool by its id alone", async () => {
    const gate = new ClaudeGate(facts());
    const hooks = gateHooks(gate);
    const signal = new AbortController().signal;
    const base = { session_id: "s", transcript_path: "", cwd: WORKSPACE };
    await hooks.SubagentStart![0]!.hooks[0]!({ ...base, hook_event_name: "SubagentStart", agent_id: "agent_runner", agent_type: "test-runner" }, undefined, { signal });
    const preToolUse = hooks.PreToolUse![0]!.hooks[0]!;
    const call = (id: string, agentType: string): HookInput => ({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: SHELL,
      tool_input: { command: "npm test" },
      tool_use_id: id,
      agent_id: "agent_runner",
      agent_type: agentType,
    });
    expect(await preToolUse(call("toolu_p1", "test-runner"), "toolu_p1", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: SUBAGENT_APPROVAL_MESSAGE },
    });
    expect(await preToolUse(call("toolu_p2", "acme:helper"), "toolu_p2", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: UNKNOWN_CALLER_MESSAGE },
    });
    const canUseTool = canUseToolOf(gate);
    expect(await canUseTool("Read", {}, { signal, toolUseID: "toolu_p3", requestId: "r", agentID: "agent_runner" })).toEqual({ behavior: "allow" });
    expect(gate.verdictOf("toolu_p3")).toEqual(allowed(undefined, RUNNER));
  });
});
