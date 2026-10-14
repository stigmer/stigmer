/**
 * Subagent file-review badges.
 *
 * A subagent's file-edit row is a tool use of the PARENT turn (its run is
 * the turn's run; subagent writes fold into the turn's file review). These
 * tests lock the React side: an edit row rendered inside a `SubagentSection`
 * resolves its review-state badge against the `FileReviewContext` entry for
 * its turn, by path, and — end to end through `MessageThread` — that entry is
 * built from the turn's own `fileReview` and reaches the nested row.
 *
 * The per-row badge resolution itself (pending/kept/discarded/none) is
 * covered exhaustively in `ToolCallItem.test.tsx`; here the emphasis is the
 * SUBAGENT wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { FileReviewFile, FileReviewSet, Thread, Turn } from "@stigmer/sdk";
import { SubagentSection } from "../SubagentSection";
import { FileReviewContext } from "../FileReviewContext";
import { MessageThread } from "../MessageThread";
import { reviewFile, reviewSet, thread, toolUse } from "./__fixtures__/fold-values";

const ROW_PATH = "src/a.ts";

afterEach(cleanup);

/** A subagent whose thread carries one file-edit row of the parent turn. */
function subagentWithEdit(state: Thread["state"], rowPath = ROW_PATH): Thread {
  return thread({
    id: "sa-1",
    agentName: "code_editor",
    state,
    items: [
      toolUse({
        id: "sa-tc-edit",
        name: "edit",
        threadId: "sa-1",
        input: { path: rowPath, old_string: "a", new_string: "b" },
        result: "ok",
      }),
    ],
  });
}

/** The turn's review: one file at {@link ROW_PATH} in `state`. */
function turnReview(state: FileReviewFile["state"]): FileReviewSet {
  return reviewSet({ files: [reviewFile({ path: ROW_PATH, state })] });
}

function renderSubagentRow(sub: Thread, set: FileReviewSet | null) {
  const fileReviewByRunId = new Map(set ? [["run_1", [set]] as const] : []);
  return render(
    <FileReviewContext.Provider value={{ fileReviewByRunId, changeSetsById: new Map() }}>
      {/* collapsible=false renders the nested rows flat — deterministic, no
          dependence on the card's auto-disclosure state. */}
      <SubagentSection thread={sub} collapsible={false} />
    </FileReviewContext.Provider>,
  );
}

function badge(container: HTMLElement): Element | null {
  return container.querySelector('[data-cursor-target="file-review-row-badge"]');
}

describe("subagent row badges (SubagentSection)", () => {
  it("badges a subagent edit row 'Pending review' while its file is undecided", () => {
    const { container } = renderSubagentRow(subagentWithEdit("completed"), turnReview("undecided"));
    expect(badge(container)?.textContent).toBe("Pending review");
  });

  it("flips a subagent row to the file's verdict once it is decided", () => {
    const kept = renderSubagentRow(subagentWithEdit("completed"), turnReview("kept"));
    expect(badge(kept.container)?.textContent).toBe("Kept");
    cleanup();

    const discarded = renderSubagentRow(subagentWithEdit("completed"), turnReview("undone"));
    expect(badge(discarded.container)?.textContent).toBe("Discarded");
  });

  it("shows no badge when the turn has no review, or the row's file is not in it", () => {
    const noReview = renderSubagentRow(subagentWithEdit("completed"), null);
    expect(badge(noReview.container)).toBeNull();
    cleanup();

    const pathMiss = renderSubagentRow(subagentWithEdit("completed", "src/other.ts"), turnReview("kept"));
    expect(badge(pathMiss.container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end through MessageThread: proves the FileReviewContext entry is
// built from the turn's own file review and reaches an edit row nested
// inside a subagent (the map + provider + nested-render path).
// ---------------------------------------------------------------------------

describe("subagent row badges (MessageThread integration)", () => {
  beforeEach(() => {
    // useAutoScroll depends on browser APIs absent in happy-dom.
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "",
        thresholds: [0],
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        cb(performance.now());
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A live turn that delegated to a subagent which edited a file: the
   * turn's `task` call carries the subagent's thread (running, so its card
   * auto-opens), and the turn's review holds the file.
   */
  function turnWithSubagentEdit(): Turn {
    const task = toolUse({ id: "sa-1", name: "task", state: "running", thread: subagentWithEdit("running") });
    return {
      runId: "run_1",
      userMessage: { id: "run_1.user", text: "Delegate an edit", processedAt: "" },
      items: [{ kind: "message", id: "run_1.root.m0", text: "Delegating.", live: false, processedAt: "" }, task],
      status: { phase: "running", stopCause: "", error: "", processedAt: "" },
      ended: false,
      asks: [],
      todos: [],
      structuredOutput: undefined,
      memory: undefined,
      fileReview: [turnReview("undecided")],
      errors: [],
      answer: "Delegating.",
    };
  }

  it("badges a subagent row from its turn's file review", () => {
    render(<MessageThread turns={[turnWithSubagentEdit()]} showFileReviewRecords />);
    const el = document.querySelector('[data-cursor-target="file-review-row-badge"]');
    expect(el?.textContent).toBe("Pending review");
  });
});
