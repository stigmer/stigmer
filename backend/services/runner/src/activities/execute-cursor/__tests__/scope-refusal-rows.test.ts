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
 * differ, on the root transcript and inside a sub-agent's.
 */

import { describe, expect, it } from "vitest";
import { ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolScope, outOfScopeMessage, type ToolLists } from "../../../shared/tool-lists.js";
import type { McpApprovalDefault } from "../../../shared/approval-policy.js";
import { readDenialLedger } from "../approval-state.js";
import { detectUnattributedHookBlocks, stampScopeRefusedToolCalls } from "../boundary-rows.js";
import { CursorFold } from "../__test-utils__/fold.js";
import { sdkEvents } from "../__test-utils__/scripted-agent.js";
import { hasBash, hookBuiltin, hookMcp, hookShell, setupCursorHookHarness } from "../__test-utils__/cursor-hook-harness.js";

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
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger)).toBe(2);

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

    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger)).toBe(2);
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
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, ledger)).toBe(1);
    expect(fold.row("s1").status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(fold.row("s1").error).toContain("Shell is not available to this agent");
    expect(fold.row("s1").isStreaming).toBe(false);
    expect(fold.row("s1").completedAt, "a settled row is complete").not.toBe("");
    expect(fold.row("g1").error).toBe(HOOK_BLOCK);
    expect(detectUnattributedHookBlocks(messages, 0, ledger).map((b) => b.toolCallId)).toEqual(["g1"]);
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
    expect(stampScopeRefusedToolCalls(messages, subAgentExecutions, await readDenialLedger(h.hitlDir))).toBe(1);
    expect(fold.row("r1").error).toContain("Read is not available to this agent");
    expect(fold.row("r2").error).toBe("ENOENT: no such file");
  });
});
