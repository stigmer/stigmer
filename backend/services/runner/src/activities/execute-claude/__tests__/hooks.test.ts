/**
 * Pins the Claude harness's hooks for a turn (`hooks.ts`):
 *  - one evaluator per caller: none when the agent has no hooks, the main
 *    agent's over the conversation's sources, a saved sub-agent's over the
 *    conversation's then its own, a plugin's helper on the main agent's;
 *  - the hooks' feedback on a call the gate let run: what its `PreToolUse`
 *    hooks handed back, then, when it succeeded, what its `PostToolUse`
 *    hooks hand back, as the Stigmer harness's "Hook feedback:" section, returned to the
 *    engine as `additionalContext` and kept for the call's row; nothing for
 *    a call the gate did not let run, or one no hook said anything about;
 *  - a tool's response read as the text a hook reads.
 *
 * Why it matters: a hook's policy must bind each caller exactly as on the
 * Stigmer harness, and its feedback must reach the model and the row alike.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";

import type { TurnSubagent } from "../../../harness/types.js";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import type { HookProcessRunner, HookRunResult } from "../../../shared/hooks/run.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { ROOT_CALLER, type Caller, type GateVerdict } from "../gate.js";
import { ClaudeToolViews } from "../hook-views.js";
import { HookFeedback, NO_HOOKS, evaluatorFor, outputText, turnHookEvaluators, type TurnHookEvaluators } from "../hooks.js";

const SINK = { stopSignal: new AbortController().signal, recordActivity: () => undefined };

function group(event: string, command: string): ReturnType<typeof create<typeof HookGroupSchema>> {
  return create(HookGroupSchema, { event, matcher: ".*", handlers: [create(HookHandlerSchema, { command })] });
}

function subagent(name: string, hooks: TurnSubagent["hooks"]): TurnSubagent {
  return {
    name,
    description: name,
    instructions: "",
    model: undefined,
    toolScope: ToolScope.unrestricted(),
    servers: [],
    skills: [],
    hooks,
    values: {},
    bringsOwn: { plugins: false, hooks: hooks.length > 0, lists: false, mcpServers: false },
  };
}

describe("turnHookEvaluators", () => {
  it("builds none for an agent with no hooks, and one per caller otherwise: a saved sub-agent's after the conversation's", async () => {
    expect(await turnHookEvaluators(turnInputFixture(), SINK, 30_000)).toEqual({ root: null, subagents: new Map() });
    const own = { plugin: null, format: "claude-code" as const, groups: [group("PreToolUse", "true")] };
    const input = turnInputFixture({
      hooks: { sources: [own], serverNames: new Map() },
      subagents: [subagent("reviewer", [{ plugin: null, format: "claude-code", groups: [group("PreToolUse", "true"), group("PostToolUse", "true")] }]), subagent("plain", [])],
    });
    const hooks = await turnHookEvaluators(input, SINK, 30_000);
    expect(hooks.root?.hookSet.all).toHaveLength(1);
    expect(hooks.subagents.get("reviewer")?.hookSet.all).toHaveLength(3);
    expect(hooks.subagents.get("plain")?.hookSet.all).toHaveLength(1);
    expect(evaluatorFor(hooks, { kind: "subagent", type: "reviewer" })).toBe(hooks.subagents.get("reviewer"));
    expect(evaluatorFor(hooks, { kind: "subagent", type: "acme:helper" }), "a plugin's helper runs the main agent's").toBe(hooks.root);
    expect(evaluatorFor(hooks, ROOT_CALLER)).toBe(hooks.root);
  });
});

/** The `audit` plugin's PostToolUse hooks, answering every call with `post`. */
function postHooks(post: Partial<HookRunResult>, outputs: string[] = []): HookEvaluator {
  const run: HookProcessRunner = async (spec) => {
    outputs.push(JSON.stringify((JSON.parse(spec.stdin) as { tool_response?: unknown }).tool_response));
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...post };
  };
  return new HookEvaluator({
    set: HookSet.of([{ source: { plugin: "audit", root: "/p", data: "/d", options: new Map() }, groups: [group("PostToolUse", "post")] }]),
    views: new ClaudeToolViews({ workspaceRoot: "/ws", serverNames: new Map(), platformServerSlugs: new Set() }),
    sessionId: "ses",
    workspaceRoot: "/ws",
    permissionMode: "default",
    baseEnv: {},
    homeDir: "/home",
    leases: new Set(),
    run,
  });
}

function allowed(context: readonly string[] = [], caller: Caller = ROOT_CALLER, toolName = "mcp__stigmer__bash"): GateVerdict {
  return { kind: "allow", source: undefined, caller, toolName, args: { command: "ls" }, rewritten: false, hook: undefined, context };
}

function feedbackOver(hooks: TurnHookEvaluators, verdicts: ReadonlyMap<string, GateVerdict>): HookFeedback {
  return new HookFeedback({ hooks, verdictOf: (id) => verdicts.get(id), serverOf: (name) => (name === "mcp__docs__search" ? { slug: "docs", tool: "search" } : undefined) });
}

const base = { session_id: "s", transcript_path: "", cwd: "/ws" };
const post = (id: string, response: unknown): HookInput => ({ ...base, hook_event_name: "PostToolUse", tool_name: "x", tool_input: {}, tool_response: response, tool_use_id: id });
const failure = (id: string): HookInput => ({ ...base, hook_event_name: "PostToolUseFailure", tool_name: "x", tool_input: {}, tool_use_id: id, error: "boom" });

describe("a hook that runs long", () => {
  it("tells the turn it is alive while it runs", async () => {
    const seen: string[] = [];
    const sink = { stopSignal: new AbortController().signal, recordActivity: (detail?: string) => void seen.push(detail ?? "") };
    const input = turnInputFixture({
      workspaceDir: mkdtempSync(join(tmpdir(), "claude-hooks-")),
      hooks: { sources: [{ plugin: null, format: "claude-code", groups: [group("PreToolUse", "sleep 0.4")] }], serverNames: new Map() },
    });
    const hooks = await turnHookEvaluators(input, sink, 90);
    await hooks.root!.preToolUse({ id: "toolu_slow", name: "Bash", args: { command: "ls" }, serverSlug: "" }, {});
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("HookFeedback", () => {
  const signal = new AbortController().signal;

  it("hands back a PreToolUse hook's context, then a PostToolUse hook's block reasons and context, and keeps the section for the row", async () => {
    const outputs: string[] = [];
    const hooks = { root: postHooks({ stdout: JSON.stringify({ decision: "block", reason: "check the output", hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "audited" } }) }, outputs), subagents: new Map() };
    const feedback = feedbackOver(hooks, new Map([["toolu_1", allowed(["pre said"])]]));
    const after = feedback.callbacks().PostToolUse![0]!.hooks[0]!;
    const section = "Hook feedback:\npre said\n\ncheck the output\n\naudited";
    expect(await after(post("toolu_1", [{ type: "text", text: "listing" }]), "toolu_1", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: section } });
    expect(feedback.sectionOf("toolu_1")).toBe(section);
    expect(outputs, "the hook read the tool's text as Bash's stdout").toEqual([JSON.stringify({ stdout: "listing", stderr: "", interrupted: false, isImage: false })]);
  });

  it("logs a PostToolUse hook that failed, and hands back nothing of it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hooks = { root: postHooks({ exitCode: 1, stderr: "crashed" }), subagents: new Map() };
    const feedback = feedbackOver(hooks, new Map([["toolu_x", allowed()]]));
    expect(await feedback.callbacks().PostToolUse![0]!.hooks[0]!(post("toolu_x", "out"), "toolu_x", { signal })).toEqual({});
    expect(warn.mock.calls.some(([line]) => String(line).includes("a PostToolUse hook failed"))).toBe(true);
    warn.mockRestore();
  });

  it("on a failed call hands back the PreToolUse context alone, through the failure callback", async () => {
    const outputs: string[] = [];
    const hooks = { root: postHooks({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "never" } }) }, outputs), subagents: new Map() };
    const feedback = feedbackOver(hooks, new Map([["toolu_f", allowed(["pre said"])]]));
    const onFailure = feedback.callbacks().PostToolUseFailure![0]!.hooks[0]!;
    expect(await onFailure(failure("toolu_f"), "toolu_f", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: "Hook feedback:\npre said" } });
    expect(outputs).toEqual([]);
  });

  it("says nothing for a call the gate did not let run, one no hook spoke about, or another event", async () => {
    const refused: GateVerdict = { kind: "refuse", message: "no", source: undefined, caller: ROOT_CALLER, hook: undefined, byPerson: false };
    const feedback = feedbackOver(NO_HOOKS, new Map([["toolu_r", refused], ["toolu_q", allowed()]]));
    const after = feedback.callbacks().PostToolUse![0]!.hooks[0]!;
    expect(await after(post("toolu_r", "x"), "toolu_r", { signal })).toEqual({});
    expect(await after(post("toolu_q", "x"), "toolu_q", { signal })).toEqual({});
    expect(await after(post("toolu_none", "x"), "toolu_none", { signal })).toEqual({});
    expect(await after({ ...base, hook_event_name: "SubagentStart", agent_id: "a", agent_type: "t" }, undefined, { signal })).toEqual({});
    expect(feedback.sectionOf("toolu_q")).toBeUndefined();
  });

  it("runs a sub-agent's call through its own evaluator, an MCP call under its bare name and server", async () => {
    const outputs: string[] = [];
    const own = postHooks({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "own" } }) }, outputs);
    const hooks = { root: null, subagents: new Map([["reviewer", own]]) };
    const caller: Caller = { kind: "subagent", type: "reviewer" };
    const feedback = feedbackOver(hooks, new Map([["toolu_s", allowed([], caller, "mcp__docs__search")]]));
    const after = feedback.callbacks().PostToolUse![0]!.hooks[0]!;
    expect(await after({ ...post("toolu_s", [{ type: "text", text: "found" }]), agent_id: "agent_1", agent_type: "reviewer" }, "toolu_s", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Hook feedback:\nown" },
    });
    expect(outputs).toEqual([JSON.stringify([{ type: "text", text: "found" }])]);
  });
});

describe("outputText", () => {
  it("reads an MCP tool's text blocks, a read's content, a string as it is, and anything else as JSON", () => {
    expect(outputText([{ type: "text", text: "a" }, { type: "image", data: "x" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(outputText({ type: "text", file: { filePath: "/a", content: "body" } })).toBe("body");
    expect(outputText("plain")).toBe("plain");
    expect(outputText({ type: "create", filePath: "/a" })).toBe(JSON.stringify({ type: "create", filePath: "/a" }));
    expect(outputText(undefined)).toBe('""');
  });
});
