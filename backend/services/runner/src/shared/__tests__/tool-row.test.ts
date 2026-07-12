/**
 * Unit tests for the shared tool-row file-review presentation helpers:
 * `stampFileEditRow` (the observational-row stamp both harnesses apply to
 * flowed file edits) and `hideToolCallRow`/`isToolCallRowHidden` (the collapse
 * shape kept for denial twins and legacy pre-stamping sessions).
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  collectSettledToolCallIds,
  collectSubAgentToolCallIds,
  hideToolCallRow,
  isToolCallRowHidden,
  stampFileEditRow,
  withholdSecretContentFromMessages,
  withholdSecretFileContent,
} from "../tool-row.js";

describe("stampFileEditRow", () => {
  it("stamps additively: content, status, and identity all survive", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '{"status":"completed","value":{"diffString":"+hi","linesAdded":1}}',
      argsPreview: '{"path":"src/app.ts"}',
      args: { path: "src/app.ts", old_string: "a", new_string: "b" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    // The row is an observational record: everything the streamed card rendered
    // from stays in place (the diff renders from result/args, never argsPreview).
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.args).toEqual({ path: "src/app.ts", old_string: "a", new_string: "b" });
    expect(tc.result).toContain("diffString");
    expect(tc.argsPreview).toBe('{"path":"src/app.ts"}');
  });

  it("never overwrites an existing stamp (the cross-turn mis-attribution guard)", () => {
    // A resume seeds prior turns' rows into the transcript; the turn-boundary
    // pass re-walks all of them. The stamp must be first-writer-wins or turn N
    // would claim turn N-1's rows.
    const tc = create(ToolCallSchema, {
      id: "tc-old",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "notes.md", content: "x" },
      fileChangeSetId: "exec-1:0",
    });

    stampFileEditRow(tc, "exec-1:1");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
  });

  it("withholds content for a secret-like TRACKED path but keeps the path visible (DD-12 D4)", () => {
    // The hook denies secret-like gitignored writes before they flow, but a
    // committed credentials file is outside its scope — the stamp is the last
    // line of defense against persisting its bytes in the transcript.
    const tc = create(ToolCallSchema, {
      id: "tc-secret",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "wrote credentials.json",
      argsPreview: '{"path":"config/credentials.json"}',
      args: { path: "config/credentials.json", content: "TOKEN=super-secret" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    expect(tc.args).toEqual({ path: "config/credentials.json" }); // path only, no body
    expect(tc.result).toBe("");
    expect(tc.argsPreview).toBe("");
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED); // still visible
  });

  it("fail-closes when the path cannot be determined: content withheld", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-weird",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "ok",
      args: { unrecognized_shape: "payload" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    expect(tc.args).toBeUndefined();
    expect(tc.result).toBe("");
  });
});

describe("withholdSecretFileContent", () => {
  it("reduces a secret-like row's args to { path } and clears args_preview, keeping result", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "Tool 'write' was blocked for security: '.env' matches a secret-like path. Nothing was written.",
      argsPreview: '{"path":".env"}',
      args: { path: ".env", content: "API_KEY=super-secret" },
    });

    expect(withholdSecretFileContent(tc)).toBe(true);
    expect(tc.args).toEqual({ path: ".env" });
    expect(tc.argsPreview).toBe("");
    // result is left intact — the deny-gate uses it for the safe "blocked" message.
    expect(tc.result).toContain("blocked for security");
  });

  it("leaves a non-secret row untouched and returns false", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-2",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: '{"path":"src/app.ts"}',
      args: { path: "src/app.ts", content: "console.log('hi')" },
    });

    expect(withholdSecretFileContent(tc)).toBe(false);
    expect(tc.args).toEqual({ path: "src/app.ts", content: "console.log('hi')" });
    expect(tc.argsPreview).toBe('{"path":"src/app.ts"}');
  });

  it("fail-closes when the path cannot be determined (args → undefined)", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-3",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { unrecognized_shape: "payload" },
    });

    expect(withholdSecretFileContent(tc)).toBe(true);
    expect(tc.args).toBeUndefined();
  });
});

describe("withholdSecretContentFromMessages", () => {
  function writeRow(id: string, path: string, content = "SECRET_BODY"): ReturnType<typeof create<typeof ToolCallSchema>> {
    return create(ToolCallSchema, {
      id,
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      argsPreview: JSON.stringify({ path }),
      args: { path, content },
    });
  }

  it("withholds content from a secret write row but leaves a non-secret one intact", () => {
    const msg = create(AgentMessageSchema, {
      type: 1,
      toolCalls: [writeRow("tc-secret", ".env"), writeRow("tc-ok", "src/app.ts")],
    });

    withholdSecretContentFromMessages([msg]);

    expect(msg.toolCalls[0].args).toEqual({ path: ".env" });
    expect(msg.toolCalls[0].argsPreview).toBe("");
    expect(msg.toolCalls[1].args).toEqual({ path: "src/app.ts", content: "SECRET_BODY" });
  });

  it("covers edit-family rows (category write) too", () => {
    const editRow = create(ToolCallSchema, {
      id: "tc-edit",
      name: "StrReplace",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: ".ssh/id_rsa", old_string: "a", new_string: "b" },
    });
    const msg = create(AgentMessageSchema, { type: 1, toolCalls: [editRow] });

    withholdSecretContentFromMessages([msg]);

    expect(editRow.args).toEqual({ path: ".ssh/id_rsa" });
  });

  it("does NOT touch a delete row (deletes carry no content)", () => {
    const deleteRow = create(ToolCallSchema, {
      id: "tc-del",
      name: "delete",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: ".env" },
    });
    const msg = create(AgentMessageSchema, { type: 1, toolCalls: [deleteRow] });

    withholdSecretContentFromMessages([msg]);

    // A delete's args are path-only already; the write-scoped pass leaves it alone.
    expect(deleteRow.args).toEqual({ path: ".env" });
  });

  it("walks sub-agent transcripts", () => {
    const topMsg = create(AgentMessageSchema, { type: 1, toolCalls: [writeRow("tc-top", "notes.md")] });
    const sa = create(SubAgentExecutionSchema, {
      id: "sa-1",
      messages: [create(AgentMessageSchema, { type: 1, toolCalls: [writeRow("tc-sa", "credentials.json")] })],
    });

    withholdSecretContentFromMessages([topMsg], [sa]);

    expect(topMsg.toolCalls[0].args).toEqual({ path: "notes.md", content: "SECRET_BODY" }); // non-secret untouched
    expect(sa.messages[0].toolCalls[0].args).toEqual({ path: "credentials.json" }); // sub-agent secret scrubbed
  });

  it("is idempotent and agrees with stampFileEditRow's content-less shape", () => {
    const row = writeRow("tc-secret", ".env");
    const msg = create(AgentMessageSchema, { type: 1, toolCalls: [row] });

    withholdSecretContentFromMessages([msg]);
    const afterFirst = { args: row.args, argsPreview: row.argsPreview };
    withholdSecretContentFromMessages([msg]);
    expect(row.args).toEqual(afterFirst.args);
    expect(row.argsPreview).toBe(afterFirst.argsPreview);

    // stampFileEditRow on the already-scrubbed row yields the same content-less shape.
    stampFileEditRow(row, "exec-1:0");
    expect(row.args).toEqual({ path: ".env" });
    expect(row.argsPreview).toBe("");
  });
});

describe("hideToolCallRow", () => {
  it("collapses a completed file-edit row to the hidden shape", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "wrote file",
      argsPreview: "path=src/app.ts",
      args: { file_path: "src/app.ts", content: "console.log('hi')" },
      requiresApproval: true,
      approvalMessage: "Write file",
    });

    hideToolCallRow(tc);

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.requiresApproval).toBe(false);
    expect(tc.result).toBe("");
    expect(tc.error).toBe("");
    expect(tc.argsPreview).toBe("");
    expect(tc.approvalMessage).toBe("");
    expect(tc.completedAt).not.toBe("");
    // Identity is preserved (append-only): id + name survive the collapse.
    expect(tc.id).toBe("tc-1");
    expect(tc.name).toBe("write");
  });

  it("scrubs args so a hidden row carries no content (design doc 12, D4)", () => {
    // A file-mutating tool's args hold the full write body. For a secret-like
    // path this content would otherwise persist into the transcript / Temporal
    // history, defeating the never-persist-secret-contents contract. The hidden
    // row is redundant with the file_change_set, so args must be dropped.
    const tc = create(ToolCallSchema, {
      id: "tc-secret",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { file_path: ".env", content: "API_KEY=super-secret-value" },
    });

    hideToolCallRow(tc);

    expect(tc.args).toBeUndefined();
    expect(isToolCallRowHidden(tc)).toBe(true);
  });

  it("is idempotent", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "ok",
    });
    hideToolCallRow(tc);
    const firstCompletedAt = tc.completedAt;
    hideToolCallRow(tc);
    expect(isToolCallRowHidden(tc)).toBe(true);
    expect(tc.completedAt).toBe(firstCompletedAt); // not overwritten
  });
});

describe("isToolCallRowHidden", () => {
  it("recognizes a hidden row", () => {
    const tc = create(ToolCallSchema, { id: "x", name: "write", status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "y" });
    expect(isToolCallRowHidden(tc)).toBe(false);
    hideToolCallRow(tc);
    expect(isToolCallRowHidden(tc)).toBe(true);
  });

  it("does not treat a live WAITING_APPROVAL row as hidden", () => {
    const tc = create(ToolCallSchema, {
      id: "x",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
    });
    expect(isToolCallRowHidden(tc)).toBe(false);
  });

  it("does not treat a SKIPPED row with lingering args as hidden", () => {
    // A row collapsed by an older code path may still carry args; the predicate
    // must report it as not-yet-hidden so it gets re-scrubbed rather than skipped.
    const tc = create(ToolCallSchema, {
      id: "x",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
      args: { file_path: ".env", content: "leftover" },
    });
    expect(isToolCallRowHidden(tc)).toBe(false);
  });
});

describe("collectSubAgentToolCallIds", () => {
  function subAgent(id: string, ...toolCallIds: string[]) {
    return create(SubAgentExecutionSchema, {
      id,
      messages: [
        create(AgentMessageSchema, {
          type: 1, // MESSAGE_AI
          toolCalls: toolCallIds.map((tcId) =>
            create(ToolCallSchema, { id: tcId, name: "edit" }),
          ),
        }),
      ],
    });
  }

  it("returns an empty set for no sub-agents", () => {
    expect(collectSubAgentToolCallIds([]).size).toBe(0);
  });

  it("flattens tool-call ids across sub-agents and messages", () => {
    const ids = collectSubAgentToolCallIds([
      subAgent("sa-1", "tc-a", "tc-b"),
      subAgent("sa-2", "tc-c"),
    ]);
    expect([...ids].sort()).toEqual(["tc-a", "tc-b", "tc-c"]);
  });

  it("collects ids across multiple messages of one sub-agent", () => {
    const sa = create(SubAgentExecutionSchema, {
      id: "sa-1",
      messages: [
        create(AgentMessageSchema, { type: 1, toolCalls: [create(ToolCallSchema, { id: "tc-a", name: "edit" })] }),
        create(AgentMessageSchema, { type: 1, toolCalls: [create(ToolCallSchema, { id: "tc-b", name: "write" })] }),
      ],
    });
    expect([...collectSubAgentToolCallIds([sa]).values()].sort()).toEqual(["tc-a", "tc-b"]);
  });
});

describe("collectSettledToolCallIds", () => {
  function msgWith(id: string, status: ToolCallStatus) {
    return create(AgentMessageSchema, {
      type: 1, // MESSAGE_AI
      toolCalls: [create(ToolCallSchema, { id, name: "Shell", status })],
    });
  }

  it("collects every terminal status and skips every live one", () => {
    const ids = collectSettledToolCallIds([
      msgWith("tc-completed", ToolCallStatus.TOOL_CALL_COMPLETED),
      msgWith("tc-failed", ToolCallStatus.TOOL_CALL_FAILED),
      msgWith("tc-skipped", ToolCallStatus.TOOL_CALL_SKIPPED),
      msgWith("tc-pending", ToolCallStatus.TOOL_CALL_PENDING),
      msgWith("tc-running", ToolCallStatus.TOOL_CALL_RUNNING),
      msgWith("tc-gated", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL),
    ]);
    expect([...ids].sort()).toEqual(["tc-completed", "tc-failed", "tc-skipped"]);
  });

  it("treats a server-settled INTERRUPTED row as settled (recovery provenance scoping)", () => {
    // A FAILED-then-recovered execution seeds INTERRUPTED rows from the prior
    // invocation. For turn-boundary provenance those are PRIOR-turn history —
    // scoping them as this-turn would mis-attribute a dead call to the
    // resuming turn's change set. (The Cursor monotonic guard makes the
    // opposite call for the same status so a replayed event can still advance
    // the row; see isTerminalToolStatus in message-translator.ts.)
    const ids = collectSettledToolCallIds([
      msgWith("tc-interrupted", ToolCallStatus.TOOL_CALL_INTERRUPTED),
    ]);
    expect(ids.has("tc-interrupted")).toBe(true);
  });
});
