// Pins ToolCallDetail over the session fold's tool uses: the body shows
// content and never the header's metadata (duration), the provenance note
// read from the ask's rule word (smart-suppressed), search and edit bodies
// without duplicated stats, and a write's body: its turn's captured diff of
// the file (matched through the turn's file review by path, the bytes from
// the run's change set), with the proposed-content fallback for every
// unresolvable case. A shell call that is still running shows what it has
// printed so far, and its finished session once the result lands.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/client";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  FileChangeKind,
  FileReviewBlockReason,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { UseFileChangeContentReturn } from "../useFileChangeContent";
import { reviewFile, reviewSet, toolUse, type ToolUseInit } from "./__fixtures__/fold-values";

// Mock the diff-body content resolver (the seam FileChangesView.test.tsx also
// mocks): FileChangeDiff calls it unconditionally, and its real implementation
// needs a Stigmer client for offloaded bodies — irrelevant to these tests.
let mockContent: UseFileChangeContentReturn;

vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => mockContent,
}));

const { ToolCallDetail, formatDuration, formatHeaderDuration } = await import(
  "../ToolCallDetail"
);
const { FileReviewContext } = await import("../FileReviewContext");

beforeEach(() => {
  mockContent = {
    beforeText: "alpha\n",
    afterText: "captured-after\n",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
  };
});

afterEach(cleanup);

describe("ToolCallDetail — metadata invariant (header owns it, body shows content)", () => {
  it("does not render the duration in the body (the owning row header shows it)", () => {
    // A 5s run would format as "5.0s" if the body still printed duration.
    const { container } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "delete_file",
          input: { path: "/tmp/x.ts" },
          result: "deleted",
          durationMs: 5_000,
        })}
      />,
    );
    expect(container.textContent).not.toContain("5.0s");
  });

  it("suppresses the everyday default provenance (built-in tool policy is noise)", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "delete_file",
          input: { path: "/tmp/x.ts" },
          ask: { policySource: "builtin_category" },
          confirmation: "allow",
          result: "deleted",
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
  });

  it("suppresses provenance entirely for a call no rule asked about", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "delete_file",
          input: { path: "/tmp/x.ts" },
          result: "deleted",
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
    expect(queryByText(/auto-approved/)).toBeNull();
  });

  it("surfaces a genuinely informative provenance (a run lease that cleared the call)", () => {
    const { getByText } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "delete_file",
          input: { path: "/tmp/x.ts" },
          ask: { policySource: "approval_lease" },
          confirmation: "allow",
          result: "deleted",
        })}
      />,
    );
    expect(getByText("auto-approved by a run lease")).toBeTruthy();
  });

  it("names the plugin whose hook asked", () => {
    const { getByText } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "delete_file",
          input: { path: "/tmp/x.ts" },
          ask: { policySource: "hook", policyHook: "safety" },
          confirmation: "allow",
          result: "deleted",
        })}
      />,
    );
    expect(getByText("decided by the safety plugin's hook")).toBeTruthy();
  });
});

describe("ToolCallDetail — search body de-duplicates the query", () => {
  it("does not restate the query (no 'Pattern:' row) when the header shows it in full", () => {
    const { container } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "Grep",
          input: { pattern: "pipeline" },
          result: "No files found",
        })}
        // Header did not truncate the short query.
        primaryArgTruncated={false}
      />,
    );
    // No duplicate label, and the short query is not repeated.
    expect(container.textContent).not.toContain("Pattern:");
    expect(container.textContent).not.toContain("pipeline");
    // The result still renders its (empty) state honestly.
    expect(container.textContent).toContain("No files found");
  });

  it("does not restate the result count in the body (the row header shows it)", () => {
    const { container } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "Glob",
          input: { pattern: "Dockerfile" },
          result: "Dockerfile",
        })}
      />,
    );
    // The matched file renders, but the redundant "1 file" count does not.
    expect(container.textContent).toContain("Dockerfile");
    expect(container.textContent).not.toContain("1 file");
  });

  it("restates the full query (labeled 'Query') only when the header truncated it", () => {
    const longQuery =
      "a-very-long-search-query-that-would-not-fit-in-the-header-subtitle";
    const { container } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "Grep",
          input: { pattern: longQuery },
          result: "No files found",
        })}
        primaryArgTruncated
      />,
    );
    expect(container.textContent).toContain("Query");
    expect(container.textContent).toContain(longQuery);
  });
});

describe("ToolCallDetail — edit body has no duplicate stats", () => {
  it("renders the edit diff as a table without restating the +N -M counts", () => {
    const { container } = render(
      <ToolCallDetail
        toolUse={toolUse({
          name: "Edit",
          input: { file_path: "src/x.ts", old_string: "a\n", new_string: "a\nnew line\n" },
          result: "The file src/x.ts has been updated successfully.",
        })}
      />,
    );
    // The diff content renders through the table...
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("new line");
    // ...but the body does not repeat the +N -M the row header already shows.
    expect(container.textContent).not.toContain("+1");
  });
});

// ---------------------------------------------------------------------------
// Write body — captured diff on a stamped row, single-bounded fallback
// ---------------------------------------------------------------------------

describe("ToolCallDetail — write body", () => {
  const SET_ID = "cs-1";
  // BoundedContent's collapsed pixel clamp (PREVIEW_MAX_HEIGHT). Its presence/
  // absence is how these tests pin WHICH truncation mechanism bounds the body —
  // jsdom has no layout, so the reveal control itself only appears for the
  // line-count mechanism (CollapsibleCode), never for the pixel clamp.
  const CLAMP = ".stg\\:max-h-48";

  /** The run's change set capturing one modify of `path`. */
  function capturedSet(
    path = "notes.md",
    overrides?: { diffComplete?: boolean; blockedReason?: FileReviewBlockReason },
  ): FileChangeSet {
    return create(FileChangeSetSchema, {
      id: SET_ID,
      changes: [
        create(CapturedFileChangeSchema, {
          id: `${SET_ID}:${path}`,
          pathBefore: path,
          pathAfter: path,
          kind: FileChangeKind.MODIFY,
          diffComplete: overrides?.diffComplete ?? true,
          blockedReason:
            overrides?.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
        }),
      ],
    });
  }

  function writeCall(opts?: Partial<ToolUseInit>): ToolUse {
    return toolUse({
      name: "write_file",
      input: { file_path: "notes.md", content: "proposed body\n" },
      result: "Successfully wrote to 'notes.md'",
      ...opts,
    });
  }

  /**
   * Renders the detail with the turn's review naming `reviewedPath` (none
   * when null) and the run holding `capture` (none when null).
   */
  function renderWith(row: ToolUse, reviewedPath: string | null, capture: FileChangeSet | null) {
    const fileReviewByRunId = new Map(
      reviewedPath === null
        ? []
        : [["run_1", [reviewSet({ changeSetId: SET_ID, files: [reviewFile({ path: reviewedPath })] })]] as const],
    );
    const changeSetsById = new Map(capture ? [[SET_ID, capture]] : []);
    return render(
      <FileReviewContext.Provider value={{ fileReviewByRunId, changeSetsById }}>
        <ToolCallDetail toolUse={row} />
      </FileReviewContext.Provider>,
    );
  }

  it("renders the captured net diff (not the Content block) when the turn's review holds the file", () => {
    const { container } = renderWith(writeCall(), "notes.md", capturedSet());
    // The captured before/after renders as a real diff table...
    expect(container.querySelector('[data-cursor-target="file-diff"]')).not.toBeNull();
    expect(container.textContent).toContain("captured-after");
    // ...bounded by the shared pixel clamp, with the +N -M stats the write
    // row's header does not carry, and without the fallback's raw args body.
    // (The diff table itself carries a hidden a11y column header named
    // "Content", so the discriminator is the body text, not the label.)
    expect(container.querySelector(CLAMP)).not.toBeNull();
    expect(container.textContent).toContain("+1");
    expect(container.textContent).not.toContain("proposed body");
  });

  it("renders exactly one reveal control for the content fallback (double-expander regression)", () => {
    const longBody = Array.from({ length: 55 }, (_, i) => `line ${i + 1}`).join("\n");
    const { container, getAllByRole } = render(
      <ToolCallDetail
        toolUse={writeCall({ input: { file_path: "notes.md", content: longBody } })}
      />,
    );
    // The file view self-truncates (line-count mechanism, one control)...
    const reveals = getAllByRole("button").filter((b) =>
      /^Show /.test(b.textContent ?? ""),
    );
    expect(reveals).toHaveLength(1);
    expect(reveals[0].textContent).toContain("Show all 55 lines");
    // ...and is never ALSO wrapped in BoundedContent's pixel clamp.
    expect(container.querySelector(CLAMP)).toBeNull();
  });

  it("falls back to the Content block for every unresolvable capture", () => {
    const cases: Array<[string, string | null, FileChangeSet | null]> = [
      ["no review for the turn", null, capturedSet()],
      ["capture missing from the runs", "notes.md", null],
      ["file not in the review", "other.md", capturedSet("other.md")],
      [
        "non-reviewable (secret-withheld) change",
        "notes.md",
        capturedSet("notes.md", {
          diffComplete: false,
          blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
        }),
      ],
    ];
    for (const [label, reviewed, capture] of cases) {
      const { container } = renderWith(writeCall(), reviewed, capture);
      expect(container.textContent, label).toContain("Content");
      expect(container.textContent, label).toContain("proposed body");
      expect(
        container.querySelector('[data-cursor-target="file-diff"]'),
        label,
      ).toBeNull();
      cleanup();
    }
  });

  it("keeps a FAILED write's error view inside the pixel clamp (bounding-rule lock)", () => {
    const { container } = render(
      <ToolCallDetail
        toolUse={writeCall({
          isError: true,
          result: "EACCES: permission denied, open 'notes.md'",
        })}
      />,
    );
    expect(container.textContent).toContain("permission denied");
    // The error <pre> has no internal truncation, so BoundedContent bounds it.
    expect(container.querySelector(CLAMP)).not.toBeNull();
  });

  it("leaves an EDIT row on its per-call input diff, never the captured net diff", () => {
    const edit = toolUse({
      name: "edit_file",
      input: { file_path: "notes.md", old_string: "alpha", new_string: "edit-args-b" },
      result: "Successfully replaced 1 occurrence in 'notes.md'",
    });
    const { container } = renderWith(edit, "notes.md", capturedSet());
    // The per-call diff from the call's own input renders...
    expect(container.textContent).toContain("edit-args-b");
    // ...not the change set's captured net content...
    expect(container.textContent).not.toContain("captured-after");
    // ...still inside the shared pixel clamp (unchanged behavior).
    expect(container.querySelector(CLAMP)).not.toBeNull();
  });
});

describe("ToolCallDetail — think body", () => {
  it("shows the thought from the input, else from the result", () => {
    const fromInput = render(
      <ToolCallDetail toolUse={toolUse({ name: "think", input: { thought: "weigh the options" } })} />,
    );
    expect(fromInput.container.textContent).toContain("weigh the options");
    cleanup();

    const fromResult = render(
      <ToolCallDetail toolUse={toolUse({ name: "think", result: "considered" })} />,
    );
    expect(fromResult.container.textContent).toContain("considered");
  });

  it("renders nothing for an empty thought", () => {
    const { container } = render(<ToolCallDetail toolUse={toolUse({ name: "think" })} />);
    expect(container.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Duration formatting — the exact helper vs the >= 1s header-chip variant
// ---------------------------------------------------------------------------

describe("formatHeaderDuration", () => {
  const T0 = "2026-08-13T10:00:00.000Z";
  const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

  it("suppresses sub-second durations that formatDuration would render", () => {
    // The exact helper keeps its public contract...
    expect(formatDuration(T0, at(400))).toBe("400ms");
    // ...while the header-chip variant treats the same span as noise.
    expect(formatHeaderDuration(T0, at(400))).toBeNull();
  });

  it("passes through everything from one second up, exactly as formatDuration renders it", () => {
    const cases = [1000, 2500, 61_000, 180_000];
    for (const ms of cases) {
      expect(formatHeaderDuration(T0, at(ms))).toBe(formatDuration(T0, at(ms)));
      expect(formatHeaderDuration(T0, at(ms))).not.toBeNull();
    }
  });

  it("stays null for missing or invalid timestamps, like the exact helper", () => {
    expect(formatHeaderDuration("", at(400))).toBeNull();
    expect(formatHeaderDuration(T0, "")).toBeNull();
    expect(formatHeaderDuration("not-a-date", at(2000))).toBeNull();
  });
});

describe("a running shell call", () => {
  it("shows its output so far in the terminal session, then its finished session once the result lands", () => {
    const running = toolUse({ name: "execute", input: { command: "npm test" }, state: "running", liveOutput: "PASS parser\nPASS lexer\n" });
    const { container, rerender } = render(<ToolCallDetail toolUse={running} />);
    const session = container.querySelector('[data-cursor-target="terminal-session"]');
    expect(session?.textContent).toContain("$ npm test");
    expect(container.querySelector('[data-cursor-target="terminal-live-output"]')?.textContent).toBe("PASS parser\nPASS lexer");

    const finished = toolUse({ name: "execute", input: { command: "npm test" }, result: "PASS parser\nPASS lexer\nall passed\n[Command succeeded with exit code 0]" });
    rerender(<ToolCallDetail toolUse={finished} />);
    expect(container.querySelector('[data-cursor-target="terminal-live-output"]')).toBeNull();
    expect(container.querySelector('[data-cursor-target="terminal-session"]')?.textContent).toContain("all passed");
  });

  it("shows only the command while a running call has printed nothing", () => {
    const { container } = render(<ToolCallDetail toolUse={toolUse({ name: "execute", input: { command: "make" }, state: "running" })} />);
    expect(container.querySelector('[data-cursor-target="terminal-live-output"]')).toBeNull();
    expect(container.querySelector('[data-cursor-target="terminal-session"]')?.textContent).toBe("$ make");
  });
});
