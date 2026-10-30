// Pins ToolCallItem over the session fold's tool uses: the four disclosure
// modes (summary, preview, tail, subagent), the density tier, the status
// vocabulary read from `ToolUse.state`, duration chips from the use and
// result times, the inline decision for a waiting call (ApprovalContext), the
// Approved/Denied answer badge, and the file-review badge a file-edit row
// reads from its turn's review by path.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { FileReviewSet, ToolUse } from "@stigmer/client";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { FileReviewContext } from "@stigmer/react-core";
import { reviewFile, reviewSet, thread, toolUse } from "./__fixtures__/fold-values";

afterEach(cleanup);

function answering(onAnswer: ApprovalContextValue["onAnswer"] = () => {}, errors: ReadonlyMap<string, Error> = new Map()): ApprovalContextValue {
  return { onAnswer, submittingIds: new Set(), errorsByToolUseId: errors };
}

// The card-level disclosure (header chevron) lives ONLY on summary / subagent
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
        toolUse={toolUse({ name: "delete_file", input: { path: "/x.ts" } })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  it("shows a loaded skill as the skill it loaded, on a quiet line", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "Skill", input: { skill: "acme:lint" } })} />,
    );
    const row = container.querySelector('[data-cursor-target="tool-call-row"]');
    expect(row?.textContent).toContain("Use skill");
    expect(row?.textContent).toContain("acme:lint");
    expect(row?.querySelector("svg")).not.toBeNull();
  });

  it("settles a summary tool closed once it finishes running", () => {
    // A running summary tool foregrounds while live, then collapses to its
    // compact summary the moment it completes (the user never touched it). The
    // chevron is present throughout. Proves the React.memo + useAutoDisclosure
    // composition recomputes autoOpen from the new ToolCall on re-render.
    const { container, rerender } = render(
      <ToolCallItem
        toolUse={toolUse({
          id: "tc-del",
          name: "delete_file",
          input: { path: "/x.ts" },
          state: "running",
        })}
      />,
    );
    expect(isExpanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolUse={toolUse({
          id: "tc-del",
          name: "delete_file",
          input: { path: "/x.ts" },
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
  });

  // --- Interrupted rows (issue #207): settled, neutral, never live -----------

  it("renders an interrupted row settled: collapsed, no spinner, neutral slash icon", () => {
    // A tool call the platform settled to INTERRUPTED when its run
    // terminalized mid-call. Before #207 a zombie RUNNING row spun forever and
    // force-opened; the settled row must read as finished-by-interruption.
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          id: "tc-int",
          name: "delete_file",
          input: { path: "/x.ts" },
          state: "stopped",
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
        toolUse={toolUse({
          id: "tc-int",
          name: "delete_file",
          input: { path: "/x.ts" },
          state: "running",
        })}
      />,
    );
    expect(isExpanded(container)).toBe(true);
    expect(container.querySelector(".stg\\:animate-spin")).not.toBeNull();

    rerender(
      <ToolCallItem
        toolUse={toolUse({
          id: "tc-int",
          name: "delete_file",
          input: { path: "/x.ts" },
          state: "stopped",
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
        toolUse={toolUse({
          name: "Edit",
          input: { file_path: "/x.ts", old_string: "a", new_string: "b" },
          result: "The file /x.ts has been updated successfully.",
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
        toolUse={toolUse({
          name: "Bash",
          input: { command: "echo hello" },
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
        toolUse={toolUse({
          name: "send_message",
          mcpServerName: "acme/slack",
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
        toolUse={toolUse({
          name: "Bash",
          input: { command: "ls /secret/abs/path" },
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
        toolUse={toolUse({
          name: "Bash",
          input: { command: "echo hi" },
          result: "hi",
          state: "running",
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
    const running = toolUse({
      id: "tc-sh",
      name: "Bash",
      input: { command: "make build" },
      result: "compiling…",
      state: "running",
    });
    const { container, rerender } = render(<ToolCallItem toolUse={running} />);
    expect(isExpanded(container)).toBe(true);

    rerender(
      <ToolCallItem
        toolUse={toolUse({
          id: "tc-sh",
          name: "Bash",
          input: { command: "make build" },
          result: "compiling…\nBUILD OK",
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
        toolUse={toolUse({
          name: "Bash",
          input: { command: "make build" },
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
        toolUse={toolUse({
          name: "Bash",
          input: { command: "seq 5" },
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
    const settled = toolUse({
      id: "tc-sh2",
      name: "Bash",
      input: { command: "echo hi" },
      result: "hi",
    });
    const { container, rerender } = render(<ToolCallItem toolUse={settled} />);
    expect(isExpanded(container)).toBe(false);

    fireEvent.click(rowHeaderToggle(container)!);
    expect(isExpanded(container)).toBe(true);
    expect(
      container.querySelector('[data-cursor-target="terminal-session"]'),
    ).not.toBeNull();

    // A stream frame re-rendering the same settled call never recollapses a
    // row the user opened (useAutoDisclosure: the manual toggle wins).
    rerender(<ToolCallItem toolUse={settled} />);
    expect(isExpanded(container)).toBe(true);
  });

  it("suppresses the body for a content-bearing tool that produced nothing", () => {
    // The regression guard: a preview-category tool whose result normalizes to
    // `empty` (no output) must stay a clean one-line row, never an empty padded
    // box. (Shell never hits this — it always carries its command line.)
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "some_unknown_tool", result: "" })} />,
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
        toolUse={toolUse({
          name: "Edit",
          input: { file_path: "/x.ts", old_string: "x\n", new_string: "x\na\nb\nc\n" },
          result: "The file /x.ts has been updated successfully.",
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(screen.getByText("+3 -0")).toBeTruthy();
    expect(screen.queryAllByText("+3")).toHaveLength(0);
    expect(container.querySelector("table")).not.toBeNull();
  });

  // --- Waiting calls (asks) ---------------------------------------------------

  it("foregrounds a waiting summary tool behind its chevron with inline actions", () => {
    const tu = toolUse({
      id: "tc-gated",
      name: "delete_file",
      ask: { argsPreview: '{"path":"/tmp/x"}' },
    });
    const { container } = render(
      <ApprovalContext.Provider value={answering()}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(true);
    expect(screen.getByLabelText("Approve")).toBeTruthy();
    expect(screen.getByLabelText("Approve all file deletions")).toBeTruthy();
  });

  it("shows no decision UI on a waiting call when no answer handler is wired", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: {} });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    expect(screen.queryByLabelText("Approve")).toBeNull();
    // The waiting call still reads as waiting: the clock, in the warning tone.
    expect(container.querySelector(".stg\\:text-warning")).not.toBeNull();
  });

  it("renders a waiting preview tool's actions inline with no chevron", () => {
    // A waiting shell (a preview category) shows its decision actions in the
    // always-visible body — no header chevron, since there is nothing to reveal.
    const tu = toolUse({
      id: "tc-shell-gated",
      name: "Bash",
      input: { command: "rm -rf /tmp/x" },
      ask: { argsPreview: '{"command":"rm -rf /tmp/x"}' },
    });
    const { container } = render(
      <ApprovalContext.Provider value={answering()}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).not.toBeNull();
    expect(screen.getByLabelText("Approve")).toBeTruthy();
  });

  it("gives a waiting gate card a restrained destructive accent (no amber fill)", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
    const { container } = render(
      <ApprovalContext.Provider value={answering()}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("stg:border-l-destructive");
    expect(row.className).not.toContain("stg:bg-warning");
  });

  it("shows a waiting write's whole proposed content from the call's input, never the preview's elision marker (stigmer#1107)", () => {
    // The tool use holds the whole input; the ask's `argsPreview` is the
    // runner's sanitized summary and cannot carry a file of any real size.
    const big = Array.from({ length: 30 }, (_, i) => `gate line ${i + 1}`).join("\n") + "\n";
    const tu = toolUse({
      id: "tc-big-write",
      name: "write_file",
      input: { file_path: "/tmp/e2e-big-gate.txt", content: big },
      ask: { argsPreview: '{"file_path":"/tmp/e2e-big-gate.txt","content":"[381 chars]"}' },
    });
    const { container } = render(
      <ApprovalContext.Provider value={answering()}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.textContent).toContain("gate line 1");
    expect(row.textContent).not.toContain("gate line 30"); // bounded by lines
    expect(row.textContent).not.toContain("[381 chars]");
    expect(screen.getByRole("button", { name: /Show all \d+ lines/ })).toBeTruthy();
    expect(screen.getByLabelText("Approve")).toBeTruthy();
  });

  it("routes an inline grant with the waiting tool use's id", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
    const onAnswer = vi.fn();
    render(
      <ApprovalContext.Provider value={answering(onAnswer)}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    fireEvent.click(screen.getByLabelText("Approve all file deletions"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("tc-gated", "grant", undefined);
  });

  it("surfaces a keyed answer error in-card on the waiting row (the primary route)", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
    const { container } = render(
      <ApprovalContext.Provider
        value={answering(() => {}, new Map([["tc-gated", new Error("gate already resolved")]]))}
      >
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    const alert = container.querySelector('[data-cursor-target="approval-error"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("gate already resolved");
  });

  // --- How a person answered -------------------------------------------------

  function answerBadge(container: HTMLElement): string | null {
    const label = [...container.querySelectorAll("span")].find(
      (el) => el.textContent === "Approved" || el.textContent === "Denied",
    );
    return label?.textContent ?? null;
  }

  it("badges an asked call Approved once allowed, or once a grant was given on it", () => {
    const allowed = render(
      <ToolCallItem
        toolUse={toolUse({ name: "delete_file", ask: {}, confirmation: "allow", result: "ok" })}
      />,
    );
    expect(answerBadge(allowed.container)).toBe("Approved");
    cleanup();

    const granted = render(
      <ToolCallItem toolUse={toolUse({ name: "delete_file", ask: {}, grant: {}, result: "ok" })} />,
    );
    expect(answerBadge(granted.container)).toBe("Approved");
  });

  it("badges a denied call Denied and settles it quietly — no status icon", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "delete_file", ask: {}, confirmation: "deny" })} />,
    );
    expect(answerBadge(container)).toBe("Denied");
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(container.querySelector(".stg\\:text-success")).toBeNull();
  });

  it("shows no answer badge on a call that never asked, or still waits", () => {
    const plain = render(<ToolCallItem toolUse={toolUse({ name: "delete_file", result: "ok" })} />);
    expect(answerBadge(plain.container)).toBeNull();
    cleanup();

    const waiting = render(<ToolCallItem toolUse={toolUse({ name: "delete_file", ask: {} })} />);
    expect(answerBadge(waiting.container)).toBeNull();
  });

  // --- Subagent rows --------------------------------------------------------

  it("titles a task row with what it asked its subagent, and nests the thread in its body", () => {
    const tu = toolUse({
      name: "task",
      input: { description: "Survey the docs" },
      thread: thread({ agentName: "researcher", input: "Find every page", state: "completed" }),
      result: "done",
    });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    expect(container.textContent).toContain("Survey the docs");
    fireEvent.click(rowHeaderToggle(container)!);
    expect(container.textContent).toContain("Find every page");
  });

  it("falls back to the subagent's name when the task call carries no description", () => {
    const tu = toolUse({ name: "task", thread: thread({ agentName: "researcher" }) });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    expect(rowRoot(container).textContent).toContain("researcher");
  });

  it("shows an MCP tool's server beside its title", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "send_message", mcpServerName: "acme-slack", result: "{}" })} />,
    );
    expect(rowRoot(container).textContent).toContain("acme-slack");
  });

  // --- Card chrome -----------------------------------------------------------

  it("renders as its own bordered card by default, with a divider-row fallback when nested", () => {
    const tc = toolUse({ name: "Bash", input: { command: "echo hi" }, result: "hi" });

    const { container, rerender } = render(<ToolCallItem toolUse={tc} />);
    let row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).toContain("stg:rounded-lg");
    expect(row.className).toContain("stg:border-border-prominent");

    rerender(<ToolCallItem toolUse={tc} bordered={false} />);
    row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    expect(row.className).not.toContain("stg:rounded-lg");
    expect(row.className).toContain("stg:border-b");
  });
});

// ---------------------------------------------------------------------------
// Density tier — quiet unboxed lines for metadata-only rows (stigmer#274)
// ---------------------------------------------------------------------------

function rowRoot(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-cursor-target="tool-call-row"]')!;
}
function isQuietLine(container: HTMLElement): boolean {
  const cls = rowRoot(container).className;
  return !cls.includes("stg:rounded-lg") && !cls.includes("stg:border-b");
}

describe("ToolCallItem density tier", () => {
  it("renders metadata-only rows as quiet unboxed lines (read / list / search / think)", () => {
    const cases: ToolUse[] = [
      toolUse({ name: "Read", input: { path: "/a.ts" } }),
      toolUse({ name: "ls", input: { path: "/src" } }),
      toolUse({ name: "Grep", input: { pattern: "foo" }, result: "2 matches" }),
      toolUse({ name: "think", input: { thought: "considering options" } }),
    ];
    for (const tc of cases) {
      const { container, unmount } = render(<ToolCallItem toolUse={tc} />);
      expect(isQuietLine(container), `${tc.name} should be a quiet line`).toBe(true);
      unmount();
    }
  });

  it("keeps content-bearing rows as cards (shell / edit)", () => {
    const cases: ToolUse[] = [
      toolUse({ name: "Bash", input: { command: "echo hi" }, result: "hi" }),
      toolUse({
        name: "Edit",
        input: { file_path: "/a.ts", old_string: "a", new_string: "b" },
      }),
    ];
    for (const tc of cases) {
      const { container, unmount } = render(<ToolCallItem toolUse={tc} />);
      expect(rowRoot(container).className, `${tc.name} should stay a card`).toContain(
        "stg:border-border-prominent",
      );
      unmount();
    }
  });

  it("escalates a quiet row to a card when it fails — error output is content", () => {
    const failed = toolUse({
      name: "Read",
      input: { path: "/a.ts" },
      isError: true,
      result: '{"status":"error","message":"permission denied"}',
    });
    const { container } = render(<ToolCallItem toolUse={failed} />);
    expect(rowRoot(container).className).toContain("stg:border-border-prominent");
  });

  it("escalates a quiet row to a card while it waits — a decision surface is never frameless", () => {
    const gated = toolUse({
      id: "tc-read-gated",
      name: "Read",
      input: { path: "/secret" },
      ask: { argsPreview: '{"path":"/secret"}' },
    });
    const { container } = render(
      <ApprovalContext.Provider value={answering()}>
        <ToolCallItem toolUse={gated} />
      </ApprovalContext.Provider>,
    );
    const cls = rowRoot(container).className;
    expect(cls).toContain("stg:border-border-prominent");
    expect(cls).toContain("stg:border-l-warning");
  });

  it("stays a quiet line while running — the in-flight state rides the label, not a frame", () => {
    const running = toolUse({
      name: "Read",
      input: { path: "/a.ts" },
      state: "running",
    });
    const { container } = render(<ToolCallItem toolUse={running} />);
    expect(isQuietLine(container)).toBe(true);
    expect(container.querySelector(".stg\\:animate-spin")).not.toBeNull();
  });

  it("sweeps the running label with the ambient-liveness shimmer, settled labels stay static", () => {
    const running = toolUse({
      name: "Bash",
      input: { command: "sleep 5" },
      state: "running",
    });
    const { container, rerender } = render(<ToolCallItem toolUse={running} />);
    expect(container.querySelector(".stgm-shimmer-label")?.textContent).toBe("Shell");

    const settled = toolUse({
      name: "Bash",
      input: { command: "sleep 5" },
      result: "done",
    });
    rerender(<ToolCallItem toolUse={settled} />);
    expect(container.querySelector(".stgm-shimmer-label")).toBeNull();
  });

  it("contains a quiet row's disclosed body under a left rail instead of a border", () => {
    // Grep is a summary category with a real result body: expanding the quiet
    // line must bound the body with the rail (the ThinkingMessage precedent),
    // never leave it bleeding into the thread.
    const tc = toolUse({
      name: "Grep",
      input: { pattern: "foo" },
      result: "src/a.ts:1: foo",
    });
    const { container } = render(<ToolCallItem toolUse={tc} />);
    fireEvent.click(rowHeaderToggle(container)!);
    expect(container.querySelector(".stg\\:border-l-2")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status vocabulary — success is silent, everything visible carries signal
// ---------------------------------------------------------------------------

describe("ToolCallItem status vocabulary", () => {
  it("renders no status icon on a completed row — success is the silent default", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({ name: "Bash", input: { command: "echo hi" }, result: "hi" })}
      />,
    );
    expect(container.querySelector(".stg\\:text-success")).toBeNull();
  });

  it("keeps the failed icon — failure shouts", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "Bash",
          input: { command: "false" },
          isError: true,
        })}
      />,
    );
    expect(container.querySelector(".stg\\:text-destructive")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Duration chips — shown only when they carry information (>= 1s)
// ---------------------------------------------------------------------------

describe("ToolCallItem duration chip", () => {
  it("suppresses a sub-second duration — the chip would be noise", () => {
    const tc = toolUse({
      name: "Read",
      input: { path: "/a.ts" },
      result: "contents",
      durationMs: 400,
    });
    render(<ToolCallItem toolUse={tc} />);
    expect(screen.queryByText("400ms")).toBeNull();
  });

  it("shows a duration of a second or more — it carries information", () => {
    const tc = toolUse({
      name: "Bash",
      input: { command: "sleep 2" },
      result: "",
      durationMs: 2_500,
    });
    render(<ToolCallItem toolUse={tc} />);
    expect(screen.getByText("2.5s")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// File-review badge — a stamped edit row's live review state
// ---------------------------------------------------------------------------

describe("ToolCallItem file-review badge", () => {
  function renderEditRow(set: FileReviewSet, row: ToolUse = editRow()) {
    return render(
      <FileReviewContext.Provider
        value={{ fileReviewByRunId: new Map([["run_1", [set]]]), changeSetsById: new Map() }}
      >
        <ToolCallItem toolUse={row} />
      </FileReviewContext.Provider>,
    );
  }

  function editRow(path = "/workspace/notes.md"): ToolUse {
    return toolUse({ id: "tc-edit", name: "edit", input: { path, old_string: "a", new_string: "b" }, result: "ok" });
  }

  function setWith(state: "undecided" | "kept" | "undoing" | "undone" | "undo_failed"): FileReviewSet {
    return reviewSet({ files: [reviewFile({ path: "notes.md", state })] });
  }

  function badge(container: HTMLElement): Element | null {
    return container.querySelector('[data-cursor-target="file-review-row-badge"]');
  }

  it("badges an edit row 'Pending review' while its file is undecided", () => {
    const { container } = renderEditRow(setWith("undecided"));
    expect(badge(container)?.textContent).toBe("Pending review");
  });

  it("flips the badge to the file's state once it is decided", () => {
    const cases = [
      ["kept", "Kept"],
      ["undoing", "Discarded"],
      ["undone", "Discarded"],
      ["undo_failed", "Review failed"],
    ] as const;
    for (const [state, label] of cases) {
      const { container, unmount } = renderEditRow(setWith(state));
      expect(badge(container)?.textContent, state).toBe(label);
      unmount();
    }
  });

  it("shows no badge for a file the review does not hold, a row that edits no file, or without a provider", () => {
    const otherFile = renderEditRow(setWith("undecided"), editRow("/workspace/other.md"));
    expect(badge(otherFile.container)).toBeNull();
    cleanup();

    // A read of the same path is not an edit: it never carries the badge.
    const read = renderEditRow(
      setWith("undecided"),
      toolUse({ name: "Read", input: { path: "/workspace/notes.md" }, result: "x" }),
    );
    expect(badge(read.container)).toBeNull();
    cleanup();

    const bare = render(<ToolCallItem toolUse={editRow()} />);
    expect(badge(bare.container)).toBeNull();
  });
});
