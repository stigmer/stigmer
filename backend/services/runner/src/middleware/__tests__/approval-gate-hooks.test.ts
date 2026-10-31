/**
 * Pins what the Stigmer harness's gate does with an agent's hooks beyond what the
 * gateway contract observes from outside: the custom-stream events it
 * writes (a hook's refusal, and which hook decided a call that runs), the
 * card's payload for a hook's ask, the hook recorded beside an unattended
 * skip (and the skip's refusal event, which opens its row), a rewrite checked again against the secret block and against
 * the graph's tool scope (refused as the scope refuses, under the pre-armed bypass too), and the hooks'
 * feedback appended to the result, a graph command's tool message included,
 * and an approval that runs only the call its card showed, across the
 * restarted node's second run of a hook that does not answer the same way,
 * with no lease answering a call a person answered.
 * `interrupt()` is mocked; the hooks are
 * the real evaluator over a scripted process runner.
 */

import { create } from "@bufbuild/protobuf";
import { ToolMessage } from "@langchain/core/messages";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGED_MESSAGE, hookLeaseKey } from "../../shared/approval-policy.js";
import { HookEvaluator } from "../../shared/hooks/evaluate.js";
import { HookSet } from "../../shared/hooks/hook-set.js";
import type { HookProcessRunner, HookRunResult } from "../../shared/hooks/run.js";
import { StigmerToolViews } from "../../shared/hooks/tool-view.js";
import { createApprovalGateMiddleware, HOOK_FEEDBACK_HEADING, TOOL_POLICY_EVENT, type ApprovalGateConfig } from "../approval-gate.js";
import { TOOL_REFUSED_EVENT, type ToolScopeConfig } from "../tool-scope.js";
import { outOfScopeMessage, ToolScope, type ToolLists } from "../../shared/tool-lists.js";
import type { ToolCallRequest } from "../types.js";

vi.mock("@langchain/langgraph", async (importOriginal) => ({ ...(await importOriginal<object>()), interrupt: vi.fn() }));
import { Command, interrupt } from "@langchain/langgraph";
import { McpToolIndex } from "../../shared/mcp-tool-names.js";

const mockedInterrupt = vi.mocked(interrupt);

/** Hooks whose PreToolUse answer for every Bash, Write and Read call is `pre`, and PostToolUse answer `post`. */
function hooksAnswering(pre: Partial<HookRunResult>, post: Partial<HookRunResult> = {}, leases: ReadonlySet<string> = new Set()): HookEvaluator {
  return hooksRunning(async (spec) => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...(spec.command === "post" ? post : pre) }), leases);
}

/** Hooks whose PreToolUse answers `answers` in turn, one per run, repeating the last: a hook that is not repeatable. */
function hooksAnsweringInTurn(...answers: Partial<HookRunResult>[]): HookEvaluator {
  let runs = 0;
  return hooksRunning(async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...answers[Math.min(runs++, answers.length - 1)] }));
}

function hooksRunning(run: HookProcessRunner, leases: ReadonlySet<string> = new Set()): HookEvaluator {
  const group = (event: string, command: string) =>
    create(HookGroupSchema, { event, matcher: "Bash|Write|Read", handlers: [create(HookHandlerSchema, { command })] });
  return new HookEvaluator({
    set: HookSet.of([{
      source: { plugin: "safety", root: "/p", data: "/d", options: new Map() },
      groups: [group("PreToolUse", "pre"), group("PostToolUse", "post")],
    }]),
    views: new StigmerToolViews({
      workspaceRoot: "/ws",
      toVirtualPath: (path) => (path.startsWith("/ws/") ? path.slice(3) : undefined),
      serverNames: new Map(),
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

function gate(hooks: HookEvaluator, extra: Partial<ApprovalGateConfig> = {}, toolScope?: ToolScopeConfig) {
  return createApprovalGateMiddleware(
    {
      mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() },
      mcpIndex: McpToolIndex.EMPTY,
      hooks,
      ...extra,
    },
    toolScope,
  );
}

/** A graph's tool scope over these lists: the platform dir is routed, and its `skills/` holds skills' files. */
function scopeOf(lists: ToolLists): ToolScopeConfig {
  return {
    scope: ToolScope.of('Agent "a"', lists),
    mcpIndex: McpToolIndex.EMPTY,
    platformServerSlugs: new Set(),
    admitsRoutedRead: async (path) => path.startsWith("/.stigmer/"),
    readsSkillContent: async (path) => path.startsWith("/.stigmer/skills/"),
  };
}

/** Stands in for LangGraph's pause: the node stops at `interrupt()` until a resume. */
class Paused extends Error {}

/**
 * One call as LangGraph runs it across a person's answer: the first
 * invocation pauses on the card, and the restarted node's second resumes
 * with the answer and, as `resolveResumeInput` builds it from the pending
 * interrupt, the arguments the card showed. `answer` may replace that value.
 */
async function acrossResume(
  middleware: ReturnType<typeof gate>,
  request: ToolCallRequest,
  handler: (request: ToolCallRequest) => Promise<ToolMessage | Command>,
  answer: (shown: { args?: Record<string, unknown> }) => unknown = (shown) => ({ action: "approve", ...(shown.args !== undefined ? { args: shown.args } : {}) }),
): Promise<ToolMessage | Command> {
  let shown: { args?: Record<string, unknown> } = {};
  mockedInterrupt.mockImplementationOnce((payload) => {
    shown = payload as typeof shown;
    throw new Paused();
  });
  await expect(middleware.wrapToolCall!(request, handler)).rejects.toBeInstanceOf(Paused);
  mockedInterrupt.mockImplementationOnce(() => answer(shown));
  return middleware.wrapToolCall!(request, handler);
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

  it("an ask that rewrites the call carries the rewrite to the card, and runs it once approved as shown", async () => {
    mockedInterrupt.mockReturnValue({ action: "approve", args: { command: "git push --dry-run" } });
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

  describe("an approval runs only the call its card showed", () => {
    const rewrite = (command: string, decision = "ask") => decide(decision, { updatedInput: { command } });
    const echo = () => vi.fn(async (req: ToolCallRequest) => new ToolMessage({ content: String(req.toolCall.args["command"]), tool_call_id: "call_1", name: "execute" }));
    const changed = (input: Record<string, unknown>) => ({ name: TOOL_REFUSED_EVENT, tool_call_id: "call_1", tool_name: "execute", input, message: CHANGED_MESSAGE });

    it("refuses an approved call whose rewrite changed on resume, unrun, and tells its row on the stream", async () => {
      const { request, writer } = call("execute", SHELL_ARGS);
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnsweringInTurn(rewrite("git push --dry-run #1"), rewrite("git push --dry-run #2"))), request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect([result.content, result.status]).toEqual([CHANGED_MESSAGE, "error"]);
      expect(writer).toHaveBeenCalledWith(changed({ command: "git push --dry-run #2" }));
      expect(writer).not.toHaveBeenCalledWith(expect.objectContaining({ name: TOOL_POLICY_EVENT }));
    });

    it("runs a rewrite that resumes as it was shown, once, as rewritten", async () => {
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnswering(rewrite("git push --dry-run"))), call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
      expect(handler).toHaveBeenCalledOnce();
      expect(result.content).toBe("git push --dry-run");
    });

    it("refuses an approved rewrite that is gone on resume, where the default asks instead", async () => {
      const { request, writer } = call("execute", SHELL_ARGS);
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnsweringInTurn(rewrite("git push --dry-run"), {})), request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).toBe(CHANGED_MESSAGE);
      expect(writer).toHaveBeenCalledWith(changed(SHELL_ARGS));
    });

    it("refuses a call the default showed as the model made it, when a hook asks with a rewrite on resume", async () => {
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnsweringInTurn({}, rewrite("git push --force"))), call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).toBe(CHANGED_MESSAGE);
    });

    it("refuses a resume that does not say which rewrite was approved, or says it malformed", async () => {
      for (const args of [undefined, "git push --dry-run", ["git push --dry-run"], null]) {
        const handler = echo();
        const hooks = hooksAnswering(rewrite("git push --dry-run"));
        const result = (await acrossResume(gate(hooks), call("execute", SHELL_ARGS).request, handler, () => ({ action: "approve", args }))) as ToolMessage;
        expect(handler, String(args)).not.toHaveBeenCalled();
        expect(result.content).toBe(CHANGED_MESSAGE);
      }
    });

    it("runs the model's own call approved with a malformed resume, which says nothing a card did not", async () => {
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnswering(decide("ask"))), call("execute", SHELL_ARGS).request, handler, () => ({ action: "approve", args: "x" }))) as ToolMessage;
      expect(result.content).toBe(SHELL_ARGS.command);
    });

    it("runs a call the hook allows on resume on the hook's word, whatever the card showed", async () => {
      const { request, writer } = call("execute", SHELL_ARGS);
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnsweringInTurn(rewrite("git push --dry-run #1"), rewrite("git push --dry-run #2", "allow"))), request, handler)) as ToolMessage;
      expect(result.content).toBe("git push --dry-run #2");
      expect(writer).toHaveBeenCalledWith({ name: TOOL_POLICY_EVENT, tool_call_id: "call_1", policy_source: "hook", policy_hook: "safety" });
    });

    it("answers a call a person approved through their answer, never the lease their approve-all granted on it", async () => {
      const leased = new Set([hookLeaseKey("safety", "", "execute")]);
      const evaluator = () =>
        hooksRunning(
          (() => {
            let runs = 0;
            return async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...rewrite(`git push --dry-run #${++runs}`) });
          })(),
          leased,
        );
      const handler = echo();
      const changedCall = (await acrossResume(gate(evaluator(), { approvedByPerson: new Set(["call_1"]) }), call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(changedCall.content).toBe(CHANGED_MESSAGE);

      // The lease still clears the hook's asks on every other call, with no card.
      const { request, writer } = call("execute", SHELL_ARGS);
      await gate(evaluator(), { approvedByPerson: new Set(["call_0"]) }).wrapToolCall!(request, handler);
      expect(handler).toHaveBeenCalledOnce();
      expect(writer).toHaveBeenCalledWith(expect.objectContaining({ name: TOOL_POLICY_EVENT, policy_source: "approval_lease" }));
    });

    it("holds a call a person approved to its card where a lease would clear the default's ask, and runs it as shown", async () => {
      const { request, writer } = call("execute", SHELL_ARGS);
      const handler = echo();
      const leasedShell = { approvedByPerson: new Set(["call_1"]), leasedCategories: new Set(["shell" as const]) };
      const result = (await acrossResume(gate(hooksAnsweringInTurn(rewrite("git push --dry-run"), {}), leasedShell), request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).toBe(CHANGED_MESSAGE);
      expect(writer).toHaveBeenCalledWith(changed(SHELL_ARGS));

      mockedInterrupt.mockReturnValue({ action: "approve" });
      const asShown = (await gate(hooksAnswering({}), leasedShell).wrapToolCall!(call("execute", SHELL_ARGS).request, handler)) as ToolMessage;
      expect(mockedInterrupt).toHaveBeenCalledWith(expect.objectContaining({ policy_source: "builtin_category" }));
      expect(asShown.content).toBe(SHELL_ARGS.command);
    });

    it("answers a call a person approved through their answer where a server lease would clear the default's ask", async () => {
      mockedInterrupt.mockReturnValue({ action: "approve" });
      const handler = vi.fn(async () => new ToolMessage({ content: "dropped", tool_call_id: "call_1", name: "mcp__docs__drop" }));
      const leasedServer = {
        mcpDefault: { destructive: new Set(["docs/drop"]), unlisted: new Set<string>(), leasedServers: new Set(["docs"]) },
        mcpIndex: McpToolIndex.of([{ slug: "docs", tools: ["drop"] }]),
      };
      await gate(hooksAnswering({}), { ...leasedServer, approvedByPerson: new Set(["call_1"]) }).wrapToolCall!(call("mcp__docs__drop", { id: "7" }).request, handler);
      expect(mockedInterrupt).toHaveBeenCalledWith(expect.objectContaining({ tool_name: "drop", mcp_server_slug: "docs", policy_source: "annotation_destructive_tighten" }));
      expect(handler).toHaveBeenCalledOnce();

      // Any other call of that server runs on the lease, with no card.
      mockedInterrupt.mockClear();
      await gate(hooksAnswering({}), leasedServer).wrapToolCall!(call("mcp__docs__drop", { id: "8" }).request, handler);
      expect(mockedInterrupt).not.toHaveBeenCalled();
    });

    it("leaves a skip of a changed call a skip", async () => {
      const handler = echo();
      const result = (await acrossResume(gate(hooksAnsweringInTurn(rewrite("a"), rewrite("b"))), call("execute", SHELL_ARGS).request, handler, () => ({ action: "skip" }))) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).not.toBe(CHANGED_MESSAGE);
    });
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

  it("unattended, an ask is skipped and the hook recorded beside it, in the registry and on the custom stream", async () => {
    const unattendedSkips = new Map<string, string | null>();
    const handler = vi.fn();
    const { request, writer } = call("execute", SHELL_ARGS);
    await gate(hooksAnswering(decide("ask")), { unattended: true, unattendedSkips }).wrapToolCall!(request, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(unattendedSkips.get("call_1")).toBe("safety");
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ name: TOOL_REFUSED_EVENT, tool_call_id: "call_1", tool_name: "execute", policy_source: "unattended_skip", policy_hook: "safety" }),
    );
  });

  it("unattended, the default's ask is skipped with no hook named on the custom stream", async () => {
    const unattendedSkips = new Map<string, string | null>();
    const { request, writer } = call("execute", SHELL_ARGS);
    await gate(hooksAnswering(decide("ask")), { unattended: true, unattendedSkips, hooks: undefined }).wrapToolCall!(request, vi.fn());
    expect(unattendedSkips.get("call_1")).toBeNull();
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ name: TOOL_REFUSED_EVENT, policy_source: "unattended_skip", policy_hook: "" }));
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

  describe("a rewrite judged again by the graph's tool scope", () => {
    const readOnly = scopeOf({ tools: ["Grep"], disallowedTools: [] });
    const rewritesTo = (file_path: string) => hooksAnswering(decide("allow", { updatedInput: { file_path } }));
    const read = (file_path: string) => call("read_file", { file_path });

    it("refuses a routed read rewritten into a workspace file, with the scope's message and event, under the bypass too", async () => {
      for (const globalBypass of [false, true]) {
        const { request, writer } = read("/.stigmer/inputs/brief.md");
        const handler = vi.fn();
        const result = (await gate(rewritesTo("/ws/src/app.ts"), { globalBypass }, readOnly).wrapToolCall!(request, handler)) as ToolMessage;
        const message = outOfScopeMessage("read_file", readOnly.scope);
        expect(handler).not.toHaveBeenCalled();
        expect(result.status).toBe("error");
        expect(result.content).toBe(message);
        expect(writer).toHaveBeenCalledWith({ name: TOOL_REFUSED_EVENT, tool_call_id: "call_1", tool_name: "read_file", input: { file_path: "/src/app.ts" }, message });
      }
    });

    it("refuses a rewrite into a skill's files when the scope hides skills", async () => {
      const hidden = scopeOf({ tools: [], disallowedTools: ["Skill"] });
      const handler = vi.fn();
      const result = (await gate(rewritesTo("/ws/.stigmer/skills/guide/SKILL.md"), {}, hidden).wrapToolCall!(read("/notes.md").request, handler)) as ToolMessage;
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).toBe(outOfScopeMessage("read_file", hidden.scope));
    });

    it("runs a rewrite the scope admits, and any rewrite where the graph has no scope", async () => {
      const handler = vi.fn(async (req: ToolCallRequest) => new ToolMessage({ content: String(req.toolCall.args["file_path"]), tool_call_id: "call_1", name: "read_file" }));
      const admitted = (await gate(rewritesTo("/ws/.stigmer/inputs/other.md"), {}, readOnly).wrapToolCall!(read("/.stigmer/inputs/brief.md").request, handler)) as ToolMessage;
      expect(admitted.content).toContain("/.stigmer/inputs/other.md");
      const unscoped = (await gate(rewritesTo("/ws/src/app.ts")).wrapToolCall!(read("/.stigmer/inputs/brief.md").request, handler)) as ToolMessage;
      expect(unscoped.content).toContain("/src/app.ts");
    });
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
