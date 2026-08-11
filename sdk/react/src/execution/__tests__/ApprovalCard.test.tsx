import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind } from "@stigmer/sdk";
import { ApprovalCard } from "../ApprovalCard";

// Under apply-then-review the deny-gate carries no captured `file_changes`
// (message.proto field 14 was removed in Phase 5 Slice 4); the gate renders the
// proposed change from the tool args. Captured file review renders via
// FileReviewCard, tested separately.

afterEach(cleanup);

const noop = () => {};

// ---------------------------------------------------------------------------
// Tool classification (ToolArgsView fallback path)
// ---------------------------------------------------------------------------

describe("ApprovalCard chrome", () => {
  it("renders neutral Cursor-style chrome with a restrained warning accent (no amber fill)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-chrome",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/x.ts","contents":"x"}',
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    const card = screen.getByRole("alert");
    // Visible neutral line + a restrained 2px warning left accent — never the
    // old amber background fill. (Class presence only; that the line actually
    // RENDERS is proven by the layer-invariant + e2e computed-style guards —
    // happy-dom cannot resolve `@layer`.)
    expect(card.className).toContain("stg:border-border-prominent");
    expect(card.className).toContain("stg:border-l-warning");
    expect(card.className).not.toContain("stg:bg-warning");
  });

  it("keeps a destructive red accent for a delete approval (hard safety signal)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-chrome-del",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    const card = screen.getByRole("alert");
    expect(card.className).toContain("stg:border-l-destructive");
    expect(card.className).not.toContain("stg:bg-destructive-subtle");
  });

  it("shows a shell gate's command in the body terminal session, once, not in the header", () => {
    // The command is decision-relevant, so it leads the body's terminal session
    // (`$ npm test`) — but the header stays minimal and does not restate it, so
    // the command appears exactly once on the card.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-shell-gate",
      toolName: "shell",
      toolKind: ToolKind.SHELL,
      argsPreview: '{"command":"npm test"}',
    });

    const { container } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    const session = container.querySelector(
      '[data-cursor-target="terminal-session"]',
    );
    expect(session).toBeTruthy();
    expect(session!.textContent).toContain("$ npm test");

    const occurrences = (container.textContent!.match(/npm test/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("states on a shell gate that the command's files are covered by the approval (DD-28)", () => {
    // Consent at grant time: approving the command covers its file effects
    // (the approved-command auto-keep), so the card says so up front — the user
    // never discovers a second gate they weren't told about, nor gets one.
    const shellApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-shell-note",
      toolName: "shell",
      toolKind: ToolKind.SHELL,
      argsPreview: '{"command":"seq 1 5000 > big.txt"}',
    });
    render(<ApprovalCard pendingApproval={shellApproval} onSubmit={noop} />);
    expect(screen.getByText(/kept automatically, with no second review/)).toBeTruthy();
  });

  it("never shows the auto-keep note on a non-shell gate", () => {
    // A file edit's review model is the FileChangeSet, not the command consent —
    // the note would be false there.
    const editApproval = create(PendingApprovalSchema, {
      toolCallId: "tc-edit-no-note",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/x.ts","contents":"x"}',
    });
    render(<ApprovalCard pendingApproval={editApproval} onSubmit={noop} />);
    expect(screen.queryByText(/kept automatically/)).toBeNull();
  });
});

describe("ApprovalCard quiet decision buttons", () => {
  // Class-contract assertions (happy-dom can't resolve `@layer`); the RENDERED
  // quiet treatment is proven by the e2e computed-style guard in
  // tool-card-ux.spec.ts. The shared treatment itself lives in DecisionButton.
  function renderGate() {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-quiet",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/x.ts","contents":"x"}',
    });
    return render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);
  }

  it("Approve is the neutral chip, never the loud success green", () => {
    renderGate();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve.className).toContain("stg:bg-accent");
    expect(approve.className).toContain("border");
    expect(approve.className).not.toContain("stg:bg-success");
  });

  it("Skip and Reject are quiet ghosts with no resting fill", () => {
    renderGate();
    const skip = screen.getByRole("button", { name: "Skip" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(skip.className).toContain("stg:text-muted-foreground");
    expect(skip.className).not.toMatch(/(?:^|\s)bg-/); // hover-only wash, no rest fill
    // Reject reveals its danger affordance on hover/focus, not as a red fill.
    expect(reject.className).toContain("stg:hover:text-destructive");
    expect(reject.className).not.toMatch(/(?:^|\s)bg-/);
    expect(reject.className).not.toContain("stg:bg-destructive stg:text-destructive-foreground");
  });

  it("demotes Approve-all to the far right (ml-auto) at the lowest weight", () => {
    renderGate();
    const approveAll = screen.getByRole("button", { name: "Approve all file edits" });
    expect(approveAll.className).toContain("stg:ml-auto");
    expect(approveAll.className).toContain("stg:text-muted-foreground");
  });

  it("uses no `bg-token/NN` opacity modifiers on any decision button", () => {
    renderGate();
    for (const name of ["Approve", "Skip", "Reject", "Approve all file edits"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.className).not.toMatch(/\/\d+(?:\s|$)/);
    }
  });
});

describe("ApprovalCard tool classification", () => {
  it("honors the denormalized wire tool_kind for a name not in the fallback map", () => {
    // A future/unknown tool name that the name-based resolver cannot classify —
    // only the server-projected tool_kind can. This proves the backend
    // denormalization (Go + Java PendingApproval projection) is consumed.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc1",
      toolName: "SomeFutureEditTool",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: "{}",
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    // FILE_EDIT presentation label, not a humanized tool name.
    expect(getByText("Edit")).toBeTruthy();
  });

  it("falls back to name-based classification when tool_kind is unset (legacy)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc2",
      toolName: "delete_file",
      // toolKind left UNSPECIFIED — legacy execution.
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("Delete")).toBeTruthy();
  });
});

describe("ApprovalCard why-gated provenance", () => {
  it("renders the why-gated line from the projected approval_policy_source", () => {
    // The server projects approval_policy_source onto PendingApproval so the card
    // can explain the gate before any decision. AGENT_OVERRIDE → the agent forced
    // this tool to require approval.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-why",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
      approvalPolicySource: ApprovalPolicySource.AGENT_OVERRIDE,
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("required by agent override")).toBeTruthy();
  });

  it("renders no why-gated line for a legacy approval (UNSPECIFIED source)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-why-legacy",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
      // approvalPolicySource left UNSPECIFIED — legacy execution.
    });

    const { queryByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(queryByText(/required by/)).toBeNull();
  });

  it("smart-suppresses the everyday default gate reason (built-in tool policy)", () => {
    // The boring default explains nothing the user does not already infer from
    // the tool — it is noise, so the card hides it.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-why-default",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
      approvalPolicySource: ApprovalPolicySource.BUILTIN_CATEGORY,
    });

    const { queryByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(queryByText(/required by/)).toBeNull();
  });

  it("surfaces an informative gate reason (destructive tighten)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-why-destructive",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
      approvalPolicySource: ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN,
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("required: marked destructive by the server")).toBeTruthy();
  });
});

describe("ApprovalCard message redundancy", () => {
  it("suppresses a file tool's message that only restates the header", () => {
    // "Write file: <path>" duplicates the header + diff — the card drops it.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-msg-file",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      message: "Write file: src/x.ts",
      argsPreview: '{"path":"src/x.ts","contents":"x"}',
    });

    const { queryByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(queryByText("Write file: src/x.ts")).toBeNull();
  });

  it("keeps a non-file tool's informative message (e.g. an MCP prompt)", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-msg-mcp",
      toolName: "create_issue",
      mcpServerSlug: "github",
      message: "Create an issue in acme/repo titled 'Bug'",
      argsPreview: "{}",
    });

    const { getByText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("Create an issue in acme/repo titled 'Bug'")).toBeTruthy();
  });
});

describe("ApprovalCard approve-all action", () => {
  it("renders the subordinate scope-truthful approve-all action", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc3",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByText, getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
    );

    expect(getByText("Approve")).toBeTruthy();
    // The label names the leased class (delete), never an unbounded "all".
    expect(getByLabelText("Approve all file deletions")).toBeTruthy();
  });

  it("labels the approve-all action by the clicked tool's lease scope", () => {
    // delete -> "file deletions"; write/edit collapse to "file edits";
    // shell -> "shell commands"; an MCP tool -> "<server> tools".
    const cases: ReadonlyArray<{
      toolName: string;
      mcpServerSlug?: string;
      expected: string;
    }> = [
      { toolName: "delete_file", expected: "Approve all file deletions" },
      { toolName: "write_file", expected: "Approve all file edits" },
      { toolName: "edit_file", expected: "Approve all file edits" },
      { toolName: "shell", expected: "Approve all shell commands" },
      {
        toolName: "create_issue",
        mcpServerSlug: "github",
        expected: "Approve all github tools",
      },
    ];

    for (const { toolName, mcpServerSlug, expected } of cases) {
      const approval = create(PendingApprovalSchema, {
        toolCallId: `tc-${toolName}`,
        toolName,
        mcpServerSlug: mcpServerSlug ?? "",
        argsPreview: "{}",
      });
      const { getByLabelText, unmount } = render(
        <ApprovalCard pendingApproval={approval} onSubmit={noop} />,
      );
      expect(getByLabelText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("submits APPROVE_ALL when the subordinate action is clicked", () => {
    const onSubmit = vi.fn();
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc4",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={onSubmit} />,
    );

    fireEvent.click(getByLabelText("Approve all file deletions"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE_ALL);
  });

  it("submits a plain APPROVE when the primary action is clicked", () => {
    const onSubmit = vi.fn();
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc5",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });

    const { getByLabelText } = render(
      <ApprovalCard pendingApproval={approval} onSubmit={onSubmit} />,
    );

    fireEvent.click(getByLabelText("Approve"));

    expect(onSubmit).toHaveBeenCalledWith(ApprovalAction.APPROVE);
  });
});

// ---------------------------------------------------------------------------
// Deny-gate preview from tool args (apply-then-review: no captured file_changes)
// ---------------------------------------------------------------------------

describe("ApprovalCard file-change preview", () => {
  it("shows the proposed content (filename only in the header) when the args carry content", () => {
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-fallback",
      toolName: "write_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"src/fallback.ts","contents":"x"}',
      // fileChanges intentionally empty.
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    // The write content still shows via the "Content" collapsible...
    expect(screen.getByText("Content")).toBeTruthy();
    // ...but the filename is shown exactly once (the header) — the body no
    // longer restates the path the header already shows.
    expect(screen.getAllByText("fallback.ts")).toHaveLength(1);
    expect(screen.queryByText(/binary file changed/i)).toBeNull();
  });

  it("shows a neutral 'no preview' notice for a path-only edit gate (the resume placeholder)", () => {
    // The irreducible case: a ledger denial whose only known arg is the path
    // (no streamed content, no capture). The body must not restate the bare
    // filename nor misrepresent it as an empty file.
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-no-preview",
      toolName: "edit_file",
      toolKind: ToolKind.FILE_EDIT,
      argsPreview: '{"path":"notes.md"}',
      // fileChanges intentionally empty; no content in args.
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText("No preview available for this change")).toBeTruthy();
    // Filename once — header only.
    expect(screen.getAllByText("notes.md")).toHaveLength(1);
  });

  it("shows a 'new file' notice (not 'no preview') for a content-less FILE_WRITE create gate", () => {
    // The rare residual after the runner's correlation fix: a whole-file write
    // gate that carries only its path (no captured content/diff — a no-stream
    // synthesis). FILE_WRITE is modeled as a create throughout the runner, so the
    // authoritative toolKind lets the gate say plainly that a new file is being
    // written rather than the misleading non-committal "No preview available".
    const approval = create(PendingApprovalSchema, {
      toolCallId: "tc-new-file",
      toolName: "write_file",
      toolKind: ToolKind.FILE_WRITE,
      argsPreview: '{"path":"notes.md"}',
      // fileChanges intentionally empty; no content in args.
    });

    render(<ApprovalCard pendingApproval={approval} onSubmit={noop} />);

    expect(screen.getByText("New file — preview unavailable")).toBeTruthy();
    expect(screen.queryByText("No preview available for this change")).toBeNull();
    // Filename once — header only.
    expect(screen.getAllByText("notes.md")).toHaveLength(1);
  });
});

describe("ApprovalCard in-card decision error", () => {
  function makeApproval() {
    return create(PendingApprovalSchema, {
      toolCallId: "tc-err",
      toolName: "delete_file",
      argsPreview: '{"path":"/tmp/x"}',
    });
  }

  it("surfaces a failed decision in-card, beside the actions (not via a banner)", () => {
    const { container } = render(
      <ApprovalCard
        pendingApproval={makeApproval()}
        onSubmit={noop}
        error={new Error("gate already resolved")}
      />,
    );

    const alert = container.querySelector(
      '[data-cursor-target="approval-error"]',
    );
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("gate already resolved");
    // The shared notice announces itself.
    expect(alert!.getAttribute("role")).toBe("alert");
  });

  it("shows no in-card error when healthy", () => {
    const { container } = render(
      <ApprovalCard pendingApproval={makeApproval()} onSubmit={noop} />,
    );
    expect(
      container.querySelector('[data-cursor-target="approval-error"]'),
    ).toBeNull();
  });
});
