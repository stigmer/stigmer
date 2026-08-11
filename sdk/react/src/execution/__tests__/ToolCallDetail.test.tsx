import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  ApprovalPolicySource,
  FileChangeKind,
  FileReviewBlockReason,
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseFileChangeContentReturn } from "../useFileChangeContent";

// Mock the diff-body content resolver (the seam FileChangesView.test.tsx also
// mocks): FileChangeDiff calls it unconditionally, and its real implementation
// needs a Stigmer client for offloaded bodies — irrelevant to these tests.
let mockContent: UseFileChangeContentReturn;

vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => mockContent,
}));

const { ToolCallDetail } = await import("../ToolCallDetail");
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

function makeToolCall(opts: {
  name: string;
  toolKind?: ToolKind;
  args?: Record<string, unknown>;
  result?: string;
  approvalPolicySource?: ApprovalPolicySource;
  startedAt?: string;
  completedAt?: string;
  status?: ToolCallStatus;
  error?: string;
  fileChangeSetId?: string;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.name,
    name: opts.name,
    toolKind: opts.toolKind ?? ToolKind.UNSPECIFIED,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    approvalPolicySource:
      opts.approvalPolicySource ?? ApprovalPolicySource.UNSPECIFIED,
    startedAt: opts.startedAt ?? "",
    completedAt: opts.completedAt ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
    error: opts.error ?? "",
    fileChangeSetId: opts.fileChangeSetId ?? "",
  });
}

describe("ToolCallDetail — metadata invariant (header owns it, body shows content)", () => {
  it("does not render the duration in the body (the owning row header shows it)", () => {
    // A 5s run would format as "5.0s" if the body still printed duration.
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
        })}
      />,
    );
    expect(container.textContent).not.toContain("5.0s");
  });

  it("suppresses the everyday default provenance (built-in tool policy is noise)", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.BUILTIN_CATEGORY,
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
  });

  it("suppresses provenance entirely for a legacy/ungated UNSPECIFIED call", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.UNSPECIFIED,
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
    expect(queryByText(/auto-approved/)).toBeNull();
  });

  it("surfaces a genuinely informative provenance (a run lease that cleared the call)", () => {
    const { getByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.APPROVAL_LEASE,
        })}
      />,
    );
    expect(getByText("auto-approved by a run lease")).toBeTruthy();
  });
});

describe("ToolCallDetail — search body de-duplicates the query", () => {
  it("does not restate the query (no 'Pattern:' row) when the header shows it in full", () => {
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "Grep",
          toolKind: ToolKind.SEARCH,
          args: { pattern: "pipeline" },
          result:
            '{"workspaceResults":{"/work/demo":{"type":"files","output":{"files":[],"count":0}}}}',
        })}
        // Header did not truncate the short query.
        primaryArgTruncated={false}
      />,
    );
    // The legacy duplicate label is gone, and the short query is not repeated.
    expect(container.textContent).not.toContain("Pattern:");
    expect(container.textContent).not.toContain("pipeline");
    // The result still renders its (empty) state honestly.
    expect(container.textContent).toContain("No files found");
  });

  it("unwraps the real {status,value:{workspaceResults}} grep result instead of dumping JSON", () => {
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "Grep",
          toolKind: ToolKind.SEARCH,
          args: { pattern: "pipeline" },
          result:
            '{"status":"success","value":{"workspaceResults":{"/work/demo":{"type":"files","output":{"files":[],"count":0}}}}}',
        })}
      />,
    );
    // The body renders the empty state, never the raw envelope keys.
    expect(container.textContent).toContain("No files found");
    expect(container.textContent).not.toContain("workspaceResults");
    expect(container.textContent).not.toContain("status");
  });

  it("does not restate the result count in the body (the row header shows it)", () => {
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "Glob",
          toolKind: ToolKind.SEARCH,
          args: { pattern: "Dockerfile" },
          result:
            '{"status":"success","value":{"files":["Dockerfile"],"totalFiles":1,"clientTruncated":false,"ripgrepTruncated":false}}',
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
        toolCall={makeToolCall({
          name: "Grep",
          toolKind: ToolKind.SEARCH,
          args: { pattern: longQuery },
          result:
            '{"workspaceResults":{"/work/demo":{"type":"files","output":{"files":[],"count":0}}}}',
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
        toolCall={makeToolCall({
          name: "str_replace",
          toolKind: ToolKind.FILE_EDIT,
          args: { path: "src/x.ts" },
          result:
            '{"status":"success","value":{"linesAdded":1,"linesRemoved":0,"diffString":"@@ -0,0 +1,1 @@\\n+new line"}}',
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
  const SET_ID = "aex-1:0";
  // BoundedContent's collapsed pixel clamp (PREVIEW_MAX_HEIGHT). Its presence/
  // absence is how these tests pin WHICH truncation mechanism bounds the body —
  // jsdom has no layout, so the reveal control itself only appears for the
  // line-count mechanism (CollapsibleCode), never for the pixel clamp.
  const CLAMP = ".stg\\:max-h-48";

  /** A change set capturing one reviewable modify of `path`. */
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

  function writeCall(opts?: Partial<Parameters<typeof makeToolCall>[0]>): ToolCall {
    return makeToolCall({
      name: "write_file",
      toolKind: ToolKind.FILE_WRITE,
      args: { file_path: "notes.md", contents: "proposed body\n" },
      result: "Successfully wrote to 'notes.md'",
      ...opts,
    });
  }

  function renderWithSet(toolCall: ToolCall, set: FileChangeSet | null) {
    const changeSetsById = new Map(set ? [[SET_ID, set]] : []);
    return render(
      <FileReviewContext.Provider value={{ changeSetsById }}>
        <ToolCallDetail toolCall={toolCall} />
      </FileReviewContext.Provider>,
    );
  }

  it("renders the captured net diff (not the Content block) on a stamped row", () => {
    const { container } = renderWithSet(
      writeCall({ fileChangeSetId: SET_ID }),
      capturedSet(),
    );
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
        toolCall={writeCall({ args: { file_path: "notes.md", contents: longBody } })}
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
    const cases: Array<[string, ToolCall, FileChangeSet | null]> = [
      ["unstamped row", writeCall(), capturedSet()],
      ["set missing from context", writeCall({ fileChangeSetId: SET_ID }), null],
      [
        "path not in set",
        writeCall({ fileChangeSetId: SET_ID }),
        capturedSet("other.md"),
      ],
      [
        "non-reviewable (secret-withheld) change",
        writeCall({ fileChangeSetId: SET_ID }),
        capturedSet("notes.md", {
          diffComplete: false,
          blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
        }),
      ],
    ];
    for (const [label, toolCall, set] of cases) {
      const { container } = renderWithSet(toolCall, set);
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
        toolCall={writeCall({
          status: ToolCallStatus.TOOL_CALL_FAILED,
          error: "EACCES: permission denied, open 'notes.md'",
        })}
      />,
    );
    expect(container.textContent).toContain("permission denied");
    // The error <pre> has no internal truncation, so BoundedContent bounds it.
    expect(container.querySelector(CLAMP)).not.toBeNull();
  });

  it("leaves a stamped EDIT row on its per-call args diff, never the captured net diff", () => {
    const edit = makeToolCall({
      name: "edit_file",
      toolKind: ToolKind.FILE_EDIT,
      args: { file_path: "notes.md", old_string: "alpha", new_string: "edit-args-b" },
      result: "Successfully replaced 1 occurrence in 'notes.md'",
      fileChangeSetId: SET_ID,
    });
    const { container } = renderWithSet(edit, capturedSet());
    // The per-call diff from the row's own args renders...
    expect(container.textContent).toContain("edit-args-b");
    // ...not the change set's captured net content...
    expect(container.textContent).not.toContain("captured-after");
    // ...still inside the shared pixel clamp (unchanged behavior).
    expect(container.querySelector(CLAMP)).not.toBeNull();
  });
});
