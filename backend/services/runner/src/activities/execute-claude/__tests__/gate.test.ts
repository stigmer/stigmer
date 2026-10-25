/**
 * The Claude gate's decisions, one rule per case, in the order the gate
 * takes them (`gate.ts`).
 *
 * Why it matters: on this engine nothing waits for a person yet, so every
 * call the shared default would ask about must be refused, never run; and
 * the engine offers tools of its own beyond what the runtime classifies, so
 * a call to a tool the turn never offered must be refused before any
 * classification is consulted. Each refusal here is written so that it
 * fails if its rule is removed: an undeclared built-in under "trust this
 * whole run", the shell under the default (under both of its names), an
 * edit, a destructive MCP tool and a tool of a server that could not be
 * listed. The allows prove the same table does not over-refuse: a leased
 * category, a read, an MCP tool its server does not mark, the file-edit
 * flows under capture, with review off and into the outputs folder.
 *
 * The engine's two mechanisms (`PreToolUse` and `canUseTool`) read one
 * memoized decision per call id, and neither ever returns a changed input.
 *
 * Every call is judged as its caller's: the main agent, or a sub-agent the
 * `SubagentStart` callback named. Pinned here: a sub-agent the gate cannot
 * name is refused; each caller is held to its own reach, its own tools and
 * its own skills; `Agent` starts only a defined helper on its own
 * definition; the engine's own shell never runs; a sub-agent's call that
 * would ask is refused with the helper's sentence (or skipped, unattended);
 * no file tool writes platform content or the engine's home, even under
 * "trust this whole run"; and a caller whose lists deny `Skill` reads no
 * skill's files.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

import type { ActiveLeases, McpApprovalDefault } from "../../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { unattendedSkipMessage } from "../../../shared/approval-policy.js";
import { secretBlockMessage } from "../../../shared/file-edit-policy.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import {
  ClaudeGate,
  HALTED_MESSAGE,
  HIDDEN_SKILLS_MESSAGE,
  NEEDS_APPROVAL_MESSAGE,
  READ_ONLY_MESSAGE,
  ROOT_CALLER,
  SUBAGENT_APPROVAL_MESSAGE,
  UNKNOWN_CALLER_MESSAGE,
  canUseToolOf,
  gateFactsOf,
  gateHooks,
  helperOverrideMessage,
  notOfferedMessage,
  skillNotOwnedMessage,
  unknownHelperMessage,
  type Caller,
  type GateFacts,
  type GateVerdict,
  type Reach,
} from "../gate.js";

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
};

/** A saved helper's reach: the read tools, the shell, its own server and skill, no `Agent`. */
const RUNNER_REACH: Reach = {
  tools: new Set(["Read", "Glob", "Grep", "Bash", SHELL, "mcp__ci__run", "Skill"]),
  skills: new Set(["agent:ci-checklist"]),
  agentTypes: new Set(),
  hidesSkills: false,
};

/** A plugin helper whose lists deny `Skill`. */
const HELPER_REACH: Reach = { tools: new Set(["Read", "Write"]), skills: new Set(), agentTypes: new Set(), hidesSkills: true };

const RUNNER: Caller = { kind: "subagent", type: "test-runner" };

function allowed(source: GateVerdict["source"], caller: Caller = ROOT_CALLER): GateVerdict {
  return { allow: true, source, caller };
}

/** A refusal judged as `caller`; `null` for a call whose caller could not be named. */
function refused(message: string, source?: GateVerdict["source"], caller: Caller | null = ROOT_CALLER): GateVerdict {
  return { allow: false, message, source, caller: caller ?? undefined };
}

function leases(over: Partial<{ global: boolean; categories: ToolApprovalCategory[]; servers: string[] }> = {}): ActiveLeases {
  return { global: over.global ?? false, categories: new Set(over.categories ?? []), servers: new Set(over.servers ?? []), hooks: new Set() };
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
    ...over,
  };
}

async function decide(gate: ClaudeGate, toolName: string, input: Record<string, unknown> = {}, id = `toolu_${toolName}`, agentId?: string) {
  return gate.decide(toolName, id, input, agentId);
}

/** A gate with the test runner started under the engine's id `agent_runner`, and the plugin helper under `agent_helper`. */
function startedGate(over: Partial<GateFacts> = {}): ClaudeGate {
  const gate = new ClaudeGate(facts(over));
  gate.subagentStarted("agent_runner", "test-runner");
  gate.subagentStarted("agent_helper", "acme:helper");
  return gate;
}

describe("the closed world: a tool the turn never offered", () => {
  it("is refused before any policy, even when the whole run is trusted", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "WebFetch", { url: "https://example.com" })).toEqual(refused(notOfferedMessage("WebFetch")));
    expect(await decide(gate, "mcp__other__call")).toEqual(refused(notOfferedMessage("mcp__other__call")));
  });
});

describe("the shell", () => {
  it("is refused under the default, never asked of a person", async () => {
    const gate = new ClaudeGate(facts());
    expect(await decide(gate, SHELL, { command: "rm -rf build" })).toEqual(refused(NEEDS_APPROVAL_MESSAGE, "builtin_category"));
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
  it("Write, Edit and NotebookEdit are refused under review with nothing to capture into", async () => {
    const gate = new ClaudeGate(facts());
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Edit", { file_path: `${WORKSPACE}/a.ts`, old_string: "x", new_string: "y" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "NotebookEdit", { notebook_path: `${WORKSPACE}/n.ipynb`, new_source: "" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
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
    expect(await decide(gate, "Write", { file_path: "/etc/hosts" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/../other/a.ts` }, "toolu_up")).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
  });

  it("resolve against the workspace: a relative path that climbs out, or an absolute one outside, takes no flow", async () => {
    const asked: string[] = [];
    const capture = facts({
      posture: { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: false, isCapturablePath: async (path) => (asked.push(path), true) },
    });
    const gate = new ClaudeGate(capture);
    expect(await decide(gate, "Write", { file_path: "src/../../outside.txt", content: "x" }, "toolu_climb")).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Write", { file_path: "/.stigmer/outputs/x.md", content: "x" }, "toolu_root_outputs")).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    const reviewOff = new ClaudeGate(facts({ posture: { fileReviewOff: true, isCapturablePath: async () => false } }));
    expect(await decide(reviewOff, "Edit", { file_path: "/etc/hosts" }, "toolu_off_outside")).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Write", { file_path: "src/a.ts", content: "x" }, "toolu_relative")).toEqual(allowed("file_capture"));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/..notes`, content: "x" }, "toolu_dots_name")).toEqual(allowed("file_capture"));
    expect(asked, "only the paths inside the workspace were asked about, in its dialect").toEqual(["/src/a.ts", "/..notes"]);
    // A secret-like path outside the workspace is never the capture's to review, so it is blocked.
    expect(await decide(gate, "Write", { file_path: "/etc/app/.env", content: "KEY=1" }, "toolu_outside_secret")).toEqual(refused(secretBlockMessage("Write", "/etc/app/.env")));
  });

  it("a secret-like path is blocked even when a write lease would clear the category", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["write"] }), posture: { fileReviewOff: true, isCapturablePath: async () => false } }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.env`, content: "KEY=1" })).toEqual(refused(secretBlockMessage("Write", "/.env")));
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

  it("a tool its server marks destructive is refused; one it does not mark runs; a leased server's runs", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"] }) }));
    expect(await decide(gate, "mcp__docs__drop")).toEqual(refused(NEEDS_APPROVAL_MESSAGE, "annotation_destructive_tighten"));
    expect(await decide(gate, "mcp__docs__search")).toEqual(allowed(undefined));
    const leased = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"], leased: ["docs"] }) }));
    expect(await decide(leased, "mcp__docs__drop")).toEqual(allowed("approval_lease"));
  });

  it("a tool of a server that could not be listed is refused", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ unlisted: ["plugin"] }) }));
    expect(await decide(gate, "mcp__plugin__any")).toEqual(refused(NEEDS_APPROVAL_MESSAGE, "annotation_destructive_tighten"));
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

  it("the PreToolUse callback and canUseTool agree, and neither returns a changed input", async () => {
    const gate = new ClaudeGate(facts());
    const callback = gateHooks(gate).PreToolUse![0]!.hooks[0]!;
    const signal = new AbortController().signal;
    const hookInput = (name: string, id: string): HookInput => ({
      hook_event_name: "PreToolUse",
      tool_name: name,
      tool_input: { command: "ls", file_path: `${WORKSPACE}/a.ts` },
      tool_use_id: id,
      session_id: "s",
      transcript_path: "",
      cwd: WORKSPACE,
    });
    expect(await callback(hookInput(SHELL, "toolu_s"), "toolu_s", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: NEEDS_APPROVAL_MESSAGE },
    });
    expect(await callback(hookInput("Read", "toolu_r"), "toolu_r", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
    expect(await callback({ ...hookInput("Read", "toolu_x"), hook_event_name: "PostToolUse", tool_response: "" } as HookInput, "toolu_x", { signal })).toEqual({});

    const canUseTool = canUseToolOf(gate);
    const options = { signal, toolUseID: "toolu_s", requestId: "req_1" };
    expect(await canUseTool(SHELL, { command: "ls" }, options)).toEqual({ behavior: "deny", message: NEEDS_APPROVAL_MESSAGE });
    expect(await canUseTool("Read", {}, { ...options, toolUseID: "toolu_r" })).toEqual({ behavior: "allow" });
  });
});

describe("the gate's facts", () => {
  it("are read from the turn's record: leases, capture posture, the workspace root and whether anyone can approve", () => {
    const input = turnInputFixture({
      workspaceDir: WORKSPACE,
      execution: create(RunSchema, { status: create(RunStatusSchema, { approvalMode: ApprovalMode.UNATTENDED }) }),
    });
    const isCapturable = async (): Promise<boolean> => true;
    const subagents = new Map([["test-runner", RUNNER_REACH]]);
    const readsSkillContent = async (): Promise<boolean> => false;
    const read = gateFactsOf(input, { root: ROOT_REACH, subagents }, { serverOf, mcpDefault: mcpDefault() }, { platformDir: PLATFORM, engineHome: HOME, readsSkillContent }, isCapturable);
    expect(read).toMatchObject({ root: ROOT_REACH, subagents, unattended: true, primaryDir: WORKSPACE, leases: input.mcp.leases, platformDir: PLATFORM, engineHome: HOME });
    expect(read.readsSkillContent).toBe(readsSkillContent);
    expect(read.posture).toEqual({
      fileCaptureMode: false,
      fileReviewOff: false,
      fileCaptureSubstrate: false,
      isCapturablePath: isCapturable,
      captureIgnored: false,
    });
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
