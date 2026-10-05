/**
 * Pins the hook evaluator (`evaluate.ts`) over a scripted process runner,
 * in Claude Code's format and, last, both formats on one call:
 *  - which handlers run: matcher, `if`, event, and calls no hook may see;
 *  - how answers combine: deny > defer > ask > allow, the decider the first
 *    source in the agent's order, a rewrite taken from the decider's side;
 *  - a hook lease turns that hook's ask on that tool into its allow, and
 *    nothing wider;
 *  - what a command runs with: Claude's stdin, the substituted placeholders,
 *    the environment, the timeout, the tamper guard first;
 *  - PostToolUse: block reasons and context, Claude's `tool_response`.
 */

import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { describe, expect, it, vi } from "vitest";
import { hookLeaseKey } from "../../approval-policy.js";
import { HookEvaluator, type HookEvaluatorDeps } from "../evaluate.js";
import { HookSet, type HookSource, type HookSourceGroups } from "../hook-set.js";
import type { HookProcessRunner, HookProcessSpec, HookRunResult } from "../run.js";
import { NativeToolViews } from "../tool-view.js";

const ROOT = "/ws";

const views = new NativeToolViews({
  workspaceRoot: ROOT,
  toVirtualPath: (path) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length) : undefined),
  toolServerMap: new Map([["create_issue", "github"]]),
  pluginServers: new Map(),
  platformServerSlugs: new Set(),
});

function group(event: string, matcher: string, ...handlers: { command: string; args?: string[]; condition?: string; timeoutSeconds?: number }[]): HookGroup {
  return create(HookGroupSchema, {
    event,
    matcher,
    handlers: handlers.map((h) => create(HookHandlerSchema, { command: h.command, args: h.args ?? [], condition: h.condition ?? "", timeoutSeconds: h.timeoutSeconds ?? 0 })),
  });
}

function plugin(slug: string, extra: Partial<HookSource> = {}): HookSource {
  return { plugin: slug, root: `/platform/plugins/${slug}`, data: `/platform/plugin-data/${slug}`, options: new Map(), ...extra };
}

/** A runner that answers each command from a table keyed by the command, recording every spec it ran. */
function scripted(answers: Record<string, Partial<HookRunResult>>): { run: HookProcessRunner; runs: HookProcessSpec[] } {
  const runs: HookProcessSpec[] = [];
  const run: HookProcessRunner = async (spec) => {
    runs.push(spec);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...answers[spec.command] };
  };
  return { run, runs };
}

const decide = (permissionDecision: string, extra: Record<string, unknown> = {}): Partial<HookRunResult> => ({
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, ...extra } }),
});

function evaluator(
  sources: readonly HookSourceGroups[],
  run: HookProcessRunner,
  extra: Partial<HookEvaluatorDeps> = {},
): HookEvaluator {
  return new HookEvaluator({
    set: HookSet.of(sources),
    views,
    sessionId: "ses_1",
    workspaceRoot: ROOT,
    permissionMode: "default",
    baseEnv: { PATH: "/usr/bin", HOME: "/home/me" },
    homeDir: "/home/me",
    leases: new Set(),
    run,
    ...extra,
  });
}

const SHELL = { id: "call_1", name: "execute", args: { command: "git push origin main" }, serverSlug: "" };
const READ = { id: "call_2", name: "read_file", args: { file_path: "/src/a.ts" }, serverSlug: "" };

describe("which handlers run", () => {
  it("runs a handler whose matcher and `if` take the call, and no other", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator(
      [{
        source: plugin("safety"),
        groups: [
          group("PreToolUse", "Bash", { command: "push-check", condition: "Bash(git push *)" }, { command: "rm-check", condition: "Bash(rm *)" }),
          group("PreToolUse", "Write|Edit", { command: "write-check" }),
          group("PostToolUse", "Bash", { command: "post-check" }),
          group("Stop", "", { command: "never" }),
        ],
      }],
      run,
    );
    await hooks.preToolUse(SHELL, {});
    expect(runs.map((r) => r.command)).toEqual(["push-check"]);
  });

  it("asks nothing about a call no hook may see", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "*", { command: "all" })] }], run);
    const outcome = await hooks.preToolUse({ id: "c", name: "think", args: {}, serverSlug: "" }, {});
    expect(outcome.decision).toBeUndefined();
    expect(runs).toEqual([]);
    expect((await hooks.postToolUse({ id: "c", name: "think", args: {}, serverSlug: "" }, {}, "x")).blockReasons).toEqual([]);
  });

  it("sees an MCP tool by Claude's name", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "mcp__github__.*", { command: "gh" })] }], run);
    await hooks.preToolUse({ id: "c", name: "create_issue", args: {}, serverSlug: "github" }, {});
    expect(runs.map((r) => r.command)).toEqual(["gh"]);
  });
});

describe("how answers combine", () => {
  it("deny outranks ask, and ask outranks allow", async () => {
    const { run } = scripted({ a: decide("allow"), b: decide("ask"), c: decide("deny", { permissionDecisionReason: "no pushes" }) });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "a" }, { command: "b" }, { command: "c" })] }], run);
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(outcome).toMatchObject({ decision: "deny", hook: "safety", reason: "no pushes" });
  });

  it("defer counts as an ask, ahead of a plain ask", async () => {
    const { run } = scripted({ a: decide("ask", { permissionDecisionReason: "first" }), b: decide("defer", { permissionDecisionReason: "deferred" }) });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "a" }, { command: "b" })] }], run);
    expect(await hooks.preToolUse(SHELL, {})).toMatchObject({ decision: "ask", reason: "deferred" });
  });

  it("records as the decider the first source, in the agent's order, that gave the winning answer", async () => {
    const { run } = scripted({ first: decide("ask"), second: decide("ask") });
    const hooks = evaluator(
      [
        { source: plugin("audit"), groups: [group("PreToolUse", "Bash", { command: "first" })] },
        { source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "second" })] },
      ],
      run,
    );
    expect((await hooks.preToolUse(SHELL, {})).hook).toBe("audit");
  });

  it("an agent's own block is recorded with an empty slug", async () => {
    const { run } = scripted({ own: decide("allow") });
    const hooks = evaluator([{ source: { plugin: "", root: "", data: "", options: new Map() }, groups: [group("PreToolUse", "Bash", { command: "own" })] }], run);
    expect(await hooks.preToolUse(SHELL, {})).toMatchObject({ decision: "allow", hook: "" });
  });

  it("takes a rewrite from the winning side, in the engine's shape, never on a deny, and none that changes nothing", async () => {
    const { run } = scripted({ w: decide("allow", { updatedInput: { file_path: "/ws/src/b.ts" } }) });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Read", { command: "w" })] }], run);
    expect((await hooks.preToolUse(READ, {})).updatedArgs).toEqual({ file_path: "/src/b.ts" });

    const denied = scripted({ w: decide("deny", { updatedInput: { file_path: "/ws/x" } }) });
    const deny = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Read", { command: "w" })] }], denied.run);
    expect((await deny.preToolUse(READ, {})).updatedArgs).toBeUndefined();

    const echoed = scripted({ w: decide("ask", { updatedInput: { file_path: "/ws/src/a.ts" } }) });
    const echo = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Read", { command: "w" })] }], echoed.run);
    const asked = await echo.preToolUse(READ, {});
    expect([asked.decision, asked.updatedArgs], "a rewrite that hands the call back as it was is none").toEqual(["ask", undefined]);
  });

  it("drops an allow, and its rewrite, from a handler whose `if` only might match; keeps its deny and a sure allow", async () => {
    const unreadable = { ...SHELL, args: { command: "$(echo rm) -rf ~" } };
    const rule = (command: string) => ({ command, condition: "Bash(npm test *)" });
    const { run } = scripted({
      allows: decide("allow", { updatedInput: { command: "true" } }),
      denies: decide("deny", { permissionDecisionReason: "no" }),
    });
    const allowing = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", rule("allows"))] }], run);
    const dropped = await allowing.preToolUse(unreadable, {});
    expect(dropped.decision).toBeUndefined();
    expect(dropped.updatedArgs).toBeUndefined();
    expect((await allowing.preToolUse({ ...SHELL, args: { command: "npm test --watch" } }, {})).decision).toBe("allow");

    const denying = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", rule("denies"))] }], run);
    expect(await denying.preToolUse(unreadable, {})).toMatchObject({ decision: "deny", reason: "no" });
  });

  it("names the hook whose rewrite runs when two hooks give the same answer", async () => {
    const { run } = scripted({ plain: decide("allow"), rewrites: decide("allow", { updatedInput: { file_path: "/ws/src/b.ts" } }) });
    const hooks = evaluator([
      { source: plugin("first"), groups: [group("PreToolUse", "Read", { command: "plain" })] },
      { source: plugin("second"), groups: [group("PreToolUse", "Read", { command: "rewrites" })] },
    ], run);
    expect(await hooks.preToolUse(READ, {})).toMatchObject({ decision: "allow", hook: "second", updatedArgs: { file_path: "/src/b.ts" } });
  });

  it("gathers every hook's context and every failure, and no failure decides", async () => {
    const { run } = scripted({
      ctx: decide("allow", { additionalContext: "the branch is protected" }),
      broken: { exitCode: 1, stderr: "crash" },
    });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "broken" }, { command: "ctx" })] }], run);
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(outcome.decision).toBe("allow");
    expect(outcome.additionalContext).toEqual(["the branch is protected"]);
    expect(outcome.errors).toEqual(["plugin safety: the command exited 1: crash"]);
  });

  it("a hook that only fails makes no decision", async () => {
    const { run } = scripted({ broken: { exitCode: null, timedOut: true } });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "broken" })] }], run);
    expect((await hooks.preToolUse(SHELL, {})).decision).toBeUndefined();
  });
});

describe("hook leases", () => {
  const sources = [{ source: plugin("safety"), groups: [group("PreToolUse", "Bash|Read", { command: "ask" })] }];

  it("turn that hook's ask on that tool into its allow", async () => {
    const { run } = scripted({ ask: decide("ask") });
    const hooks = evaluator(sources, run, { leases: new Set([hookLeaseKey("safety", "", "execute")]) });
    expect(await hooks.preToolUse(SHELL, {})).toMatchObject({ decision: "allow", leased: true, hook: "safety" });
    expect((await hooks.preToolUse(READ, {})).decision).toBe("ask");
  });

  it("never clear an ask behind an `if` that only might match", async () => {
    const { run } = scripted({ asks: decide("ask") });
    const hooks = evaluator(
      [{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "asks", condition: "Bash(git push *)" })] }],
      run,
      { leases: new Set([hookLeaseKey("safety", "", "execute")]) },
    );
    expect((await hooks.preToolUse(SHELL, {})).decision, "a sure match is leased").toBe("allow");
    expect(await hooks.preToolUse({ ...SHELL, args: { command: "$(echo git) push" } }, {})).toMatchObject({ decision: "ask", leased: false });
  });

  it("never clear another hook's ask, or a deny", async () => {
    const { run } = scripted({ ask: decide("ask"), no: decide("deny") });
    const other = evaluator(sources, run, { leases: new Set([hookLeaseKey("audit", "", "execute")]) });
    expect((await other.preToolUse(SHELL, {})).decision).toBe("ask");
    const denying = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "no" })] }], run, {
      leases: new Set([hookLeaseKey("safety", "", "execute")]),
    });
    expect((await denying.preToolUse(SHELL, {})).decision).toBe("deny");
  });
});

describe("what a command runs with", () => {
  it("reads Claude Code's input on stdin", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "c" })] }], run, { permissionMode: "plan" });
    await hooks.preToolUse(SHELL, { subAgent: { type: "explore", id: "inv-1" } });
    expect(JSON.parse(runs[0]!.stdin)).toEqual({
      session_id: "ses_1",
      transcript_path: "",
      cwd: ROOT,
      permission_mode: "plan",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
      tool_use_id: "call_1",
      agent_id: "inv-1",
      agent_type: "explore",
    });
  });

  it("carries mcp_server for an MCP tool", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "", { command: "c" })] }], run);
    await hooks.preToolUse({ id: "c", name: "create_issue", args: {}, serverSlug: "github" }, {});
    expect(JSON.parse(runs[0]!.stdin).mcp_server).toEqual({ name: "github", source: "managed" });
  });

  it("substitutes the path placeholders in both forms and user_config in exec form, and exports them", async () => {
    const { run, runs } = scripted({});
    const source = plugin("safety", { options: new Map([["api_token", "t0k"]]) });
    const hooks = evaluator(
      [{
        source,
        groups: [group(
          "PreToolUse",
          "Bash",
          { command: '"${CLAUDE_PLUGIN_ROOT}"/check ${CLAUDE_PROJECT_DIR}' },
          { command: "${CLAUDE_PLUGIN_ROOT}/bin/check", args: ["--token", "${user_config.api_token}", "${CLAUDE_PLUGIN_DATA}"] },
        )],
      }],
      run,
    );
    await hooks.preToolUse(SHELL, {});
    expect(runs.map((r) => [r.command, r.args])).toEqual([
      ['"/platform/plugins/safety"/check /ws', null],
      ["/platform/plugins/safety/bin/check", ["--token", "t0k", "/platform/plugin-data/safety"]],
    ]);
    expect(runs[0]!.env).toMatchObject({
      PATH: "/usr/bin",
      CLAUDE_PROJECT_DIR: ROOT,
      CLAUDE_PLUGIN_ROOT: "/platform/plugins/safety",
      CLAUDE_PLUGIN_DATA: "/platform/plugin-data/safety",
      PLUGIN_ROOT: "/platform/plugins/safety",
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "t0k",
      PYTHONDONTWRITEBYTECODE: "1",
    });
    expect(runs[0]!.cwd).toBe(ROOT);
  });

  it("leaves the agent's own block's plugin placeholders alone", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: { plugin: "", root: "", data: "", options: new Map() }, groups: [group("PreToolUse", "Bash", { command: "echo ${CLAUDE_PLUGIN_ROOT}" })] }], run);
    await hooks.preToolUse(SHELL, {});
    expect(runs[0]!.command).toBe("echo ${CLAUDE_PLUGIN_ROOT}");
    expect(runs[0]!.env["CLAUDE_PLUGIN_ROOT"]).toBeUndefined();
  });

  it("does not run a shell-form command that reaches for user_config", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "check ${user_config.api_token}" })] }], run);
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(runs).toEqual([]);
    expect(outcome.decision).toBeUndefined();
    expect(outcome.errors[0]).toContain("cannot reference ${user_config.*}");
  });

  it("uses the handler's timeout, else Claude's ten minutes", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "a", timeoutSeconds: 5 }, { command: "b" })] }], run);
    await hooks.preToolUse(SHELL, {});
    expect(runs.map((r) => r.timeoutSeconds)).toEqual([5, 600]);
  });

  it("verifies the plugin's tree before each run, and reports activity as it pulses", async () => {
    const beforeRun = vi.fn(async () => undefined);
    const onActivity = vi.fn();
    const run: HookProcessRunner = async (_spec, options) => {
      options.onPulse?.();
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const hooks = evaluator([{ source: plugin("safety", { beforeRun }), groups: [group("PreToolUse", "Bash", { command: "a" }, { command: "b" })] }], run, { onActivity });
    await hooks.preToolUse(SHELL, {});
    expect(beforeRun).toHaveBeenCalledTimes(2);
    expect(onActivity).toHaveBeenCalledWith("hook plugin safety");
  });

  it("refuses the call, naming why, when the plugin's tree cannot be restored, and runs nothing", async () => {
    const beforeRun = vi.fn(async () => {
      throw new Error("ENOSPC: no space left on device");
    });
    const run = vi.fn<HookProcessRunner>();
    const hooks = evaluator([{ source: plugin("safety", { beforeRun }), groups: [group("PreToolUse", "Bash", { command: "a" })] }], run);
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(outcome).toMatchObject({
      decision: "deny",
      hook: "safety",
      reason: "the plugin's files could not be restored to the installed version: ENOSPC: no space left on device",
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("PostToolUse", () => {
  it("returns block reasons and context, and hands the hook Claude's tool_response", async () => {
    const { run, runs } = scripted({
      lint: { stdout: JSON.stringify({ decision: "block", reason: "lint failed" }) },
      note: { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "rerun the tests" } }) },
      broken: { exitCode: 4 },
    });
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PostToolUse", "Bash", { command: "lint" }, { command: "note" }, { command: "broken" })] }], run);
    const outcome = await hooks.postToolUse(SHELL, {}, "pushed");
    expect(outcome).toEqual({ blockReasons: ["lint failed"], additionalContext: ["rerun the tests"], errors: ["the command exited 4"] });
    expect(JSON.parse(runs[0]!.stdin).tool_response).toEqual({ stdout: "pushed", stderr: "", interrupted: false, isImage: false });
  });

  it("runs nothing when no PostToolUse hook matches", async () => {
    const { run, runs } = scripted({});
    const hooks = evaluator([{ source: plugin("safety"), groups: [group("PreToolUse", "Bash", { command: "a" })] }], run);
    expect(await hooks.postToolUse(SHELL, {}, "x")).toEqual({ blockReasons: [], additionalContext: [], errors: [] });
    expect(runs).toEqual([]);
  });
});

describe("HookSet", () => {
  it("knows when it needs a shell and when it is empty", () => {
    const shellForm = HookSet.of([{ source: plugin("a"), groups: [group("PreToolUse", "", { command: "x" })] }]);
    const execForm = HookSet.of([{ source: plugin("a"), groups: [group("PreToolUse", "", { command: "x", args: ["y"] })] }]);
    const lifecycle = HookSet.of([{ source: plugin("a"), groups: [group("SessionStart", "", { command: "x" })] }]);
    expect([shellForm.needsShell, execForm.needsShell, lifecycle.isEmpty]).toEqual([true, false, true]);
  });
});

describe("both formats on one call", () => {
  const cursorGroup = (event: string, matcher: string, command: string, failClosed = false): HookGroup =>
    create(HookGroupSchema, { event, matcher, handlers: [create(HookHandlerSchema, { command, failClosed })] });

  it("offers the call to every format's events at once, each under its own names, and combines once", async () => {
    const { run, runs } = scripted({
      "claude-allow": decide("allow"),
      "cursor-pre": { stdout: '{"permission":"allow"}' },
      "cursor-shell": { stdout: '{"permission":"deny","agent_message":"not on main"}' },
      "cursor-miss": { stdout: '{"permission":"deny"}' },
    });
    const hooks = evaluator(
      [
        { source: plugin("claude"), groups: [group("PreToolUse", "Bash", { command: "claude-allow" })] },
        {
          source: plugin("cursor"),
          format: "cursor",
          groups: [
            cursorGroup("preToolUse", "Shell", "cursor-pre"),
            cursorGroup("beforeShellExecution", "git push", "cursor-shell"),
            cursorGroup("beforeShellExecution", "^rm ", "cursor-miss"),
          ],
        },
      ],
      run,
    );
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(runs.map((r) => r.command).sort()).toEqual(["claude-allow", "cursor-pre", "cursor-shell"]);
    expect(outcome).toMatchObject({ decision: "deny", hook: "cursor", reason: "not on main" });
    const shellStdin = JSON.parse(runs.find((r) => r.command === "cursor-shell")!.stdin) as Record<string, unknown>;
    expect(shellStdin).toMatchObject({ hook_event_name: "beforeShellExecution", command: "git push origin main", cwd: ROOT });
    expect(runs.find((r) => r.command === "cursor-pre")!.timeoutSeconds, "a Cursor handler's default timeout").toBe(60);
    expect(runs.find((r) => r.command === "claude-allow")!.timeoutSeconds, "a Claude handler's").toBe(600);
  });

  it("refuses a call whose winning rewrite the engine cannot take, naming why", async () => {
    const { run } = scripted({ "cursor-move": { stdout: JSON.stringify({ permission: "allow", updated_input: { command: "ls", cwd: "/elsewhere" } }) } });
    const hooks = evaluator(
      [{ source: plugin("mover"), format: "cursor", groups: [cursorGroup("preToolUse", "Shell", "cursor-move")] }],
      run,
    );
    const outcome = await hooks.preToolUse(SHELL, {});
    expect(outcome.decision).toBe("deny");
    expect(outcome.hook).toBe("mover");
    expect(outcome.reason).toContain("another directory");
  });

  it("takes a Cursor hook's rewrite back to the engine's arguments", async () => {
    const { run } = scripted({ "cursor-rw": { stdout: JSON.stringify({ permission: "allow", updated_input: { command: "git push origin feature", cwd: ROOT } }) } });
    const hooks = evaluator([{ source: plugin("rw"), format: "cursor", groups: [cursorGroup("preToolUse", "Shell", "cursor-rw")] }], run);
    expect((await hooks.preToolUse(SHELL, {})).updatedArgs).toEqual({ command: "git push origin feature" });
  });

  it("sees a Cursor hook that echoes a listing with no path as no rewrite", async () => {
    const { run } = scripted({ "cursor-echo": { stdout: JSON.stringify({ permission: "ask", updated_input: { pattern: "", glob: "*", file_path: ROOT, output_mode: "files_with_matches" } }) } });
    const hooks = evaluator([{ source: plugin("echo"), format: "cursor", groups: [cursorGroup("preToolUse", "Grep", "cursor-echo")] }], run);
    const listing = await hooks.preToolUse({ id: "call_8", name: "ls", args: {}, serverSlug: "" }, {});
    expect([listing.decision, listing.updatedArgs]).toEqual(["ask", undefined]);
  });

  it("holds a Cursor hook's web fetch policy on this engine, where the tool is always bound", async () => {
    const { run } = scripted({ "cursor-egress": { stdout: JSON.stringify({ permission: "deny", agent_message: "no egress" }) } });
    const hooks = evaluator([{ source: plugin("egress"), format: "cursor", groups: [cursorGroup("preToolUse", "Fetch", "cursor-egress")] }], run);
    const fetch = { id: "call_9", name: "web_fetch", args: { url: "https://example.com" }, serverSlug: "" };
    expect(await hooks.preToolUse(fetch, {})).toMatchObject({ decision: "deny", hook: "egress", reason: "no egress" });
  });

  it("runs Cursor's post events after a call and hands back their context", async () => {
    const { run, runs } = scripted({ "cursor-post": { stdout: '{"additional_context":"reviewed"}' } });
    const hooks = evaluator(
      [{ source: plugin("audit"), format: "cursor", groups: [cursorGroup("postToolUse", "", "cursor-post"), cursorGroup("afterMCPExecution", "", "cursor-post")] }],
      run,
    );
    expect((await hooks.postToolUse({ id: "c", name: "create_issue", args: {}, serverSlug: "github" }, {}, "made")).additionalContext).toEqual([
      "reviewed",
      "reviewed",
    ]);
    expect(runs.map((r) => (JSON.parse(r.stdin) as { hook_event_name: string }).hook_event_name)).toEqual(["postToolUse", "afterMCPExecution"]);
  });

  it("names the longest a handler may run, each format's default where none is set", () => {
    const hooks = evaluator(
      [
        { source: plugin("a"), groups: [group("PreToolUse", "", { command: "x", timeoutSeconds: 5 })] },
        { source: plugin("b"), format: "cursor", groups: [cursorGroup("preToolUse", "", "y")] },
      ],
      scripted({}).run,
    );
    expect(hooks.longestTimeoutSeconds).toBe(60);
    expect(hooks.hookSet.all).toHaveLength(2);
  });
});
