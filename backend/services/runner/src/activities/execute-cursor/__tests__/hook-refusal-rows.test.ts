/**
 * Pins the turn boundary's settle of calls the hook layer refused before
 * they ran (`boundary-rows.ts` `stampHookRefusedToolCalls`, ledger kind
 * `hook`): each entry settles the first row of its call (the exact identity,
 * its coarse identity, then the workspace-normalized path), in the turn's
 * messages or a sub-agent this turn started; the row is FAILED with the very
 * text the model read, names the hook that refused, and names none for a
 * person's earlier refusal; an earlier turn's row, a row that ran, and an
 * entry with no refusal text are left alone.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import { ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema, type ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import { SubAgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/subagent_pb";
import { describe, expect, it } from "vitest";
import { contentToken, grantToken, type DeniedLedgerEntry } from "../approval-state.js";
import { stampHookRefusedToolCalls } from "../boundary-rows.js";

const BLOCKED = "Blocked by a hook";

const row = (id: string, name: string, args: JsonObject, status = ToolCallStatus.TOOL_CALL_FAILED): ToolCall =>
  create(ToolCallSchema, { id, name, args, status, error: status === ToolCallStatus.TOOL_CALL_FAILED ? BLOCKED : "" });

const message = (...toolCalls: ToolCall[]) => create(AgentMessageSchema, { toolCalls });

describe("stampHookRefusedToolCalls", () => {
  it("settles each refused call's row with the model's text, naming the hook that refused or none for a person", () => {
    const shell = row("c-shell", "shell", { command: "rm -rf x" });
    const edit = row("c-edit", "edit", { path: "/w/a.txt", old_string: "a", new_string: "b" });
    const read = row("c-read", "read", { path: "notes.md" }, ToolCallStatus.TOOL_CALL_RUNNING);
    const inSubAgent = row("c-sub", "shell", { command: "curl x" });
    const ran = row("c-ran", "shell", { command: "ls" }, ToolCallStatus.TOOL_CALL_COMPLETED);
    const listing = row("c-ls", "ls", { path: "src" });
    const earlier = row("c-earlier", "shell", { command: "rm -rf x" });
    const ledger: DeniedLedgerEntry[] = [
      { toolName: "Shell", token: grantToken("shell", "rm -rf x"), kind: "hook", message: "no deletes", hook: "safety" },
      // The hook's Write carried the whole new file: the edit row matches by its coarse identity.
      { toolName: "Write", token: contentToken("write", "/w/a.txt", "d1g"), kind: "hook", message: "rejected by you", },
      // The hook saw an absolute path; the stream spelled it relatively.
      { toolName: "Read", token: grantToken("Read", "/w/notes.md"), kind: "hook", message: "no reading notes", hook: "" },
      { toolName: "Shell", token: grantToken("shell", "curl x"), kind: "hook", message: "no network", hook: "net" },
      // The hook's List is the stream's `ls`, its path spelled relatively there.
      { toolName: "List", token: grantToken("List", "/w/src"), kind: "hook", message: "no listing src", hook: "safety" },
      { toolName: "Shell", token: grantToken("shell", "ls"), kind: "hook", message: "would not match a ran row", hook: "x" },
      { toolName: "Shell", token: grantToken("shell", "whoami"), kind: "hook" },
      { toolName: "Shell", token: grantToken("shell", "rm -rf x"), kind: "approval", hook: "safety" },
    ];
    const messages = [message(earlier), message(shell, edit, read, ran, listing), message(row("c-task", "task", {}, ToolCallStatus.TOOL_CALL_COMPLETED))];
    const subAgents = [create(SubAgentRunSchema, { id: "c-task", messages: [message(inSubAgent)] })];

    expect(stampHookRefusedToolCalls(messages, subAgents, ledger, 1, "/w")).toBe(5);
    expect([listing.error, listing.approvalPolicyHook]).toEqual(["no listing src", "safety"]);
    expect([shell.status, shell.error, shell.approvalPolicySource, shell.approvalPolicyHook]).toEqual([
      ToolCallStatus.TOOL_CALL_FAILED, "no deletes", ApprovalPolicySource.HOOK, "safety",
    ]);
    expect(shell.policyEngineVersion).not.toBe("");
    expect([edit.error, edit.approvalPolicySource, edit.approvalPolicyHook, edit.policyEngineVersion]).toEqual([
      "rejected by you", ApprovalPolicySource.UNSPECIFIED, "", "",
    ]);
    expect([read.status, read.error, read.approvalPolicyHook, read.requiresApproval]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, "no reading notes", "", false]);
    expect(read.completedAt).not.toBe("");
    expect([inSubAgent.error, inSubAgent.approvalPolicyHook]).toEqual(["no network", "net"]);
    expect([ran.status, earlier.error], "a row that ran, and an earlier turn's, stay as they are").toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, BLOCKED]);
  });

  it("settles nothing without a refusal that carries its text", () => {
    const shell = row("c-shell", "shell", { command: "rm -rf x" });
    expect(stampHookRefusedToolCalls([message(shell)], [], [{ toolName: "Shell", token: grantToken("shell", "rm -rf x"), kind: "hook" }], 0)).toBe(0);
    expect(shell.error).toBe(BLOCKED);
  });
});
