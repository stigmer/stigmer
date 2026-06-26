import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";

afterEach(cleanup);

function makeToolCall(opts: {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  mcpServerSlug?: string;
  status?: ToolCallStatus;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.id ?? opts.name,
    name: opts.name,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    mcpServerSlug: opts.mcpServerSlug ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

/** The row's disclosure toggle is the only element carrying aria-expanded. */
function expanded(container: HTMLElement): boolean {
  return (
    container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ===
    "true"
  );
}

describe("ToolCallItem disclosure", () => {
  it("keeps a settled summary tool collapsed", () => {
    // Delete is a genuine `summary` category — its one-line row (the file) tells
    // the story, so it neither force-opens nor shows a bounded preview.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "delete_file",
          args: { path: "/x.ts" },
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("shows a settled edit as a bounded diff preview", () => {
    // Edit is a `preview` category: a +N -M summary says how much changed, not
    // what — so the diff renders inline (bounded), with "Show more" to the full
    // detail, without force-opening the row.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "StrReplace",
          args: { path: "/x.ts", old_string: "a", new_string: "b" },
          result: '{"status":"success","value":{"linesAdded":1,"linesRemoved":1}}',
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  it("shows a settled preview (MCP) tool as a bounded preview, not force-open", () => {
    // New model: a settled `preview` row is NOT force-expanded. It keeps a
    // bounded ToolCallPreview (aria-expanded stays false) with "Show more" to
    // reach the full detail — so the result stays visible without burying the
    // thread in expanded panels.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "send_message",
          mcpServerSlug: "acme/slack",
          result: '{"ok":true}',
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    const showMore = screen.getByText("Show more");
    expect(showMore).toBeTruthy();

    // "Show more" promotes the row to full detail via its own toggle.
    fireEvent.click(showMore);
    expect(expanded(container)).toBe(true);
  });

  it("keeps a settled shell tool's output as a bounded preview", () => {
    // Shell is a `preview` category: its output IS the information, so a settled
    // shell row persists a bounded preview of stdout with a "Show more" affordance.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "echo hello" },
          result: "hello",
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  it("foregrounds a running tool regardless of category", () => {
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "sleep 5" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(expanded(container)).toBe(true);
  });

  it("settles a summary tool closed once it finishes running", () => {
    // The row, not just the hook, must recompute `autoOpen` from the new
    // ToolCall on re-render: a running `summary` tool foregrounds while live,
    // then collapses to its compact summary the moment it completes (the user
    // never touched it). Proves the React.memo + useAutoDisclosure composition.
    // Delete is a summary category (unlike edit, which now previews its diff).
    const { container, rerender } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-del",
          name: "delete_file",
          args: { path: "/x.ts" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(expanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-del",
          name: "delete_file",
          args: { path: "/x.ts" },
          status: ToolCallStatus.TOOL_CALL_COMPLETED,
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("settles a running shell tool to a bounded preview", () => {
    // A running shell force-opens full detail; on completion it settles to the
    // persistent bounded preview (not force-open, but not hidden either).
    const { container, rerender } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-shell",
          name: "Shell",
          args: { command: "echo hello" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(expanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-shell",
          name: "Shell",
          args: { command: "echo hello" },
          result: "hello",
          status: ToolCallStatus.TOOL_CALL_COMPLETED,
        })}
      />,
    );
    expect(expanded(container)).toBe(false);
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  it("foregrounds a gated tool and renders its approval actions inline", () => {
    const tc = makeToolCall({
      id: "tc-gated",
      name: "delete_file",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-gated",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-gated", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    expect(expanded(container)).toBe(true);
    // The inline body's actions are present right on the gated row.
    expect(screen.getByLabelText("Approve")).toBeTruthy();
    expect(screen.getByLabelText("Approve all file deletions")).toBeTruthy();
  });

  it("renders as its own bordered card by default, with a divider-row fallback when nested", () => {
    const tc = makeToolCall({ name: "Shell", args: { command: "echo hi" }, result: "hi" });

    const { container, rerender } = render(<ToolCallItem toolCall={tc} />);
    let row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("rounded-lg");
    // A visible line (prominent token), not the near-invisible 14% default.
    // NOTE: this asserts only that the markup REQUESTS the border. happy-dom does
    // not resolve `@layer`, so it cannot prove the border actually renders — that
    // (the cascade-layer ordering) is guarded by styles-border-layer-invariant
    // (host compile) and tool-card-ux.spec (real-browser computed style).
    expect(row.className).toContain("border-border-prominent");

    // Nested (e.g. inside a folded run chip): a divider row, never a card.
    rerender(<ToolCallItem toolCall={tc} bordered={false} />);
    row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).not.toContain("rounded-lg");
    expect(row.className).toContain("border-b");
  });

  it("gives a pending gate card a restrained destructive accent (no amber fill)", () => {
    const tc = makeToolCall({
      id: "tc-gated",
      name: "delete_file",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-gated",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-gated", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    // A delete keeps the red accent; the card itself carries it (no amber bg).
    expect(row.className).toContain("border-l-destructive");
    expect(row.className).not.toContain("bg-warning");
  });

  it("routes an inline APPROVE_ALL decision with the gated tool's id", () => {
    // The inline "Approve all ..." escalation must reach the run's submit
    // handler bound to THIS tool call. MessageThread already covers inline
    // APPROVE routing; APPROVE_ALL (the lease escalation) is the untested arm.
    const tc = makeToolCall({
      id: "tc-gated",
      name: "delete_file",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-gated",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
    const onSubmit = vi.fn();
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-gated", approval]]),
      onSubmit,
      submittingIds: new Set(),
    };

    render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    fireEvent.click(screen.getByLabelText("Approve all file deletions"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "tc-gated",
      ApprovalAction.APPROVE_ALL,
      undefined,
    );
  });
});
