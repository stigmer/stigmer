/**
 * Pins the Cursor engine's hook server (`hook-server.ts`):
 *  - a request without the turn's token is refused, over the real socket,
 *    whose file only its owner can open and which goes with the server;
 *  - a hook's deny, allow and ask become the answers the gate's script
 *    prints, with the hook named, its reason, its rewrite and its context;
 *  - a person's refusal binds over a hook's allow or ask, never over its deny;
 *  - a write a hook moves onto a secret-like path is blocked, and in capture
 *    mode any move is refused;
 *  - after a call, the hooks' feedback comes back under the native heading,
 *    an MCP call's server remembered from its `beforeMCPExecution`;
 *  - every allow and ask is recorded for the row, found by its identity or,
 *    when the stream spells the arguments differently, by its key.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { afterEach, describe, expect, it } from "vitest";
import { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { HookSet } from "../../../shared/hooks/hook-set.js";
import type { HookRunResult } from "../../../shared/hooks/run.js";
import { grantToken, type PersonRefusal } from "../approval-state.js";
import { HookDecisionLog, HookRequestHandler, HookSocketPathError, startHookServer } from "../hook-server.js";
import { CursorEngineToolViews } from "../hook-views.js";

/** An evaluator whose one hook (plugin `safety`, matching everything) answers by the command or tool it is asked about. */
function evaluator(answer: (stdin: Record<string, unknown>) => Partial<HookRunResult>, event = "PreToolUse"): HookEvaluator {
  return new HookEvaluator({
    set: HookSet.of([{
      source: { plugin: "safety", root: "", data: "", options: new Map() },
      groups: [
        create(HookGroupSchema, { event, matcher: "", handlers: [create(HookHandlerSchema, { command: "x" })] }),
      ],
    }]),
    views: new CursorEngineToolViews({ workspaceRoot: "/w", pluginServers: new Map(), platformServerSlugs: new Set() }),
    sessionId: "ses_1",
    workspaceRoot: "/w",
    permissionMode: "default",
    baseEnv: {},
    homeDir: "/home",
    leases: new Set(),
    run: async (spec) => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...answer(JSON.parse(spec.stdin) as Record<string, unknown>) }),
  });
}

const decide = (permissionDecision: string, extra: Record<string, unknown> = {}) => ({
  stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision, ...extra } }),
});

const shellPayload = (command: string) => ({ hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command }, tool_use_id: "c1" });
const SHELL_ID = grantToken("shell", "rm -rf x");

function handler(ev: HookEvaluator, refusals: ReadonlyMap<string, PersonRefusal> = new Map(), captureMode = false) {
  const decisions = new HookDecisionLog();
  return { decisions, h: new HookRequestHandler(ev, refusals, decisions, "tok", captureMode) };
}

const request = (payload: object, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ token: "tok", mode: "pre", payload, identity: SHELL_ID, coarse: SHELL_ID, ...extra });

describe("the hook server's answers", () => {
  it("refuses a request without the turn's token", async () => {
    const { h } = handler(evaluator(() => decide("allow")));
    expect(await h.answer(JSON.stringify({ token: "nope", mode: "pre", payload: shellPayload("ls") }))).toEqual({ error: "unauthorized" });
    expect(await h.answer("not json")).toEqual({ error: "unauthorized" });
    expect(await h.answer(JSON.stringify({ token: "tok", mode: "pre" }))).toEqual({ error: "no payload" });
  });

  it("answers a hook's deny with its reason, naming the hook", async () => {
    const { h } = handler(evaluator(() => decide("deny", { permissionDecisionReason: "no deletes" })));
    const reply = await h.answer(request(shellPayload("rm -rf x")));
    expect(reply).toEqual({
      decision: "deny",
      hook: "safety",
      deny: JSON.stringify({ permission: "deny", agent_message: "The safety plugin's hook refused this call: no deletes", user_message: "The safety plugin's hook refused this call: no deletes" }),
      message: "The safety plugin's hook refused this call: no deletes",
    });
  });

  it("answers an allow with its rewrite and its context, and records it for the row", async () => {
    const { h, decisions } = handler(evaluator(() => decide("allow", { updatedInput: { command: "ls -a" }, additionalContext: "careful" })));
    const reply = await h.answer(request(shellPayload("ls")));
    expect(reply).toMatchObject({ decision: "allow", hook: "safety" });
    expect(JSON.parse((reply as { allow: string }).allow)).toEqual({
      permission: "allow",
      updated_input: { command: "ls -a" },
      additional_context: "Hook feedback:\ncareful",
    });
    expect(decisions.take("shell", "", { command: "rm -rf x" })).toEqual({ provenance: "hook", hook: "safety" });
  });

  it("answers an ask with the card's message, the unattended skip, and the allow a grant would give", async () => {
    const { h } = handler(evaluator(() => decide("ask")));
    const reply = (await h.answer(request(shellPayload("rm -rf x")))) as Record<string, string>;
    expect(reply["decision"]).toBe("ask");
    expect(reply["message"]).toBe("The safety plugin asks before Bash");
    expect(JSON.parse(reply["approval"]!)).toMatchObject({ permission: "deny", user_message: "The safety plugin asks before Bash" });
    expect(JSON.parse(reply["unattended"]!)).toMatchObject({ permission: "deny", user_message: "Skipped (approval not available on this surface): Shell" });
    expect(JSON.parse(reply["allow"]!)).toEqual({ permission: "allow" });
  });

  it("answers none when no hook decides, or the payload names no tool", async () => {
    const { h } = handler(evaluator(() => ({})));
    expect(await h.answer(request(shellPayload("ls")))).toEqual({ decision: "none" });
    expect(await h.answer(request({ hook_event_name: "preToolUse" }))).toEqual({ decision: "none" });
    expect(await h.answer(request({ hook_event_name: "subagentStart", tool_name: "x" }))).toEqual({ decision: "none" });
  });

  it("holds a call a person refused to their refusal over a hook's allow or ask, never over its deny", async () => {
    const refusals = new Map<string, PersonRefusal>([[SHELL_ID, { action: "reject", toolName: "shell" }]]);
    for (const answer of ["allow", "ask"]) {
      const { h, decisions } = handler(evaluator(() => decide(answer)), refusals);
      const reply = (await h.answer(request(shellPayload("rm -rf x")))) as Record<string, string>;
      expect(reply["decision"]).toBe("refused");
      expect(reply["hook"]).toBeUndefined();
      expect(reply["message"]).toBe("Tool 'shell' was rejected by the user. Do not retry it; proceed by taking their objection into account.");
      expect(decisions.take("shell", "", { command: "rm -rf x" }), "a refused call never runs, so no row records a hook").toBeUndefined();
    }
    const skipped = handler(evaluator(() => decide("allow")), new Map([[SHELL_ID, { action: "skip", toolName: "shell" } as const]]));
    expect(((await skipped.h.answer(request(shellPayload("rm -rf x")))) as Record<string, string>)["message"]).toBe(
      "Tool 'shell' was skipped by user. Please proceed without this operation.",
    );
    const denied = handler(evaluator(() => decide("deny")), refusals);
    expect(((await denied.h.answer(request(shellPayload("rm -rf x")))) as Record<string, string>)["decision"]).toBe("deny");
  });

  it("blocks a write a hook moves onto a secret-like path, and refuses any move in capture mode", async () => {
    const write = { hook_event_name: "preToolUse", tool_name: "Write", tool_input: { file_path: "/w/a.txt", content: "x" } };
    const toEnv = handler(evaluator(() => decide("allow", { updatedInput: { file_path: "/w/.env", content: "x" } })));
    const blocked = (await toEnv.h.answer(request(write))) as Record<string, string>;
    expect(blocked["decision"]).toBe("deny");
    expect(blocked["message"]).toContain("secret-like pattern");
    const moved = handler(evaluator(() => decide("allow", { updatedInput: { file_path: "/w/b.txt", content: "x" } })), new Map(), true);
    expect(((await moved.h.answer(request(write))) as Record<string, string>)["message"]).toContain("review cannot follow");
    const free = handler(evaluator(() => decide("allow", { updatedInput: { file_path: "/w/b.txt", content: "x" } })));
    expect(((await free.h.answer(request(write))) as Record<string, string>)["decision"]).toBe("allow");
  });

  it("hands back the hooks' feedback after a call, an MCP call's server remembered from before it ran", async () => {
    const ev = new HookEvaluator({
      set: HookSet.of([{
        source: { plugin: "safety", root: "", data: "", options: new Map() },
        groups: [
          create(HookGroupSchema, { event: "PreToolUse", matcher: "", handlers: [create(HookHandlerSchema, { command: "pre" })] }),
          create(HookGroupSchema, { event: "PostToolUse", matcher: "", handlers: [create(HookHandlerSchema, { command: "post" })] }),
        ],
      }]),
      views: new CursorEngineToolViews({ workspaceRoot: "/w", pluginServers: new Map(), platformServerSlugs: new Set() }),
      sessionId: "ses_1",
      workspaceRoot: "/w",
      permissionMode: "default",
      baseEnv: {},
      homeDir: "/home",
      leases: new Set(),
      run: async (spec) => {
        const stdin = JSON.parse(spec.stdin) as { hook_event_name: string; tool_name: string; tool_response?: unknown };
        if (stdin.hook_event_name !== "PostToolUse") return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        const text = JSON.stringify(stdin.tool_response);
        return { exitCode: 2, stdout: "", stderr: `${stdin.tool_name} said ${text}`, timedOut: false };
      },
    });
    const { h } = handler(ev);
    await h.answer(request({ hook_event_name: "beforeMCPExecution", tool_name: "search", tool_input: '{"q":"a"}', mcp_server_name: "github" }));
    const post = (payload: object) => h.answer(JSON.stringify({ token: "tok", mode: "post", payload }));
    const mcp = (await post({ hook_event_name: "postToolUse", tool_name: "MCP:search", tool_input: { q: "a" }, tool_output: '{"content":[{"type":"text","text":"found"}]}' })) as { response: string };
    expect(JSON.parse(mcp.response)).toEqual({ additional_context: 'Hook feedback:\nmcp__github__search said [{"type":"text","text":"found"}]' });
    const unknown = (await post({ hook_event_name: "postToolUse", tool_name: "MCP:search", tool_input: { q: "a" } })) as { response: string };
    expect(unknown.response, "a second post of the same call has no server left to name").toBe("{}");
    const shell = (await post({ hook_event_name: "postToolUse", tool_name: "Shell", tool_input: { command: "ls" }, tool_output: '{"output":"src","exitCode":0}' })) as { response: string };
    expect(JSON.parse(shell.response).additional_context).toContain('Bash said {"stdout":"src"');
  });
});

describe("the decision log", () => {
  it("hands each decision to its row once, by identity, else by key, oldest first", () => {
    const log = new HookDecisionLog();
    log.record(grantToken("Read", "/w/a"), { provenance: "hook", hook: "one" });
    log.record(grantToken("Grep", "/w"), { provenance: "approval_lease", hook: "two" });
    log.record(grantToken("Grep", "/w/docs"), { provenance: "hook", hook: "three" });
    expect(log.take("read", "", { path: "/w/a" })).toEqual({ provenance: "hook", hook: "one" });
    expect(log.take("read", "", { path: "/w/a" }), "taken once").toBeUndefined();
    expect(log.take("glob", "", { targetDirectory: "/elsewhere" }), "spelled otherwise: by key, oldest first").toEqual({ provenance: "approval_lease", hook: "two" });
    expect(log.take("shell", "", { command: "ls" })).toBeUndefined();
  });
});

describe("the socket", () => {
  const started: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of started.splice(0)) await close();
  });

  it("serves the turn's token over a socket only its owner can open, and goes with the server", async () => {
    const server = await startHookServer({ evaluator: evaluator(() => decide("allow")), refusals: new Map(), captureMode: false });
    started.push(() => server.close());
    expect(statSync(server.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(server.socketPath)).mode & 0o777).toBe(0o700);
    const ask = (line: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = createConnection(server.socketPath);
        let out = "";
        socket.setEncoding("utf-8");
        socket.on("data", (chunk: string) => (out += chunk));
        socket.on("end", () => resolve(out));
        socket.on("error", reject);
        socket.write(`${line}\n`);
      });
    expect(JSON.parse(await ask(JSON.stringify({ token: server.token, mode: "pre", payload: shellPayload("ls"), identity: "", coarse: "" })))).toMatchObject({
      decision: "allow",
      hook: "safety",
    });
    expect(JSON.parse(await ask(JSON.stringify({ token: "wrong", mode: "pre", payload: shellPayload("ls") })))).toEqual({ error: "unauthorized" });
    await server.close();
    await server.close();
    expect(existsSync(dirname(server.socketPath))).toBe(false);
  });

  it("refuses to start, as an infrastructure fault, where the socket's path is too long", async () => {
    const realTmp = process.env["TMPDIR"];
    const long = join(mkdtempSync(join(tmpdir(), "long-")), "x".repeat(90));
    mkdirSync(long, { recursive: true });
    process.env["TMPDIR"] = long;
    try {
      await expect(startHookServer({ evaluator: evaluator(() => ({})), refusals: new Map(), captureMode: false })).rejects.toThrow(HookSocketPathError);
    } finally {
      if (realTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = realTmp;
      rmSync(dirname(long), { recursive: true, force: true });
    }
  });
});
