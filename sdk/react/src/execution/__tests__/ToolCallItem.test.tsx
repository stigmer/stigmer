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
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  ApprovalAction,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { FileReviewContext } from "../FileReviewContext";

afterEach(cleanup);

function makeToolCall(opts: {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  mcpServerSlug?: string;
  status?: ToolCallStatus;
  fileChangeSetId?: string;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.id ?? opts.name,
    name: opts.name,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    mcpServerSlug: opts.mcpServerSlug ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
    fileChangeSetId: opts.fileChangeSetId ?? "",
  });
}

// The card-level disclosure (header chevron) lives ONLY on summary / sub-agent
// rows: a `div[role="button"]` header inside the row. Preview (content-bearing)
// rows have no such control — their body is always visible — so these helpers
// target that header specifically rather than "any [aria-expanded]" (a block's
// own RevealToggle also carries aria-expanded, on a native <button>, which has
// no role attribute and so is excluded here).
function rowHeaderToggle(container: HTMLElement): Element | null {
  return container.querySelector(
    '[data-cursor-target="tool-call-row"] [role="button"]',
  );
}
function hasHeaderChevron(container: HTMLElement): boolean {
  return rowHeaderToggle(container) != null;
}
function isExpanded(container: HTMLElement): boolean {
  return rowHeaderToggle(container)?.getAttribute("aria-expanded") === "true";
}
function previewBody(container: HTMLElement): Element | null {
  return container.querySelector('[data-cursor-target="tool-preview"]');
}

describe("ToolCallItem disclosure", () => {
  // --- Summary categories keep the chevron ----------------------------------

  it("keeps a settled summary tool collapsed behind a chevron", () => {
    // Delete is a `summary` category — its one-line row (the file) tells the
    // story, so its body stays hidden behind the header chevron.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({ name: "delete_file", args: { path: "/x.ts" } })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  it("settles a summary tool closed once it finishes running", () => {
    // A running summary tool foregrounds while live, then collapses to its
    // compact summary the moment it completes (the user never touched it). The
    // chevron is present throughout. Proves the React.memo + useAutoDisclosure
    // composition recomputes autoOpen from the new ToolCall on re-render.
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
    expect(isExpanded(container)).toBe(true);

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
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
  });

  // --- Interrupted rows (issue #207): settled, neutral, never live -----------

  it("renders an interrupted row settled: collapsed, no spinner, neutral slash icon", () => {
    // A tool call the platform settled to INTERRUPTED when its execution
    // terminalized mid-call. Before #207 a zombie RUNNING row spun forever and
    // force-opened; the settled row must read as finished-by-interruption.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-int",
          name: "delete_file",
          args: { path: "/x.ts" },
          status: ToolCallStatus.TOOL_CALL_INTERRUPTED,
        })}
      />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
  });

  it("collapses a force-opened running row the moment it settles to interrupted", () => {
    // Mirrors the running→completed settle: the server-authored interruption
    // arrives via a status update and the row must release its auto-open.
    const { container, rerender } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-int",
          name: "delete_file",
          args: { path: "/x.ts" },
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(isExpanded(container)).toBe(true);
    expect(container.querySelector(".stg\\:animate-spin")).not.toBeNull();

    rerender(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-int",
          name: "delete_file",
          args: { path: "/x.ts" },
          status: ToolCallStatus.TOOL_CALL_INTERRUPTED,
        })}
      />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(isExpanded(container)).toBe(false);
  });

  // --- Preview categories: no chevron, always-visible body ------------------

  it("renders a settled edit as an always-visible diff with no header chevron", () => {
    // Edit is a `preview` category: the diff IS the information, so it renders
    // inline with no competing card chevron. The diff "Show more" is layout-
    // gated (jsdom computes no layout), so it is asserted in e2e, not here.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "StrReplace",
          args: { path: "/x.ts" },
          result:
            '{"status":"success","value":{"linesAdded":1,"linesRemoved":1,"diffString":"@@ -1 +1 @@\\n-a\\n+b"}}',
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).not.toBeNull();
    // The diff renders as the accessible table.
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("settles a successful shell into a collapsed dimmed tail behind a chevron", () => {
    // Shell is the `tail` category: a settled success collapses to the
    // TerminalTail teaser — the `$ command` line plus the last output lines at
    // reduced contrast — with the header chevron as the expand control.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "echo hello" },
          result: "hello",
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(
      container.querySelector('[data-cursor-target="terminal-tail"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-cursor-target="terminal-session"]'),
    ).toBeNull();
    // The teaser still carries the evidence: intent and last output.
    expect(container.textContent).toContain("$ echo hello");
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("renders a settled MCP tool's result inline with no chevron", () => {
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "send_message",
          mcpServerSlug: "acme/slack",
          result: '{"ok":true}',
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).not.toBeNull();
  });

  it("keeps the shell header minimal — no command subtitle, no exit summary", () => {
    // The command and exit code live in the terminal session body, so the plain
    // header is just icon + label + status + duration. A failed command must not
    // leak its command or "exit N" into the header row.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "ls /secret/abs/path" },
          result: "denied\n[Command failed with exit code 2]",
        })}
      />,
    );
    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    const header = row.firstElementChild!;
    expect(header.textContent).toContain("Shell");
    expect(header.textContent).not.toContain("/secret/abs/path");
    expect(header.textContent).not.toContain("exit 2");
    // The exit DOES surface — in the body's terminal session.
    expect(container.textContent).toContain("exit 2");
  });

  it("streams a running shell's full session in view (force-open, collapsible)", () => {
    // The auto-open-while-running behaviour is untouched by the tail settle:
    // an active command shows its output streaming. The chevron is present —
    // a user may collapse a noisy long-running command, and their choice wins.
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "echo hi" },
          result: "hi",
          status: ToolCallStatus.TOOL_CALL_RUNNING,
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(true);
    expect(
      container.querySelectorAll('[data-cursor-target="terminal-session"]'),
    ).toHaveLength(1);
  });

  // --- Tail settle lifecycle (issue #275) ------------------------------------

  it("collapses a running shell to the dimmed tail the moment it succeeds", () => {
    const running = makeToolCall({
      id: "tc-sh",
      name: "Shell",
      args: { command: "make build" },
      result: "compiling…",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
    });
    const { container, rerender } = render(<ToolCallItem toolCall={running} />);
    expect(isExpanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolCall={makeToolCall({
          id: "tc-sh",
          name: "Shell",
          args: { command: "make build" },
          result: "compiling…\nBUILD OK",
          status: ToolCallStatus.TOOL_CALL_COMPLETED,
        })}
      />,
    );
    expect(isExpanded(container)).toBe(false);
    expect(
      container.querySelector('[data-cursor-target="terminal-tail"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("BUILD OK");
  });

  it("keeps a failed shell open — error output is content, not context", () => {
    // A non-zero exit means the output is what the user needs next; the row
    // must never settle into the dimmed teaser. The exit marker in the result
    // string is the failure signal (status stays COMPLETED on the wire).
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "make build" },
          result: "error: no rule\n[Command failed with exit code 2]",
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(true);
    expect(
      container.querySelector('[data-cursor-target="terminal-session"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("exit 2");
  });

  it("keeps only the last lines in the collapsed tail, with an honest hidden-count", () => {
    const output = ["one", "two", "three", "four", "five"].join("\n");
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "Shell",
          args: { command: "seq 5" },
          result: output,
        })}
      />,
    );
    const tail = container.querySelector('[data-cursor-target="terminal-tail"]')!;
    expect(tail.textContent).toContain("five");
    expect(tail.textContent).toContain("three");
    expect(tail.textContent).not.toContain("one");
    expect(tail.textContent).toContain("+2 lines");
  });

  it("expands a collapsed tail to the full session on click, and the choice sticks", () => {
    const settled = makeToolCall({
      id: "tc-sh2",
      name: "Shell",
      args: { command: "echo hi" },
      result: "hi",
    });
    const { container, rerender } = render(<ToolCallItem toolCall={settled} />);
    expect(isExpanded(container)).toBe(false);

    fireEvent.click(rowHeaderToggle(container)!);
    expect(isExpanded(container)).toBe(true);
    expect(
      container.querySelector('[data-cursor-target="terminal-session"]'),
    ).not.toBeNull();

    // A stream frame re-rendering the same settled call never recollapses a
    // row the user opened (useAutoDisclosure: the manual toggle wins).
    rerender(<ToolCallItem toolCall={settled} />);
    expect(isExpanded(container)).toBe(true);
  });

  it("suppresses the body for a content-bearing tool that produced nothing", () => {
    // The regression guard: a preview-category tool whose result normalizes to
    // `empty` (no output) must stay a clean one-line row, never an empty padded
    // box. (Shell never hits this — it always carries its command line.)
    const { container } = render(
      <ToolCallItem toolCall={makeToolCall({ name: "some_unknown_tool", result: "" })} />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  it("shows the +N -M summary once for an edit — header only, not the diff body", () => {
    // The row header carries the result summary; the always-visible diff body
    // must NOT repeat it. With added != removed the header's combined "+3 -0"
    // node and a body "+3" stat span would be distinguishable — and the body has
    // none (suppressed via showStats={false}).
    const { container } = render(
      <ToolCallItem
        toolCall={makeToolCall({
          name: "StrReplace",
          args: { path: "/x.ts" },
          result:
            '{"status":"success","value":{"linesAdded":3,"linesRemoved":0,"diffString":"@@ -0,0 +1,3 @@\\n+a\\n+b\\n+c"}}',
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(screen.getByText("+3 -0")).toBeTruthy();
    expect(screen.queryAllByText("+3")).toHaveLength(0);
    expect(container.querySelector("table")).not.toBeNull();
  });

  // --- Approvals -------------------------------------------------------------

  it("foregrounds a gated summary tool behind its chevron with inline actions", () => {
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
      errorsByToolCallId: new Map(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(true);
    expect(screen.getByLabelText("Approve")).toBeTruthy();
    expect(screen.getByLabelText("Approve all file deletions")).toBeTruthy();
  });

  it("renders a gated preview tool's actions inline with no chevron", () => {
    // A gated shell (a preview category) shows its decision actions in the
    // always-visible body — no header chevron, since there is nothing to reveal.
    const tc = makeToolCall({
      id: "tc-shell-gated",
      name: "Shell",
      args: { command: "rm -rf /tmp/x" },
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-shell-gated",
      toolName: "Shell",
      argsPreview: '{"command":"rm -rf /tmp/x"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["tc-shell-gated", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
      errorsByToolCallId: new Map(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).not.toBeNull();
    expect(screen.getByLabelText("Approve")).toBeTruthy();
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
      errorsByToolCallId: new Map(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("stg:border-l-destructive");
    expect(row.className).not.toContain("stg:bg-warning");
  });

  it("routes an inline APPROVE_ALL decision with the gated tool's id", () => {
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
      errorsByToolCallId: new Map(),
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

  it("surfaces a keyed approval error in-card on the gated row (the primary route)", () => {
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
      // The error for THIS gate, keyed by its tool call id.
      errorsByToolCallId: new Map([["tc-gated", new Error("gate already resolved")]]),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolCallItem toolCall={tc} />
      </ApprovalContext.Provider>,
    );

    const alert = container.querySelector(
      '[data-cursor-target="approval-error"]',
    );
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("gate already resolved");
  });

  // --- Card chrome -----------------------------------------------------------

  it("renders as its own bordered card by default, with a divider-row fallback when nested", () => {
    const tc = makeToolCall({ name: "Shell", args: { command: "echo hi" }, result: "hi" });

    const { container, rerender } = render(<ToolCallItem toolCall={tc} />);
    let row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("stg:rounded-lg");
    expect(row.className).toContain("stg:border-border-prominent");

    rerender(<ToolCallItem toolCall={tc} bordered={false} />);
    row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).not.toContain("stg:rounded-lg");
    expect(row.className).toContain("stg:border-b");
  });
});

// ---------------------------------------------------------------------------
// File-review badge — a stamped edit row's live review state
// ---------------------------------------------------------------------------

describe("ToolCallItem file-review badge", () => {
  const SET_ID = "aex-1:0";

  function reviewSet(
    status: FileChangeSetStatus,
    decisions: { action: FileDecisionAction }[] = [],
  ): FileChangeSet {
    return create(FileChangeSetSchema, {
      id: SET_ID,
      status,
      changes: [
        create(CapturedFileChangeSchema, {
          id: `${SET_ID}:notes.md`,
          pathBefore: "notes.md",
          pathAfter: "notes.md",
          kind: FileChangeKind.MODIFY,
          diffComplete: true,
        }),
      ],
      decisions: decisions.map((d) =>
        create(FileDecisionSchema, {
          changeSetId: SET_ID,
          scope: FileDecisionScope.CHANGE_SET,
          action: d.action,
        }),
      ),
    });
  }

  function renderStampedRow(set: FileChangeSet) {
    const tc = makeToolCall({
      id: "tc-edit",
      name: "edit",
      args: { path: "notes.md", old_string: "a", new_string: "b" },
      fileChangeSetId: SET_ID,
    });
    return render(
      <FileReviewContext.Provider value={{ changeSetsById: new Map([[SET_ID, set]]) }}>
        <ToolCallItem toolCall={tc} />
      </FileReviewContext.Provider>,
    );
  }

  function badge(container: HTMLElement): Element | null {
    return container.querySelector('[data-cursor-target="file-review-row-badge"]');
  }

  it("badges a stamped row 'Pending review' while its set awaits review", () => {
    const { container } = renderStampedRow(reviewSet(FileChangeSetStatus.AWAITING_REVIEW));
    expect(badge(container)?.textContent).toBe("Pending review");
  });

  it("flips the badge to the file's verdict once the set is decided", () => {
    const kept = renderStampedRow(
      reviewSet(FileChangeSetStatus.RECONCILED, [{ action: FileDecisionAction.APPROVE }]),
    );
    expect(badge(kept.container)?.textContent).toBe("Kept");
    cleanup();

    const discarded = renderStampedRow(
      reviewSet(FileChangeSetStatus.RECONCILED, [{ action: FileDecisionAction.REJECT }]),
    );
    expect(badge(discarded.container)?.textContent).toBe("Discarded");
  });

  it("shows no badge for an unstamped row or without a provider", () => {
    // Unstamped (a plain edit outside capture mode) — provider present.
    const unstamped = makeToolCall({
      id: "tc-plain",
      name: "edit",
      args: { path: "notes.md", old_string: "a", new_string: "b" },
    });
    const withProvider = render(
      <FileReviewContext.Provider
        value={{ changeSetsById: new Map([[SET_ID, reviewSet(FileChangeSetStatus.AWAITING_REVIEW)]]) }}
      >
        <ToolCallItem toolCall={unstamped} />
      </FileReviewContext.Provider>,
    );
    expect(badge(withProvider.container)).toBeNull();
    cleanup();

    // Stamped but no provider (a consumer without file review) — no badge.
    const stamped = makeToolCall({
      id: "tc-edit",
      name: "edit",
      args: { path: "notes.md", old_string: "a", new_string: "b" },
      fileChangeSetId: SET_ID,
    });
    const bare = render(<ToolCallItem toolCall={stamped} />);
    expect(badge(bare.container)).toBeNull();
  });
});
