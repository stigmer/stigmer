// Pins ToolCallItem over the session fold's tool uses: every step is one
// line in plain words (`stepPhrase`, or a host presenter's label), at body
// size, with its file linked in the line, its counts beside it (+N −M for a
// change, an exit badge, matches or items found) and its folder, command or
// first argument; a settled step closed behind a chevron that opens in place
// to its body, a step with nothing to show a static line with no chevron;
// auto-open while it runs with something to show, while it waits for a
// person (ApprovalContext) and for a failed command; a command that exited
// non-zero marked failed though the engine did not, a denied call not; the
// preview layout a host asks for per kind; the density tier, the status
// vocabulary read from `ToolUse.state`, duration chips from the use and
// result times, the Approved/Denied answer badge, a task row's helper tag
// and its pill only once the helper failed or stopped, the file-review badge a
// file-edit row reads from its turn's review by path ("Undone" or "Couldn't
// undo"; nothing for an undecided or kept file), and the header's
// controls: one toggle laid over the row, named for what the row is and
// carrying a cut-off detail's full text, with the file control a sibling
// that acts without toggling.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileReviewSet, ToolUse } from "@stigmer/client";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { registerToolPresenter } from "../tool-presenter";
import { FileReviewContext } from "@stigmer/react-core";
import { reviewFile, reviewSet, thread, toolUse, TOOL_STARTED_AT } from "./__fixtures__/fold-values";
import { tagClasses } from "../../internal/surface/Tag";
import { samples } from "../../test";

afterEach(cleanup);

function answering(onAnswer: ApprovalContextValue["onAnswer"] = () => {}, errors: ReadonlyMap<string, Error> = new Map()): ApprovalContextValue {
  return { onAnswer, submittingIds: new Set(), errorsByToolUseId: errors };
}

// The card-level disclosure (header chevron) lives on every step with a body
// to open, except a preview step whose body is always in view. These helpers
// target the toggle by its hook rather than "any [aria-expanded]" (a block's
// own RevealToggle also carries aria-expanded, on another native <button>).
function rowHeaderToggle(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-cursor-target="tool-call-row"] [data-cursor-target="thread-card-toggle"]',
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
function rowHeader(container: HTMLElement): HTMLElement {
  return rowRoot(container).firstElementChild as HTMLElement;
}
// The aria-hidden glyphs in the row's header: the kind's icon, and the
// status icon when the state says something.
function headerGlyphs(container: HTMLElement): number {
  return rowHeader(container).querySelectorAll('[aria-hidden="true"] > svg').length;
}

describe("ToolCallItem disclosure", () => {
  // --- A settled step is closed behind its chevron ---------------------------

  it("keeps a settled summary tool collapsed behind a chevron", () => {
    // A delete that answered: its line names the file, and its answer is one
    // click away.
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({ name: "delete_file", input: { path: "/x.ts" }, result: "Deleted /x.ts" })}
      />,
    );
    expect(rowHeader(container).textContent).toContain("Deleted x.ts");
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(previewBody(container)).toBeNull();

    fireEvent.click(rowHeaderToggle(container)!);
    expect(isExpanded(container)).toBe(true);
    expect(previewBody(container)?.textContent).toContain("Deleted /x.ts");
  });

  it("shows a loaded skill as the skill it loaded, on a quiet line", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "Skill", input: { skill: "acme:lint" }, result: "loaded" })} />,
    );
    const row = rowRoot(container);
    expect(row.textContent).toContain("Used the skill acme:lint");
    expect(row.querySelector("svg")).not.toBeNull();
    expect(isQuietLine(container)).toBe(true);
  });

  it("settles a summary tool closed once it finishes running", () => {
    // While a delete runs it has nothing to show yet: a live line with no
    // chevron. Once it answered, the line settles closed behind a chevron (the
    // user never touched it). Proves the React.memo + useAutoDisclosure
    // composition recomputes from the new tool use on re-render.
    const { container, rerender } = render(
      <ToolCallItem
        toolUse={toolUse({ id: "tc-del", name: "delete_file", input: { path: "/x.ts" }, state: "running" })}
      />,
    );
    expect(rowHeader(container).textContent).toContain("Deleting x.ts");
    expect(container.querySelector(".stg\\:animate-spin")).not.toBeNull();
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).toBeNull();

    rerender(
      <ToolCallItem
        toolUse={toolUse({ id: "tc-del", name: "delete_file", input: { path: "/x.ts" }, result: "Deleted /x.ts" })}
      />,
    );
    expect(rowHeader(container).textContent).toContain("Deleted x.ts");
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
  });

  // --- Interrupted rows (issue #207): settled, neutral, never live -----------

  it("renders an interrupted row settled: collapsed, no spinner, neutral slash icon", () => {
    // A tool call the platform settled to INTERRUPTED when its run
    // terminalized mid-call. Before #207 a zombie RUNNING row spun forever and
    // force-opened; the settled row must read as finished-by-interruption,
    // and with nothing returned it has nothing to open.
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({ id: "tc-int", name: "delete_file", input: { path: "/x.ts" }, state: "stopped" })}
      />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(container.querySelector(".stgm-shimmer-label")).toBeNull();
    expect(container.querySelector(".stg\\:text-destructive")).toBeNull();
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
    // One leading mark: the slash says the state, in the kind's place.
    expect(headerGlyphs(container)).toBe(1);
  });

  it("collapses a force-opened running row the moment it settles to interrupted", () => {
    // Mirrors the running→completed settle: the server-authored interruption
    // arrives via a status update and the row must release its auto-open. A
    // running command is open to what it printed so far.
    const { container, rerender } = render(
      <ToolCallItem
        toolUse={toolUse({ id: "tc-int", name: "Bash", input: { command: "make" }, state: "running", liveOutput: "compiling\n" })}
      />,
    );
    expect(isExpanded(container)).toBe(true);
    expect(container.querySelector(".stg\\:animate-spin")).not.toBeNull();

    rerender(
      <ToolCallItem toolUse={toolUse({ id: "tc-int", name: "Bash", input: { command: "make" }, state: "stopped" })} />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(isExpanded(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  // --- Content-bearing steps are closed too ---------------------------------

  it("closes a settled edit behind a chevron that opens to its diff", () => {
    // The line already says what changed ("Edited x.ts +1 −1"); the diff is
    // one click away. The diff "Show more" is layout-gated (jsdom computes no
    // layout), so it is asserted in e2e, not here.
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "Edit",
          input: { file_path: "/x.ts", old_string: "a", new_string: "b" },
          result: "The file /x.ts has been updated successfully.",
        })}
      />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(container.querySelector("table")).toBeNull();

    fireEvent.click(rowHeaderToggle(container)!);
    // The diff renders as the accessible table.
    expect(previewBody(container)?.querySelector("table")).not.toBeNull();
  });

  it("settles a successful shell closed behind a chevron, its output one click away", () => {
    // Shell is the `tail` category: a settled success closes to its line,
    // with the command beside it; the session (prompt line and output) opens
    // on a click. No teaser of its last lines stands in for it.
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "Bash", input: { command: "echo hello" }, result: "hello" })} />,
    );
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(rowHeader(container).textContent).toContain("Ran a command");
    expect(rowHeader(container).textContent).toContain("echo hello");
    expect(container.querySelector('[data-cursor-target="terminal-tail"]')).toBeNull();
    expect(container.querySelector('[data-cursor-target="terminal-session"]')).toBeNull();
    expect(screen.queryByText("hello")).toBeNull();

    fireEvent.click(rowHeaderToggle(container)!);
    const session = container.querySelector('[data-cursor-target="terminal-session"]');
    // The output alone: the step's own line already says the command.
    expect(session?.textContent).toBe("hello");
    expect(session?.textContent).toContain("hello");
  });

  it("closes a settled MCP tool behind a chevron: its name as the line, its app as a tag", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "send_message",
          mcpServerName: "acme/slack",
          input: { channel: "general" },
          result: '{"ok":true}',
        })}
      />,
    );
    const header = rowHeader(container);
    expect(header.textContent).toContain("Send message");
    expect(within(header).getByText("acme/slack")).toBeTruthy();
    // The first argument sits beside the line.
    expect(within(header).getByText("general")).toBeTruthy();
    expect(hasHeaderChevron(container)).toBe(true);
    expect(isExpanded(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  it("says a failed command in its header: the failed line, its exit, the command beside it", () => {
    // A non-zero exit fails the step though the engine did not mark it an
    // error: the line says so, the exit badges it, the failed mark shows, and
    // the row stays open on its output.
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "Bash",
          input: { command: "ls /secret/abs/path" },
          result: "denied\n[Command failed with exit code 2]",
        })}
      />,
    );
    const header = rowHeader(container);
    expect(header.textContent).toContain("Command failed");
    expect(within(header).getByText("exit 2")).toBeTruthy();
    const command = within(header).getByText("ls /secret/abs/path");
    expect(command.className).toContain("stg:font-mono");
    expect(header.querySelector(".stg\\:text-destructive")).not.toBeNull();
    expect(within(header).getByText("Command failed").className).toContain("stg:font-medium");
    expect(isExpanded(container)).toBe(true);
    expect(rowHeaderToggle(container)?.getAttribute("aria-label")).toBe("Command failed ls /secret/abs/path, exit 2");
  });

  it("streams a running shell's full session in view (force-open, collapsible)", () => {
    // An active command shows its output streaming. The chevron is present —
    // a user may close a noisy long-running command, and their choice wins.
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

  it("opens a running command to what it printed so far", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({ name: "execute", input: { command: "npm test" }, state: "running", liveOutput: "PASS parser\n" })}
      />,
    );
    expect(rowHeader(container).querySelector(".stgm-shimmer-label")?.textContent).toBe("Running a command");
    expect(isExpanded(container)).toBe(true);
    expect(container.querySelector('[data-cursor-target="terminal-live-output"]')?.textContent).toContain("PASS parser");
  });

  // --- Tail settle lifecycle (issue #275) ------------------------------------

  it("closes a running shell the moment it succeeds", () => {
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
    expect(previewBody(container)).toBeNull();
    expect(container.textContent).not.toContain("BUILD OK");
  });

  it("keeps a failed shell open — error output is content, not context", () => {
    // A non-zero exit means the output is what the user needs next; the row
    // must never close on it. The exit marker in the result string is the
    // failure signal (status stays COMPLETED on the wire).
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

  it("opens a settled shell to its whole output, not a tail of it", () => {
    const output = ["one", "two", "three", "four", "five"].join("\n");
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "Bash", input: { command: "seq 5" }, result: output })} />,
    );
    fireEvent.click(rowHeaderToggle(container)!);
    const session = container.querySelector('[data-cursor-target="terminal-session"]')!;
    for (const line of ["one", "two", "three", "four", "five"]) expect(session.textContent).toContain(line);
    expect(session.textContent).not.toContain("+2 lines");
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

    // A stream frame re-rendering the same settled call never recloses a
    // row the user opened (useAutoDisclosure: the manual toggle wins).
    rerender(<ToolCallItem toolUse={settled} />);
    expect(isExpanded(container)).toBe(true);
  });

  it("suppresses the body for a content-bearing tool that produced nothing", () => {
    // The regression guard: a tool whose result normalizes to `empty` (no
    // output) stays a clean one-line row, never an empty padded box.
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "some_unknown_tool", result: "" })} />,
    );
    expect(hasHeaderChevron(container)).toBe(false);
    expect(previewBody(container)).toBeNull();
  });

  it("draws a step with nothing to show as a static line, never an empty box", () => {
    // An edit with no text to diff and a whole-file write of nothing: no
    // chevron, no body, no "no preview" notice standing in for one.
    for (const tc of [
      toolUse({ name: "Edit", input: { file_path: "/x.ts" }, result: "ok" }),
      toolUse({ name: "Write", input: { file_path: "/x.ts", content: "" }, result: "ok" }),
    ]) {
      const { container, unmount } = render(<ToolCallItem toolUse={tc} />);
      expect(hasHeaderChevron(container), tc.name).toBe(false);
      expect(previewBody(container), tc.name).toBeNull();
      expect(container.textContent, tc.name).not.toMatch(/preview/i);
      // Nothing to count either.
      expect(container.textContent, tc.name).not.toContain("+");
      unmount();
    }
  });

  it("shows the +N -M summary once for an edit — header only, not the diff body", () => {
    // The row header carries the counts, with a true minus; the opened diff
    // body must NOT repeat them (suppressed via showStats={false}).
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "Edit",
          input: { file_path: "/x.ts", old_string: "x\n", new_string: "x\na\nb\nc\n" },
          result: "The file /x.ts has been updated successfully.",
        })}
      />,
    );
    const header = rowHeader(container);
    expect(within(header).getByText("+3")).toBeTruthy();
    expect(within(header).getByText("−0")).toBeTruthy();
    fireEvent.click(rowHeaderToggle(container)!);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.queryAllByText("+3")).toHaveLength(1);
    expect(screen.queryAllByText("−0")).toHaveLength(1);
  });

  // --- Preview: a kind a host asks to keep open ------------------------------

  it("keeps a host's preview kind open under a plain line, with no chevron", () => {
    const dispose = registerToolPresenter("file_read", { disclosure: () => "preview" });
    try {
      const { container } = render(
        <ToolCallItem toolUse={toolUse({ name: "Read", input: { path: "/notes.md" }, result: "# Notes\n" })} />,
      );
      expect(hasHeaderChevron(container)).toBe(false);
      expect(previewBody(container)?.textContent).toContain("# Notes");
      // A quiet line holds its body under a left rail, not a frame.
      expect(isQuietLine(container)).toBe(true);
      expect(previewBody(container)?.className).toContain("stg:border-l-2");
      cleanup();

      // With nothing to show, a preview kind is a static line as well.
      const empty = render(<ToolCallItem toolUse={toolUse({ name: "Read", input: { path: "/notes.md" }, result: "" })} />);
      expect(hasHeaderChevron(empty.container)).toBe(false);
      expect(previewBody(empty.container)).toBeNull();
    } finally {
      dispose();
    }
  });

  // --- Waiting calls (asks) ---------------------------------------------------

  it("draws a waiting call as its approval, open, with its acts and no chevron to close it", () => {
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

    expect(hasHeaderChevron(container)).toBe(false);
    expect(screen.getByRole("alert", { name: "Approval required for delete_file" })).toBeTruthy();
    expect(screen.getByText("The agent wants to delete a file")).toBeTruthy();
    expect(screen.getByLabelText("Allow")).toBeTruthy();
    expect(screen.getByLabelText("Allow all file deletions")).toBeTruthy();
  });

  it("shows no decision UI on a waiting call when no answer handler is wired", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: {} });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    expect(screen.queryByLabelText("Allow")).toBeNull();
    // The waiting call still reads as waiting: the clock, in the at-risk
    // colour the theme contract measures as text on the page.
    expect(container.querySelector(".stg\\:text-status-degraded")).not.toBeNull();
  });

  it("renders a waiting preview tool's actions inline with no chevron", () => {
    // A kind a host asks to preview shows its decision actions in the
    // always-visible body — no header chevron, since there is nothing to reveal.
    const dispose = registerToolPresenter("shell", { disclosure: () => "preview" });
    try {
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
      expect(screen.getByLabelText("Allow")).toBeTruthy();
    } finally {
      dispose();
    }
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
    expect(screen.getByLabelText("Allow")).toBeTruthy();
  });

  it("routes an inline grant with the waiting tool use's id", () => {
    const tu = toolUse({ id: "tc-gated", name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
    const onAnswer = vi.fn();
    render(
      <ApprovalContext.Provider value={answering(onAnswer)}>
        <ToolCallItem toolUse={tu} />
      </ApprovalContext.Provider>,
    );

    fireEvent.click(screen.getByLabelText("Allow all file deletions"));
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
    expect(container.querySelector(".stg\\:text-status-ready")).toBeNull();
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

  it("falls back to the step's own line when the subagent has no name either", () => {
    const tu = toolUse({ name: "task", thread: thread({ agentName: "" }), state: "running" });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    expect(rowRoot(container).textContent).toContain("A helper is working");
  });

  it("tags a task row with its helper's name beside the subject, Helper without one, and repeats no header in its body", () => {
    const tu = toolUse({
      name: "task",
      input: { description: "Find the rounding code" },
      thread: thread({ agentName: "researcher", input: "Look in billing", state: "running" }),
      state: "running",
    });
    const { container } = render(<ToolCallItem toolUse={tu} />);
    const header = rowRoot(container).firstElementChild as HTMLElement;
    expect(within(header).getByText("researcher").className).toBe(tagClasses());
    expect(within(header).queryByText("Running")).toBeNull();
    // The row's header is the helper's header: its body opens to the work.
    expect(container.textContent?.match(/researcher/g)).toHaveLength(1);
    expect(container.textContent).toContain("Look in billing");
    cleanup();

    render(<ToolCallItem toolUse={toolUse({ name: "task", input: { description: "Find it" }, thread: thread({ agentName: "" }), state: "running" })} />);
    expect(screen.getByText("Helper").className).toBe(tagClasses());
  });

  it("shows no Completed pill on a finished task row, and a pill once its helper failed or stopped", () => {
    const finished = render(
      <ToolCallItem toolUse={toolUse({ name: "task", input: { description: "Find it" }, thread: thread({ state: "completed" }), result: "done" })} />,
    );
    expect(finished.queryByText("Completed")).toBeNull();
    cleanup();

    for (const [state, label] of [["failed", "Failed"], ["stopped", "Stopped"]] as const) {
      const { container } = render(
        <ToolCallItem toolUse={toolUse({ name: "task", input: { description: "Find it" }, thread: thread({ state }), result: "" })} />,
      );
      const header = rowRoot(container).firstElementChild as HTMLElement;
      expect(within(header).getByText(label).className).toContain("stg:rounded-full");
      cleanup();
    }
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
    expect(container.querySelector(".stgm-shimmer-label")?.textContent).toBe("Running a command");

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
    expect(container.querySelector(".stg\\:text-status-ready")).toBeNull();
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
    expect(screen.getByText("2s")).toBeTruthy();
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

  it("shows no badge on an edit row while its file is undecided or kept", () => {
    for (const state of ["undecided", "kept"] as const) {
      const { container, unmount } = renderEditRow(setWith(state));
      expect(badge(container), state).toBeNull();
      unmount();
    }
  });

  it("badges an edit row 'Undone' once its file is undone or undoing, and 'Couldn't undo' when the undo failed", () => {
    const cases = [
      ["undoing", "Undone"],
      ["undone", "Undone"],
      ["undo_failed", "Couldn't undo"],
    ] as const;
    for (const [state, label] of cases) {
      const { container, unmount } = renderEditRow(setWith(state));
      expect(badge(container)?.textContent, state).toBe(label);
      unmount();
    }
  });

  it("shows no badge for a file the review does not hold, a row that edits no file, or without a provider", () => {
    const otherFile = renderEditRow(setWith("undone"), editRow("/workspace/other.md"));
    expect(badge(otherFile.container)).toBeNull();
    cleanup();

    // A read of the same path is not an edit: it never carries the badge.
    const read = renderEditRow(
      setWith("undone"),
      toolUse({ name: "Read", input: { path: "/workspace/notes.md" }, result: "x" }),
    );
    expect(badge(read.container)).toBeNull();
    cleanup();

    const bare = render(<ToolCallItem toolUse={editRow()} />);
    expect(badge(bare.container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Header controls — one toggle per row, the file control beside it
// ---------------------------------------------------------------------------

describe("ToolCallItem header controls", () => {
  const settledRead = () =>
    toolUse({ name: "Read", input: { path: "/data/statements/july-statement.csv" }, result: "date,amount\n" });

  it("names the toggle for what the row is: the title, a file's base name, the result summary", () => {
    const { container, unmount } = render(<ToolCallItem toolUse={settledRead()} />);
    expect(rowHeaderToggle(container)?.getAttribute("aria-label")).toBe("Read july-statement.csv /data/statements");
    unmount();

    const search = render(
      <ToolCallItem toolUse={toolUse({ name: "Grep", input: { pattern: "invoices" }, result: "a.ts:1: x\nb.ts:2: y" })} />,
    );
    // "a.ts:1: x" is a match in a file, as ripgrep and other engines print it.
    expect(rowHeaderToggle(search.container)?.getAttribute("aria-label")).toBe("Searched for invoices, 2 matches");
  });

  it("keeps the file control out of the toggle: its own target, acting without opening or closing the row", () => {
    const { container } = render(<ToolCallItem toolUse={settledRead()} />);
    const toggle = rowHeaderToggle(container)!;
    const file = within(toggle.parentElement!).getByRole("button", {
      name: /: \/data\/statements\/july-statement\.csv$/,
    });
    expect(file).not.toBe(toggle);
    expect(toggle.contains(file), "a control inside the toggle is hidden from assistive technology").toBe(false);
    expect(toggle.tagName).toBe("BUTTON");

    const before = toggle.getAttribute("aria-expanded");
    fireEvent.click(file);
    expect(toggle.getAttribute("aria-expanded"), "the file click stays on the file").toBe(before);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).not.toBe(before);
  });

  it("shows a cut-off subtitle's full text on the toggle's focus, and no hint while it fits", async () => {
    // The subtitle is what sits beside the line: here a long command.
    const command = "npx vitest run src/billing --reporter=verbose --coverage.enabled";
    const row = () => toolUse({ name: "Bash", input: { command }, result: "ok" });

    const fits = render(<ToolCallItem toolUse={row()} />);
    expect(rowHeaderToggle(fits.container)?.getAttribute("aria-label")).toBe(`Ran a command ${command}`);
    await userEvent.tab();
    expect(document.activeElement).toBe(rowHeaderToggle(fits.container));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryAllByText(command), "only the subtitle itself, no tooltip").toHaveLength(1);
    fits.unmount();

    // happy-dom lays nothing out, so "cut off" is the measurement's word.
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);
    try {
      const cut = render(<ToolCallItem toolUse={row()} />);
      await userEvent.tab();
      expect(document.activeElement).toBe(rowHeaderToggle(cut.container));
      await waitFor(() => expect(screen.queryAllByText(command)).toHaveLength(2));
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// The step's line — plain words, the file linked, the counts and the detail
// ---------------------------------------------------------------------------

describe("ToolCallItem step line", () => {
  const edit = (path = "/src/billing/invoice.ts") =>
    toolUse({ name: "Edit", input: { file_path: path, old_string: "a\nb\n", new_string: "c\n" }, result: "ok" });

  it("reads at body size: the words, the file linked in them, the change counted, the folder beside", () => {
    const { container } = render(<ToolCallItem toolUse={edit()} />);
    const header = rowHeader(container);
    expect(header.className).toContain("stg:text-sm");
    expect(header.textContent).toContain("Edited invoice.ts");
    // The file name is the file's own control, not plain words.
    expect(within(header).getByRole("button", { name: /: \/src\/billing\/invoice\.ts$/ })).toBeTruthy();
    // The true minus, never a hyphen.
    expect(within(header).getByText("+1")).toBeTruthy();
    expect(within(header).getByText("−2")).toBeTruthy();
    expect(within(header).getByText("/src/billing")).toBeTruthy();
    expect(rowHeaderToggle(container)?.getAttribute("aria-label")).toBe("Edited invoice.ts /src/billing, +1 −2");
  });

  it("keeps a host's label as plain words when it does not end with the file's name", () => {
    const dispose = registerToolPresenter("file_edit", { label: () => "Patched the invoice" });
    try {
      const { container } = render(<ToolCallItem toolUse={edit()} />);
      const header = rowHeader(container);
      expect(header.textContent).toContain("Patched the invoice");
      expect(within(header).queryByRole("button", { name: /invoice\.ts/ })).toBeNull();
    } finally {
      dispose();
    }
  });

  it("keeps a file name the line had to cut short as plain words", () => {
    const long = `/src/${"a-very-long-module-name-".repeat(3)}invoice.ts`;
    const { container } = render(<ToolCallItem toolUse={edit(long)} />);
    const header = rowHeader(container);
    expect(header.textContent).toContain("Edited a-very-long");
    expect(header.textContent).toContain("…");
    expect(within(header).queryByRole("button", { name: /invoice\.ts$/ })).toBeNull();
  });

  it("names no folder for a file at the root", () => {
    const { container } = render(<ToolCallItem toolUse={edit("invoice.ts")} />);
    expect(rowHeaderToggle(container)?.getAttribute("aria-label")).toBe("Edited invoice.ts, +1 −2");
  });

  it("counts the lines a whole-file write wrote as added, with or without a final newline", () => {
    const cases = [
      ["a\nb\nc\n", "+3"],
      ["a\nb", "+2"],
    ] as const;
    for (const [content, added] of cases) {
      const { container, unmount } = render(
        <ToolCallItem toolUse={toolUse({ name: "Write", input: { file_path: "/notes.md", content }, result: "ok" })} />,
      );
      const header = rowHeader(container);
      expect(header.textContent).toContain("Wrote notes.md");
      expect(within(header).getByText(added)).toBeTruthy();
      expect(within(header).getByText("−0")).toBeTruthy();
      unmount();
    }
  });

  it("counts what a search found and what a listing held", () => {
    const search = render(
      <ToolCallItem toolUse={toolUse({ name: "Grep", input: { pattern: "round(", path: "src/billing" }, result: "  12: round(a)\n  40: round(b)" })} />,
    );
    expect(rowHeader(search.container).textContent).toContain("Searched for round( in src/billing");
    expect(within(rowHeader(search.container)).getByText("2 matches")).toBeTruthy();
    search.unmount();

    const list = render(<ToolCallItem toolUse={toolUse({ name: "ls", input: { path: "/src" }, result: "a.ts\nb.ts\nc.ts" })} />);
    expect(within(rowHeader(list.container)).getByText("3 files")).toBeTruthy();
  });

  it("counts nothing before a step returned", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({ name: "Edit", input: { file_path: "/x.ts", old_string: "a", new_string: "b" }, state: "running" })}
      />,
    );
    expect(rowHeader(container).textContent).toContain("Editing x.ts");
    expect(within(rowHeader(container)).queryByText("+1")).toBeNull();
  });

  it("names an unknown tool's first argument beside its line", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "frobnicate_widget", input: { widget: "widget-42" }, result: "done" })} />,
    );
    const header = rowHeader(container);
    expect(header.textContent).toContain("Frobnicate widget");
    expect(within(header).getByText("widget-42")).toBeTruthy();
  });

  it("reads a denied call as one it could not do, without the failed look", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "delete_file", input: { path: "/x.ts" }, ask: {}, confirmation: "deny" })} />,
    );
    const header = rowHeader(container);
    expect(header.textContent).toContain("Couldn't delete x.ts");
    expect(header.querySelector(".stg\\:text-destructive")).toBeNull();
    expect(header.querySelector(".stg\\:font-medium.stg\\:text-foreground")).toBeNull();
    expect(headerGlyphs(container)).toBe(1);
  });

  it("restates a search pattern its line had to cut, whole, once the step opens", () => {
    const pattern = "invoiceTotal\\(lines: readonly Line\\[\\]\\): Cents \\{ return roundHalfEven";
    const { container } = render(<ToolCallItem toolUse={toolUse({ name: "grep", input: { pattern }, result: "  12: x" })} />);
    expect(rowHeader(container).textContent).not.toContain(pattern);
    fireEvent.click(rowHeaderToggle(container)!);
    expect(screen.getByText(pattern)).toBeTruthy();
  });

  it("keeps a short pattern in its line alone, never restated in the body", () => {
    const { container } = render(<ToolCallItem toolUse={toolUse({ name: "grep", input: { pattern: "round(" }, result: "  12: x" })} />);
    fireEvent.click(rowHeaderToggle(container)!);
    expect(screen.queryByText("Query")).toBeNull();
  });

  it("reads a call its turn stopped as one it could not do", () => {
    const { container } = render(<ToolCallItem toolUse={toolUse({ name: "delete_file", input: { path: "/x.ts" }, state: "stopped" })} />);
    expect(rowHeader(container).textContent).toContain("Couldn't delete x.ts");
  });

  it("shows a host's registered summary in place of the counts, in the row and its toggle's name", () => {
    const unregister = registerToolPresenter("search", { summary: () => "3 hits in billing" });
    try {
      const { container } = render(<ToolCallItem toolUse={toolUse({ name: "grep", input: { pattern: "round(" }, result: "  12: a\n  13: b" })} />);
      expect(within(rowHeader(container)).getByText("3 hits in billing")).toBeTruthy();
      expect(within(rowHeader(container)).queryByText("2 matches")).toBeNull();
      expect(rowHeaderToggle(container)!.getAttribute("aria-label")).toContain("3 hits in billing");
    } finally {
      unregister();
    }
  });
});

describe("a waiting step, for a viewer who cannot answer it", () => {
  it("says whom it waits on, by name or as the owner, and says nothing extra to whoever answers", () => {
    const waiting = samples.fold([
      samples.toolUseEvent("write_file", { path: "src/billing/rounding.ts" }, { id: "w1", evaluatedPermission: "ask" }),
      samples.permissionAskedEvent("w1", { argsPreview: '{"path":"src/billing/rounding.ts"}' }),
    ]).turns[0]!.items.find((item): item is ToolUse => item.kind === "tool_use")!;
    const { unmount } = render(
      <ApprovalContext.Provider value={{ submittingIds: new Set(), errorsByToolUseId: new Map(), approverName: "Maya Okafor" }}>
        <ToolCallItem toolUse={waiting} />
      </ApprovalContext.Provider>,
    );
    expect(screen.getByText("Waiting for Maya Okafor to approve")).toBeTruthy();
    unmount();

    render(
      <ApprovalContext.Provider value={{ onAnswer: () => undefined, submittingIds: new Set(), errorsByToolUseId: new Map() }}>
        <ToolCallItem toolUse={waiting} />
      </ApprovalContext.Provider>,
    );
    expect(screen.queryByText(/Waiting for .* to approve/)).toBeNull();
  });
});

describe("ToolCallItem's second line", () => {
  it("says why a file step failed, in its tool's own first line, where a settled one says its folder", () => {
    render(
      <ToolCallItem
        toolUse={toolUse({ name: "edit_file", input: { path: "src/billing/round.ts", old_string: "a", new_string: "b" }, result: "Error: old_string not found in file\nat line 3", isError: true })}
      />,
    );
    expect(screen.getByText("Old_string not found in file")).toBeTruthy();
    expect(screen.queryByText("at line 3")).toBeNull();
  });

  it("says what a File written to the outputs folder is and how big, not the folder", () => {
    render(
      <ToolCallItem
        toolUse={toolUse({ name: "write_file", input: { path: "/workspace/.stigmer/outputs/audit.md", content: "x".repeat(4_210) }, result: "Wrote audit.md" })}
      />,
    );
    expect(screen.getByText("Markdown · 4.1 KB")).toBeTruthy();
    expect(screen.queryByText(/\.stigmer\/outputs/)).toBeNull();
  });

  it("reads the outputs folder only as a folder of its own, and never as a name ending in it", () => {
    const { rerender } = render(
      <ToolCallItem toolUse={toolUse({ name: "write_file", input: { path: "/workspace/my.stigmer/outputs/audit.md", content: "x" }, result: "ok" })} />,
    );
    expect(screen.queryByText(/^Markdown ·/)).toBeNull();
    rerender(<ToolCallItem toolUse={toolUse({ name: "write_file", input: { path: ".stigmer/outputs/", content: "x" }, result: "ok" })} />);
    expect(screen.queryByText(/KB$/)).toBeNull();
    rerender(<ToolCallItem toolUse={toolUse({ name: "write_file", input: { path: "a.stigmer/outputs/x/.stigmer/outputs/b.md", content: "x" }, result: "ok" })} />);
    expect(screen.getByText("Markdown · 0.1 KB")).toBeTruthy();
  });

  it("counts a running step's time from its start, and shows nothing under a second", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.parse(TOOL_STARTED_AT) + 400));
      const running = toolUse({ name: "read_file", input: { path: "a.ts" }, state: "running" });
      const { container } = render(<ToolCallItem toolUse={running} />);
      expect(container.textContent).not.toMatch(/\d+s/);
      act(() => {
        vi.advanceTimersByTime(65_000);
      });
      expect(container.textContent).toContain("1m 05s");
    } finally {
      vi.useRealTimers();
    }
  });
});
