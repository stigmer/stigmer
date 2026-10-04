/**
 * A call the agent's tool lists refuse reaches the timeline as it does on the
 * native engine: one FAILED row whose error is the refusal the model read
 * (`outOfScopeMessage`), no approval, no provenance, and never an
 * unattributed hook block (#205) that would fail the turn.
 *
 * End to end at unit scale: the REAL generated hook refuses the call and
 * writes the ledger; the runner reads that ledger (`readDenialLedger`); the
 * streamed rows come from the real translator and builder (`CursorFold`), so
 * they carry Cursor's generic hook-block text and the provenance the
 * translator stamped at tool start. Then the boundary's two passes run in
 * their production order: `stampScopeRefusedToolCalls`, then
 * `detectUnattributedHookBlocks`. Pinned for a built-in, an MCP tool (keyed by
 * server and tool), and an engine extra whose hook name and stream name
 * differ, on the root transcript and inside a sub-agent's; and, for a tool
 * the lists exclude only in part (`Agent(type, …)`, a confined `Read`), that
 * only the call the refusal names is settled, never an allowed call of the
 * same tool still in flight, and never an earlier turn's row.
 */

import { describe, expect, it } from "vitest";
import { ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolScope, outOfScopeMessage, type ToolLists } from "../../../shared/tool-lists.js";
import type { McpApprovalDefault } from "../../../shared/approval-policy.js";
import { grantToken, readDenialLedger } from "../approval-state.js";
import { detectUnattributedHookBlocks, stampScopeRefusedToolCalls } from "../boundary-rows.js";
import { CursorFold } from "../__test-utils__/fold.js";
import { sdkEvents } from "../__test-utils__/scripted-agent.js";
import {
  hasBash,
  hookBuiltin,
  hookMcp,
  hookShell,
  hookSubagentStart,
  setupCursorHookHarness,
} from "../__test-utils__/cursor-hook-harness.js";
import { join } from "node:path";

const d = hasBash ? describe : describe.skip;
const ev = sdkEvents("agent-1", "run-1");
/** Cursor's generic text on a hook-blocked call (`HOOK_BLOCK_ERROR_MARKERS`). */
const HOOK_BLOCK = "Tool call blocked by a hook.";
/** The owner name the hook harness compiles its lists under. */
const OWNER = 'Agent "test"';

d("tool-list refusals on the timeline", () => {
  it("a refused built-in and a refused MCP tool become FAILED rows carrying the refusal the model read, with no provenance", async () => {
    const lists: ToolLists = { tools: ["Read", "mcp__srv__list_apps"], disallowedTools: [] };
    const h = setupCursorHookHarness({
      lists,
      mcpServers: [{ slug: "srv", discoveredToolNames: ["list_apps", "click"] }],
    });
    const shellHook = h.decide(hookShell("rm -rf build"));
    const mcpHook = h.decide(hookMcp("click", { app: "Slack" }));
    expect([shellHook.permission, mcpHook.permission]).toEqual(["deny", "deny"]);

    // The translator stamps the approval default's provenance at tool start:
    // builtin_category for the shell, the annotation for a destructive tool.
    const mcpDefault: McpApprovalDefault = { destructive: new Set(["srv/click"]), leasedServers: new Set() };
    const mcpArgs = { providerIdentifier: "srv", toolName: "click", args: { app: "Slack" } };
    const fold = new CursorFold({ mcpDefault }).events(
      ev.toolCall("s1", "shell", "running", { command: "rm -rf build" }),
      ev.toolCall("s1", "shell", "error", { command: "rm -rf build" }, HOOK_BLOCK),
      ev.toolCall("m1", "mcp", "running", mcpArgs),
      ev.toolCall("m1", "mcp", "error", mcpArgs, HOOK_BLOCK),
    );
    expect(fold.row("s1").approvalPolicySource).toBe(ApprovalPolicySource.BUILTIN_CATEGORY);
    expect(fold.row("m1").approvalPolicySource).toBe(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN);

    const ledger = await readDenialLedger(h.hitlDir);
    const { messages, subAgentExecutions } = fold.status;
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(2);

    const scope = ToolScope.of(OWNER, lists);
    for (const [id, label, hookRaw] of [
      ["s1", "Shell", shellHook.raw],
      ["m1", "click", mcpHook.raw],
    ] as const) {
      const row = fold.row(id);
      expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(row.error).toBe(outOfScopeMessage(label, scope));
      expect(row.error, "the very words the model read").toBe(JSON.parse(hookRaw).agent_message);
      expect(row.requiresApproval).toBe(false);
      expect(row.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
      expect(row.policyEngineVersion).toBe("");
    }
    expect(detectUnattributedHookBlocks(messages, 0, ledger)).toEqual([]);
  });

  it("an engine extra refused under an allow-list, on the root and inside a sub-agent, is a refused call and never an unattributed block", async () => {
    const lists: ToolLists = { tools: ["Read", "Agent"], disallowedTools: [] };
    const h = setupCursorHookHarness({ lists });
    // The hook knows the tool by a name its table lacks; the stream by another.
    const hookRes = h.decide(hookBuiltin("GenerateImage", { prompt: "a cat" }));
    expect(hookRes.permission).toBe("deny");

    const taskArgs = { subagentType: "helper", description: "Draw", prompt: "Draw a cat." };
    const taskResult = {
      conversationSteps: [
        {
          toolCall: {
            toolCallId: "sub-gen-1",
            generateImageToolCall: { args: { prompt: "a cat" }, result: { error: HOOK_BLOCK } },
          },
        },
      ],
    };
    const fold = new CursorFold().events(
      ev.toolCall("g1", "generateImage", "running", { prompt: "a cat" }),
      ev.toolCall("g1", "generateImage", "error", { prompt: "a cat" }, HOOK_BLOCK),
      ev.toolCall("t1", "task", "running", taskArgs),
      ev.toolCall("t1", "task", "completed", taskArgs, taskResult),
    );
    const { messages, subAgentExecutions } = fold.status;
    const ledger = await readDenialLedger(h.hitlDir);

    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(2);
    const expected = outOfScopeMessage("GenerateImage", ToolScope.of(OWNER, lists));
    const subRow = subAgentExecutions[0].messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === "sub-gen-1")!;
    for (const row of [fold.row("g1"), subRow]) {
      expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(row.error).toBe(expected);
    }
    expect(detectUnattributedHookBlocks(messages, 0, ledger)).toEqual([]);
  });

  it("a call still RUNNING at the boundary is settled too; a hook-blocked call of a tool no refusal names is not", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Read"], disallowedTools: [] } });
    expect(h.decide(hookShell("ls")).permission).toBe("deny");
    const fold = new CursorFold().events(
      // The stream never reported the refused shell's end.
      ev.toolCall("s1", "shell", "running", { command: "ls" }),
      // A grep blocked by some other hook: our ledger refused no grep.
      ev.toolCall("g1", "grep", "running", { pattern: "x" }),
      ev.toolCall("g1", "grep", "error", { pattern: "x" }, HOOK_BLOCK),
    );
    expect(fold.row("s1").completedAt).toBe("");
    const { messages, subAgentExecutions } = fold.status;
    const ledger = await readDenialLedger(h.hitlDir);
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(1);
    expect(fold.row("s1").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(fold.row("s1").error).toContain("Shell is not available to this agent");
    expect(fold.row("s1").isStreaming).toBe(false);
    expect(fold.row("s1").completedAt, "a settled row is complete").not.toBe("");
    expect(fold.row("g1").error).toBe(HOOK_BLOCK);
    expect(detectUnattributedHookBlocks(messages, 0, ledger).map((b) => b.toolCallId)).toEqual(["g1"]);
  });

  it("a refused sub-agent type settles only its own task row, never an allowed type's task still running", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Read", "Agent(explore)"], disallowedTools: [] } });
    expect(h.decide(hookSubagentStart("generalPurpose")).permission).toBe("deny");
    const explore = { subagentType: "explore", description: "Look", prompt: "Look around." };
    const general = { subagentType: "generalPurpose", description: "Do", prompt: "Do it." };
    const fold = new CursorFold().events(
      ev.toolCall("t-explore", "task", "running", explore),
      ev.toolCall("t-general", "task", "running", general),
      ev.toolCall("t-general", "task", "error", general, HOOK_BLOCK),
    );
    const { messages, subAgentExecutions } = fold.status;
    const ledger = await readDenialLedger(h.hitlDir);
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(1);
    expect(fold.row("t-general").error).toContain("Agent(generalPurpose) is not available to this agent");
    expect(fold.row("t-explore").status, "the allowed sub-agent is still running").toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(fold.row("t-explore").error).toBe("");
  });

  it("a Task refused at preToolUse by its subagent_type settles its own task row, never an allowed type's", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Read", "Agent(explore)"], disallowedTools: [] } });
    expect(h.decide(hookBuiltin("Task", { subagent_type: "generalPurpose", prompt: "Do it." })).permission).toBe("deny");
    const explore = { subagentType: "explore", description: "Look", prompt: "Look around." };
    const general = { subagentType: "generalPurpose", description: "Do", prompt: "Do it." };
    const fold = new CursorFold().events(
      ev.toolCall("t-explore", "task", "running", explore),
      ev.toolCall("t-general", "task", "running", general),
      ev.toolCall("t-general", "task", "error", general, HOOK_BLOCK),
    );
    const { messages, subAgentExecutions } = fold.status;
    const ledger = await readDenialLedger(h.hitlDir);
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(1);
    expect(fold.row("t-general").error).toContain("Agent(generalPurpose) is not available to this agent");
    expect(fold.row("t-explore").status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(detectUnattributedHookBlocks(messages, 0, ledger, h.root)).toEqual([]);
  });

  it("a refused Read settles only the read it names, matched across absolute and relative spellings; an allowed .stigmer/ read in flight stays", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Grep"], disallowedTools: [] } });
    expect(h.decide(hookBuiltin("Read", { file_path: join(h.root, "src/main.ts") })).permission).toBe("deny");
    const fold = new CursorFold().events(
      // The stream names the refused file relative to the workspace.
      ev.toolCall("r-out", "read", "running", { path: "src/main.ts" }),
      ev.toolCall("r-out", "read", "error", { path: "src/main.ts" }, HOOK_BLOCK),
      ev.toolCall("r-skill", "read", "running", { path: ".stigmer/skills/a/SKILL.md" }),
    );
    const { messages, subAgentExecutions } = fold.status;
    const ledger = await readDenialLedger(h.hitlDir);
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0, h.root)).toBe(1);
    expect(fold.row("r-out").error).toContain("Read is not available to this agent");
    expect(fold.row("r-skill").status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    // Without the workspace to normalize against, the spellings never meet.
    const again = new CursorFold().events(
      ev.toolCall("r-out", "read", "running", { path: "src/main.ts" }),
      ev.toolCall("r-out", "read", "error", { path: "src/main.ts" }, HOOK_BLOCK),
    );
    expect(stampScopeRefusedToolCalls(again.status.messages, [], ledger, 0)).toBe(0);
    expect(detectUnattributedHookBlocks(messages, 0, ledger, h.root)).toEqual([]);
  });

  it("only this turn's rows and this turn's sub-agents are settled", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Read", "Agent"], disallowedTools: [] } });
    expect(h.decide(hookShell("ls")).permission).toBe("deny");
    expect(h.decide(hookBuiltin("GenerateImage", { prompt: "a cat" })).permission).toBe("deny");
    const taskArgs = { subagentType: "helper", description: "Draw", prompt: "Draw." };
    const blob = {
      conversationSteps: [
        { toolCall: { toolCallId: "old-sub-gen", generateImageToolCall: { args: { prompt: "a cat" }, result: { error: HOOK_BLOCK } } } },
      ],
    };
    const fold = new CursorFold().events(
      // An earlier turn: a shell left running and a sub-agent's blocked call.
      ev.assistant("Earlier turn."),
      ev.toolCall("old-shell", "shell", "running", { command: "ls" }),
      ev.toolCall("old-task", "task", "running", taskArgs),
      ev.toolCall("old-task", "task", "completed", taskArgs, blob),
      ev.assistant("This turn."),
      ev.toolCall("new-shell", "shell", "running", { command: "ls" }),
    );
    const { messages, subAgentExecutions } = fold.status;
    const turnStart = messages.findIndex((m) => m.content === "This turn.");
    expect(turnStart).toBeGreaterThan(0);
    const ledger = await readDenialLedger(h.hitlDir);
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, turnStart, h.root)).toBe(1);
    expect(fold.row("new-shell").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(fold.row("old-shell").status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    const oldSub = subAgentExecutions[0].messages.flatMap((m) => m.toolCalls)[0];
    expect(oldSub.error).toBe(HOOK_BLOCK);
  });

  it("a disabled entry that is not a scope token, or does not decode, rewrites nothing", () => {
    const mcpArgs = { providerIdentifier: "srv", toolName: "click", args: {} };
    const fold = new CursorFold().events(
      ev.toolCall("m1", "mcp", "running", mcpArgs),
      ev.toolCall("m1", "mcp", "error", mcpArgs, HOOK_BLOCK),
    );
    const ledger = [
      // An MCP name token, as an approval denial carries: no scope prefix.
      { toolName: "click", token: grantToken("click", ""), kind: "disabled", message: "refused" },
      // No newline once decoded: not an identity token at all.
      { toolName: "click", token: "bm90LWEtdG9rZW4=", kind: "disabled", message: "refused" },
    ];
    const { messages, subAgentExecutions } = fold.status;
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger, 0)).toBe(0);
    expect(fold.row("m1").error).toBe(HOOK_BLOCK);
  });

  it("a row that failed for its own reason is left alone, even for a tool the lists confine", async () => {
    const h = setupCursorHookHarness({ lists: { tools: ["Grep"], disallowedTools: [] } });
    expect(h.decide(hookBuiltin("Read", { file_path: "/outside/secret.txt" })).permission).toBe("deny");
    const fold = new CursorFold().events(
      ev.toolCall("r1", "read", "running", { path: "/outside/secret.txt" }),
      ev.toolCall("r1", "read", "error", { path: "/outside/secret.txt" }, HOOK_BLOCK),
      ev.toolCall("r2", "read", "running", { path: ".stigmer/skills/a/SKILL.md" }),
      ev.toolCall("r2", "read", "error", { path: ".stigmer/skills/a/SKILL.md" }, "ENOENT: no such file"),
    );
    const { messages, subAgentExecutions } = fold.status;
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, await readDenialLedger(h.hitlDir), 0, h.root)).toBe(1);
    expect(fold.row("r1").error).toContain("Read is not available to this agent");
    expect(fold.row("r2").error).toBe("ENOENT: no such file");
  });
});
