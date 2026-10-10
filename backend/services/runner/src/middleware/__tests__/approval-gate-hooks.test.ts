/**
 * Pins what the native gate does with an agent's hooks beyond what the
 * gateway contract observes from outside: the custom-stream events it
 * writes (a hook's refusal, and which hook decided a call that runs), the
 * card's payload for a hook's ask, the hook recorded beside an unattended
 * skip, a rewrite checked again against the secret block, and the hooks'
 * feedback appended to the result, a graph command's tool message included.
 * `interrupt()` is mocked; the hooks are
 * the real evaluator over a scripted process runner.
 */

import { create } from "@bufbuild/protobuf";
import { ToolMessage } from "@langchain/core/messages";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hookLeaseKey } from "../../shared/approval-policy.js";
import { HookEvaluator } from "../../shared/hooks/evaluate.js";
import { HookSet } from "../../shared/hooks/hook-set.js";
import type { HookProcessRunner, HookRunResult } from "../../shared/hooks/run.js";
import { NativeToolViews } from "../../shared/hooks/tool-view.js";
import { createApprovalGateMiddleware, HOOK_FEEDBACK_HEADING, TOOL_POLICY_EVENT, type ApprovalGateConfig } from "../approval-gate.js";
import { TOOL_REFUSED_EVENT } from "../tool-scope.js";
import type { ToolCallRequest } from "../types.js";

vi.mock("@langchain/langgraph", async (importOriginal) => ({ ...(await importOriginal<object>()), interrupt: vi.fn() }));
import { Command, interrupt } from "@langchain/langgraph";

const mockedInterrupt = vi.mocked(interrupt);

/** Hooks whose PreToolUse answer for every Bash and Write call is `pre`, and PostToolUse answer `post`. */
function hooksAnswering(pre: Partial<HookRunResult>, post: Partial<HookRunResult> = {}, leases: ReadonlySet<string> = new Set()): HookEvaluator {
  const run: HookProcessRunner = async (spec) => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...(spec.command === "post" ? post : pre) });
  const group = (event: string, command: string) =>
    create(HookGroupSchema, { event, matcher: "Bash|Write", handlers: [create(HookHandlerSchema, { command })] });
  return new HookEvaluator({
    set: HookSet.of([{
      source: { plugin: "safety", root: "/p", data: "/d", options: new Map() },
      groups: [group("PreToolUse", "pre"), group("PostToolUse", "post")],
    }]),
    views: new NativeToolViews({
      workspaceRoot: "/ws",
      toVirtualPath: (path) => (path.startsWith("/ws/") ? path.slice(3) : undefined),
      toolServerMap: new Map(),
      pluginServers: new Map(),
      platformServerSlugs: new Set(),
    }),
    sessionId: "ses",
    workspaceRoot: "/ws",
    permissionMode: "default",
    baseEnv: {},
    homeDir: "/home",
    leases,
    run,
  });
}

const decide = (permissionDecision: string, extra: Record<string, unknown> = {}): Partial<HookRunResult> => ({
  stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision, ...extra } }),
});

function gate(hooks: HookEvaluator, extra: Partial<ApprovalGateConfig> = {}) {
  return createApprovalGateMiddleware({
    mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() },
    toolServerMap: new Map(),
    hooks,
    ...extra,
  });
}

function call(name: string, args: Record<string, unknown>): { request: ToolCallRequest; writer: ReturnType<typeof vi.fn> } {
  const writer = vi.fn();
  return {
    request: { toolCall: { id: "call_1", name, args }, tool: {}, state: { messages: [] }, runtime: { writer } },
    writer,
  };
}

const SHELL_ARGS = { command: "git push origin main" };

describe("the gate's hooks", () => {
  beforeEach(() => mockedInterrupt.mockReset());

  it("an allow runs the call without a card and reports the hook that decided", async () => {
    const { request, writer } = call("execute", SHELL_ARGS);
    const handler = vi.fn(async () => new ToolMessage({ content: "pushed", tool_call_id: "call_1", name: "execute" }));
    await gate(hooksAnswering(decide("allow"))).wrapToolCall!(request, handler);
    expect(mockedInterrupt).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith({ name: TOOL_POLICY_EVENT, tool_call_id: "call_1", policy_source: "hook", policy_hook: "safety" });
  });

  it("a deny never runs the handler, and reports the refusal with the hook", async () => {
    const { request, writer } = call("execute", SHELL_ARGS);
    const handler = vi.fn();
    const result = (await gate(hooksAnswering(decide("deny", { permissionDecisionReason: "no pushes on Friday" }))).wrapToolCall!(
      request,
      handler,
    )) as ToolMessage;
    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.content).toBe("The safety plugin's hook refused this call: no pushes on Friday");
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ name: TOOL_REFUSED_EVENT, policy_source: "hook", policy_hook: "safety" }));
  });

  it("an ask shows a card naming the hook, with its reason or Claude's tool name", async () => {
    mockedInterrupt.mockReturnValue({ action: "approve" });
    const { request, writer } = call("execute", SHELL_ARGS);
    const handler = vi.fn(async () => new ToolMessage({ content: "pushed", tool_call_id: "call_1", name: "execute" }));
    await gate(hooksAnswering(decide("ask"))).wrapToolCall!(request, handler);
    expect(mockedInterrupt).toHaveBeenCalledWith({
      tool_call_id: "call_1",
      tool_name: "execute",
      mcp_server_slug: "",
      message: "The safety plugin asks before Bash",
      policy_source: "hook",
      policy_hook: "safety",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ name: TOOL_POLICY_EVENT, policy_source: "hook" }));

    mockedInterrupt.mockReturnValue({ action: "skip" });
    const skipped = vi.fn();
    await gate(hooksAnswering(decide("ask", { permissionDecisionReason: "pushing needs a person" }))).wrapToolCall!(call("execute", SHELL_ARGS).request, skipped);
    expect(mockedInterrupt).toHaveBeenLastCalledWith(expect.objectContaining({ message: "pushing needs a person" }));
    expect(skipped).not.toHaveBeenCalled();
  });

  it("an ask that rewrites the call carries the rewrite to the card, and runs it once approved", async () => {
    mockedInterrupt.mockReturnValue({ action: "approve" });
    const handler = vi.fn(async (req: ToolCallRequest) => new ToolMessage({ content: String(req.toolCall.args["command"]), tool_call_id: "call_1", name: "execute" }));
    const result = (await gate(hooksAnswering(decide("ask", { updatedInput: { command: "git push --dry-run" } }))).wrapToolCall!(
      call("execute", SHELL_ARGS).request,
      handler,
    )) as ToolMessage;
    expect(mockedInterrupt).toHaveBeenCalledWith(expect.objectContaining({ args: { command: "git push --dry-run" } }));
    expect(result.content).toBe("git push --dry-run");

    await gate(hooksAnswering(decide("ask"))).wrapToolCall!(call("execute", SHELL_ARGS).request, handler);
    expect(mockedInterrupt).toHaveBeenLastCalledWith(expect.not.objectContaining({ args: expect.anything() }));
  });

  it("under trust this whole run, an ask is satisfied and recorded as the bypass", async () => {
    const { request, writer } = call("execute", SHELL_ARGS);
    const handler = vi.fn(async () => new ToolMessage({ content: "ok", tool_call_id: "call_1", name: "execute" }));
    await gate(hooksAnswering(decide("ask")), { globalBypass: true }).wrapToolCall!(request, handler);
    expect(mockedInterrupt).not.toHaveBeenCalled();
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ policy_source: "auto_approve_all", policy_hook: "safety" }));
  });

  it("a leased ask runs as the lease, naming the hook", async () => {
    const { request, writer } = call("execute", SHELL_ARGS);
    const handler = vi.fn(async () => new ToolMessage({ content: "ok", tool_call_id: "call_1", name: "execute" }));
    await gate(hooksAnswering(decide("ask"), {}, new Set([hookLeaseKey("safety", "", "execute")]))).wrapToolCall!(request, handler);
    expect(mockedInterrupt).not.toHaveBeenCalled();
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ policy_source: "approval_lease", policy_hook: "safety" }));
  });

  it("unattended, an ask is skipped and the hook recorded beside it", async () => {
    const unattendedSkips = new Map<string, string | null>();
    const handler = vi.fn();
    await gate(hooksAnswering(decide("ask")), { unattended: true, unattendedSkips }).wrapToolCall!(call("execute", SHELL_ARGS).request, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(unattendedSkips.get("call_1")).toBe("safety");
  });

  it("a rewrite into a secret-like path is blocked like the call it became", async () => {
    const recordBlockedSecret = vi.fn();
    const handler = vi.fn();
    const result = (await gate(hooksAnswering(decide("allow", { updatedInput: { file_path: "/ws/.env", content: "TOKEN=x" } })), { recordBlockedSecret }).wrapToolCall!(
      call("write_file", { file_path: "/notes.md", content: "hi" }).request,
      handler,
    )) as ToolMessage;
    expect(handler).not.toHaveBeenCalled();
    expect(recordBlockedSecret).toHaveBeenCalledWith("/.env");
    expect(String(result.content)).toContain("blocked for security");
  });

  it("runs the rewritten call", async () => {
    const handler = vi.fn(async (req: ToolCallRequest) => new ToolMessage({ content: String(req.toolCall.args["command"]), tool_call_id: "call_1", name: "execute" }));
    const result = (await gate(hooksAnswering(decide("allow", { updatedInput: { command: "git push --dry-run" } }))).wrapToolCall!(
      call("execute", SHELL_ARGS).request,
      handler,
    )) as ToolMessage;
    expect(result.content).toContain("git push --dry-run");
  });

  it("appends every hook's feedback to a result under one heading", async () => {
    const handler = vi.fn(async () => new ToolMessage({ content: "pushed", tool_call_id: "call_1", name: "execute" }));
    const result = (await gate(
      hooksAnswering(decide("allow", { additionalContext: "the branch is protected" }), {
        stdout: JSON.stringify({ decision: "block", reason: "CI is red", hookSpecificOutput: { additionalContext: "rerun CI" } }),
      }),
    ).wrapToolCall!(call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
    expect(result.content).toBe(`pushed\n\n${HOOK_FEEDBACK_HEADING}\nthe branch is protected\n\nCI is red\n\nrerun CI`);
  });

  it("appends the feedback to a graph command's tool message for the call, keeping the rest of the command", async () => {
    const other = new ToolMessage({ content: "other", tool_call_id: "call_0", name: "execute" });
    const own = new ToolMessage({ content: "written", tool_call_id: "call_1", name: "write_file" });
    const handler = vi.fn(async () => new Command({ update: { files: { "/a": "x" }, messages: [other, own] }, goto: "next" }));
    const result = (await gate(
      hooksAnswering(decide("allow"), { stdout: JSON.stringify({ decision: "block", reason: "lint failed" }) }),
    ).wrapToolCall!(call("write_file", { file_path: "/a", content: "x" }).request, handler)) as Command;
    expect(result).toBeInstanceOf(Command);
    const update = result.update as { files: unknown; messages: ToolMessage[] };
    expect(update.files).toEqual({ "/a": "x" });
    expect(update.messages[0]).toBe(other);
    expect(update.messages[1]!.content).toBe(`written\n\n${HOOK_FEEDBACK_HEADING}\nlint failed`);
    expect(result.goto).toEqual(["next"]);
  });

  it("returns a graph command as it is when it holds no message for the call, or the hooks add nothing", async () => {
    const elsewhere = new Command({ update: { messages: [new ToolMessage({ content: "x", tool_call_id: "call_0", name: "task" })] } });
    const noMessages = new Command({ update: [["files", {}]] });
    const quiet = new Command({ update: { messages: [new ToolMessage({ content: "x", tool_call_id: "call_1", name: "write_file" })] } });
    for (const command of [elsewhere, noMessages]) {
      const out = await gate(hooksAnswering(decide("allow"), { stdout: JSON.stringify({ decision: "block", reason: "r" }) })).wrapToolCall!(
        call("write_file", { file_path: "/a", content: "x" }).request,
        vi.fn(async () => command),
      );
      expect(out).toBe(command);
    }
    const out = await gate(hooksAnswering(decide("allow"))).wrapToolCall!(call("write_file", { file_path: "/a", content: "x" }).request, vi.fn(async () => quiet));
    expect(out).toBe(quiet);
  });

  it("runs no PostToolUse hook on a failed call, but still hands back PreToolUse context", async () => {
    const handler = vi.fn(async () => new ToolMessage({ content: "exit 1", tool_call_id: "call_1", name: "execute", status: "error" }));
    const result = (await gate(
      hooksAnswering(decide("allow", { additionalContext: "careful" }), { stdout: JSON.stringify({ decision: "block", reason: "never seen" }) }),
    ).wrapToolCall!(call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
    expect(result.content).toBe(`exit 1\n\n${HOOK_FEEDBACK_HEADING}\ncareful`);
    expect(result.status).toBe("error");
  });

  it("logs a failed PostToolUse hook and leaves the result as it was", async () => {
    const handler = vi.fn(async () => new ToolMessage({ content: "pushed", tool_call_id: "call_1", name: "execute" }));
    const result = (await gate(hooksAnswering(decide("allow"), { exitCode: 5 })).wrapToolCall!(call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
    expect(result.content).toBe("pushed");
  });

  it("under capture mode, a hook's allow on a write that names no file still runs it", async () => {
    const handler = vi.fn(async () => new ToolMessage({ content: "ok", tool_call_id: "call_1", name: "write_file" }));
    const isCapturablePath = vi.fn(async () => true);
    await gate(hooksAnswering(decide("allow")), { fileCaptureMode: true, isCapturablePath }).wrapToolCall!(call("write_file", { content: "x" }).request, handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(isCapturablePath).not.toHaveBeenCalled();
  });

  it("with no hook decision, the default decides", async () => {
    mockedInterrupt.mockReturnValue({ action: "reject" });
    const handler = vi.fn();
    await gate(hooksAnswering({})).wrapToolCall!(call("execute", SHELL_ARGS).request, handler);
    expect(mockedInterrupt).toHaveBeenCalledWith(expect.objectContaining({ policy_source: "builtin_category" }));
    expect(handler).not.toHaveBeenCalled();
  });
});
