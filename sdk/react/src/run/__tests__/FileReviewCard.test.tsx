/**
 * Pins the file-review card (../FileReviewCard.tsx) over a turn's review as
 * the session's events fold it (`FileReviewSet`): the bar's summary and its
 * whole-set Keep/Discard bound to the aggregate digest; per-file Keep/Discard
 * bound to each file's digest, with each file's state as the selected option
 * and review progress; in-flight and failed decisions per control; binary
 * files kept consciously ("Keep anyway", "Keep all"), unavailable files
 * discard-only with honest copy wired by aria-describedby; the settled
 * record's verdicts (kept, discarded, undo failed, not reviewed) and policy
 * keeps; the compact list mode (counts, kind letters, renames); and the diff
 * bytes: from the caller's capture (with its provenance badge), or read from
 * the run on demand, saying so while loading, on failure, or when absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileContentSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  FileCaptureClass,
  FileChangeKind,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewDecision, FileReviewFile, FileReviewSet } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import type { UseFileChangeContentReturn } from "@stigmer/react-core";

// FileReviewCard renders FileChangeDiff (per file), which pulls in the
// offload-resolving content hook transitively. Mock it so the diff path
// renders without stored-content fetch context, then import the component.
let mockReturn: UseFileChangeContentReturn;
vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useFileChangeContent: () => mockReturn,
}));

const { FileReviewCard } = await import("../FileReviewCard");
const { fileDecisionKey } = await import("@stigmer/react-core");

const runGet = vi.fn();

beforeEach(() => {
  mockReturn = {
    beforeText: "old\n",
    afterText: "new\n",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
  };
  runGet.mockReset();
});
afterEach(cleanup);

const noop = () => {};

function Providers({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={{ run: { get: runGet } } as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

function show(card: ReactElement) {
  return render(card, { wrapper: Providers });
}

/** Open the bar's expander ("Review" for live diffs, "Show" for a record). */
function expandCard() {
  fireEvent.click(screen.getByRole("button", { name: /^(Review|Show)$/ }));
}

function file(id: string, path: string, overrides: Partial<FileReviewFile> = {}): FileReviewFile {
  return {
    fileChangeId: id,
    path,
    previousPath: "",
    change: "modified",
    digest: `d-${id}`,
    linesAdded: 0,
    linesRemoved: 0,
    reviewable: "complete",
    state: "undecided",
    decidedBy: "",
    ...overrides,
  };
}

function decision(origin: string): FileReviewDecision {
  return {
    id: `dec-${origin}`,
    scope: "change_set",
    fileChangeId: "",
    action: "keep",
    expectedDigest: "agg-1",
    origin,
    reason: "",
    processedAt: "",
  };
}

function review(files: FileReviewFile[], decisions: FileReviewDecision[] = []): FileReviewSet {
  return {
    changeSetId: "cs-1",
    runId: "run_1",
    aggregateDigest: "agg-1",
    files,
    decisions,
    reconciles: [],
    undecided: files.some((f) => f.state === "undecided"),
    processedAt: "",
  };
}

/** One complete file: the whole set IS the file, so no per-file controls. */
const single = (overrides: Partial<FileReviewFile> = {}) => review([file("fc1", "src/a.ts", overrides)]);

/** Two files, each with its own Keep/Discard control. */
const pair = (a: Partial<FileReviewFile> = {}, b: Partial<FileReviewFile> = {}) =>
  review([file("fc1", "src/a.ts", a), file("fc2", "src/b.ts", b)]);

function capture(changes: Array<{ id: string; path: string; captureClass?: FileCaptureClass }>): FileChangeSet {
  return create(FileChangeSetSchema, {
    id: "cs-1",
    changes: changes.map((c) =>
      create(CapturedFileChangeSchema, {
        id: c.id,
        pathBefore: c.path,
        pathAfter: c.path,
        kind: FileChangeKind.MODIFY,
        captureClass: c.captureClass ?? FileCaptureClass.GIT_TRACKED,
        before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
        diffComplete: true,
      }),
    ),
  });
}

const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLButtonElement;

describe("FileReviewCard", () => {
  describe("single-file set (bulk only)", () => {
    it("renders the summary and the singular bulk controls, no per-file radios", () => {
      show(<FileReviewCard fileReviewSet={single()} capture={null} onSubmit={noop} />);
      expect(screen.getByText(/awaiting review/i)).toBeTruthy();
      expect(screen.getByRole("alert", { name: /review 1 file change/i })).toBeTruthy();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });

    it("keeps or undoes the whole set bound to the aggregate digest", () => {
      const onSubmit = vi.fn();
      show(<FileReviewCard fileReviewSet={single()} capture={null} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onSubmit.mock.calls).toEqual([
        ["keep", { scope: "change_set", expectedDigest: "agg-1", acknowledgeUnreviewable: false }],
        ["undo", { scope: "change_set", expectedDigest: "agg-1", acknowledgeUnreviewable: false }],
      ]);
    });

    it("decides a single binary file per file: an acknowledged Keep anyway, and Discard", () => {
      const onSubmit = vi.fn();
      show(
        <FileReviewCard
          fileReviewSet={review([file("fc-img", "img.png", { reviewable: "binary" })])}
          capture={null}
          onSubmit={onSubmit}
        />,
      );
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      fireEvent.click(radio(/Keep img.png anyway/i));
      fireEvent.click(radio("Discard img.png"));
      expect(onSubmit.mock.calls).toEqual([
        ["keep", { scope: "file", fileChangeId: "fc-img", expectedDigest: "d-fc-img", acknowledgeUnreviewable: true }],
        ["undo", { scope: "file", fileChangeId: "fc-img", expectedDigest: "d-fc-img", acknowledgeUnreviewable: false }],
      ]);
    });
  });

  describe("multi-file set (per-file controls)", () => {
    it("starts a complete multi-file set collapsed in diff mode", () => {
      show(<FileReviewCard fileReviewSet={pair()} capture={null} onSubmit={noop} />);
      expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeNull();
      expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    });

    it("renders a Keep/Discard radio per file plus the whole-set controls, and decides each file by its digest", () => {
      const onSubmit = vi.fn();
      show(<FileReviewCard fileReviewSet={pair()} capture={null} onSubmit={onSubmit} />);
      expandCard();
      expect(screen.getByRole("button", { name: "Approve all" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject all" })).toBeTruthy();
      fireEvent.click(radio("Keep src/a.ts"));
      fireEvent.click(radio("Discard src/b.ts"));
      expect(onSubmit.mock.calls).toEqual([
        ["keep", { scope: "file", fileChangeId: "fc1", expectedDigest: "d-fc1", acknowledgeUnreviewable: false }],
        ["undo", { scope: "file", fileChangeId: "fc2", expectedDigest: "d-fc2", acknowledgeUnreviewable: false }],
      ]);
    });

    it("reads each file's state as its selected option, with progress and 'remaining' labels", () => {
      const onSubmit = vi.fn();
      show(<FileReviewCard fileReviewSet={pair({ state: "kept" })} capture={null} onSubmit={onSubmit} />);
      expect(radio("Keep src/a.ts").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByText(/1 of 2 files reviewed/i)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Approve remaining" }));
      expect(screen.getByRole("button", { name: "Reject remaining" })).toBeTruthy();
      expect(onSubmit).toHaveBeenCalledWith("keep", {
        scope: "change_set",
        expectedDigest: "agg-1",
        acknowledgeUnreviewable: false,
      });
    });

    it("reads an undone (or undoing) file as Discard", () => {
      show(<FileReviewCard fileReviewSet={pair({ state: "undoing" }, { state: "undone" })} capture={null} onSubmit={noop} />);
      expect(radio("Discard src/a.ts").getAttribute("aria-checked")).toBe("true");
      expect(radio("Discard src/b.ts").getAttribute("aria-checked")).toBe("true");
      expect(radio("Keep src/a.ts").getAttribute("aria-checked")).toBe("false");
    });

    it("disables a file's options while its decision is in flight, and the bulk while the set's is", () => {
      show(
        <FileReviewCard
          fileReviewSet={pair()}
          capture={null}
          onSubmit={noop}
          submittingDecisionKeys={new Set([fileDecisionKey("cs-1", "fc1")])}
        />,
      );
      expandCard();
      expect(radio("Keep src/a.ts").disabled).toBe(true);
      expect(radio("Discard src/a.ts").disabled).toBe(true);
      expect(radio("Keep src/b.ts").disabled).toBe(false);
      cleanup();
      show(
        <FileReviewCard fileReviewSet={pair()} capture={null} onSubmit={noop} submittingDecisionKeys={new Set(["cs-1"])} />,
      );
      expect((screen.getByRole("button", { name: "Approve all" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("decision errors (in-card surfacing)", () => {
    it("renders no error element by default", () => {
      const { container } = show(<FileReviewCard fileReviewSet={single()} capture={null} onSubmit={noop} />);
      expect(container.querySelector('[data-cursor-target="file-review-error"]')).toBeNull();
      expect(container.querySelector('[data-cursor-target="file-review-file-error"]')).toBeNull();
    });

    it("surfaces a whole-set failure beside the bulk buttons", () => {
      show(
        <FileReviewCard
          fileReviewSet={single()}
          capture={null}
          onSubmit={noop}
          decisionErrors={new Map([["cs-1", new Error("digest mismatch")]])}
        />,
      );
      expect(
        screen.getByText(/Couldn.t submit decision — digest mismatch/).getAttribute("data-cursor-target"),
      ).toBe("file-review-error");
    });

    it("surfaces a per-file failure under the right file row only", () => {
      show(
        <FileReviewCard
          fileReviewSet={pair()}
          capture={null}
          onSubmit={noop}
          decisionErrors={new Map([[fileDecisionKey("cs-1", "fc1"), new Error("network down")]])}
        />,
      );
      expandCard();
      const errors = screen.getAllByText(/Couldn.t save/);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.textContent).toMatch(/network down/);
      expect(screen.queryByText(/Couldn.t submit decision/)).toBeNull();
    });
  });

  describe("blocked / partial states", () => {
    it("offers 'Keep all' and per-file 'Keep anyway' in a binary-only set, acknowledging the binaries", () => {
      const onSubmit = vi.fn();
      show(
        <FileReviewCard
          fileReviewSet={review([file("fc1", "src/a.ts"), file("fc2", "img.png", { reviewable: "binary" })])}
          capture={null}
          onSubmit={onSubmit}
        />,
      );
      expect(screen.getByText(/Binary file.*no text diff to review/i)).toBeTruthy();
      expect(screen.getByText(/Keep all keeps every file as-is/i)).toBeTruthy();
      expect(radio("Keep src/a.ts").disabled).toBe(false);
      fireEvent.click(radio(/Keep img.png anyway/i));
      fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
      expect(onSubmit.mock.calls).toEqual([
        ["keep", { scope: "file", fileChangeId: "fc2", expectedDigest: "d-fc2", acknowledgeUnreviewable: true }],
        ["keep", { scope: "change_set", expectedDigest: "agg-1", acknowledgeUnreviewable: true }],
      ]);
    });

    it("leaves an unavailable file discard-only, its reason wired by aria-describedby, and blocks the whole-set keep", () => {
      show(<FileReviewCard fileReviewSet={pair({}, { reviewable: "partial" })} capture={null} onSubmit={noop} />);
      expect(radio("Keep src/b.ts").disabled).toBe(true);
      expect(radio("Discard src/b.ts").disabled).toBe(false);
      expect(radio("Keep src/a.ts").disabled).toBe(false);
      expect((screen.getByRole("button", { name: "Approve all" }) as HTMLButtonElement).disabled).toBe(true);
      const note = screen.getByText(/full diff isn.t available to review/i);
      const group = screen.getByRole("radiogroup", { name: "Decision for src/b.ts" });
      expect(note.getAttribute("id")).toBe(group.getAttribute("aria-describedby"));
      expect(screen.getByRole("radiogroup", { name: "Decision for src/a.ts" }).getAttribute("aria-describedby")).toBeFalsy();
      expect(screen.getByText(/isn.t available to review, so the whole set/i)).toBeTruthy();
    });

    it("gives a secret-withheld file its own honest copy", () => {
      show(<FileReviewCard fileReviewSet={pair({}, { path: ".env", reviewable: "secret" })} capture={null} onSubmit={noop} />);
      expect(screen.getByText(/looks like a secret/i)).toBeTruthy();
      expect(screen.queryByText(/full diff isn.t available to review/i)).toBeNull();
    });

    it("explains a lone unavailable or binary file in the bar's copy", () => {
      show(<FileReviewCard fileReviewSet={single({ reviewable: "secret" })} capture={null} onSubmit={noop} />);
      expect(screen.getByText(/contents withheld/i)).toBeTruthy();
      expect(radio(/keep src\/a\.ts/i).disabled).toBe(true);
    });
  });

  describe("read-only settled card (interactive=false)", () => {
    it("shows a passive record with no decision controls, and needs no callback", () => {
      show(<FileReviewCard fileReviewSet={single()} capture={null} interactive={false} />);
      expect(screen.getByRole("group", { name: /1 file change/i })).toBeTruthy();
      expect(screen.getByText("File changes")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /approve|reject|keep/i })).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.getByText("1 file changed")).toBeTruthy();
    });

    it("renders each file's verdict and the one-line history", () => {
      show(
        <FileReviewCard
          fileReviewSet={review([
            file("fc1", "src/a.ts", { state: "kept" }),
            file("fc2", "src/b.ts", { state: "undone" }),
            file("fc3", "src/c.ts", { state: "undo_failed" }),
            file("fc4", "src/d.ts"),
          ])}
          capture={null}
          interactive={false}
        />,
      );
      expect(screen.getByText("1 kept · 1 discarded · 1 could not be put back · 1 not reviewed")).toBeTruthy();
      expandCard();
      expect(screen.getByText("Kept")).toBeTruthy();
      expect(screen.getByText("Discarded")).toBeTruthy();
      expect(screen.getByText("Undo failed")).toBeTruthy();
      expect(screen.getByText("Not reviewed")).toBeTruthy();
    });

    it("labels a policy keep as automatic — never as a person's review", () => {
      const kept = [file("fc1", "src/a.ts", { state: "kept" }), file("fc2", "src/b.ts", { state: "kept" })];
      show(<FileReviewCard fileReviewSet={review(kept, [decision("approved_command")])} capture={null} interactive={false} />);
      expect(screen.getByText("Kept automatically — produced by a command you approved")).toBeTruthy();
      cleanup();
      show(<FileReviewCard fileReviewSet={review(kept, [decision("eval_try")])} capture={null} interactive={false} />);
      expect(screen.getByText("Kept automatically — an eval's try keeps its edits")).toBeTruthy();
      cleanup();
      show(<FileReviewCard fileReviewSet={review(kept, [decision("person")])} capture={null} interactive={false} />);
      expect(screen.getByText("2 kept")).toBeTruthy();
    });
  });

  describe("diff bytes", () => {
    it("renders each file's diff and its capture provenance from the caller's capture", () => {
      show(
        <FileReviewCard
          fileReviewSet={single({ path: ".env.local" })}
          capture={capture([{ id: "fc1", path: ".env.local", captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED }])}
          onSubmit={noop}
        />,
      );
      expandCard();
      expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeTruthy();
      expect(screen.getByText("gitignored").getAttribute("aria-label")).toMatch(/ignored by git/i);
      expect(runGet).not.toHaveBeenCalled();
    });

    it("says the diff is unavailable when the capture holds no such file", () => {
      show(<FileReviewCard fileReviewSet={single()} capture={null} onSubmit={noop} />);
      expandCard();
      expect(screen.getByText("The diff isn't available.")).toBeTruthy();
    });

    it("reads the run on demand when no capture is given, saying so while it loads", async () => {
      let resolve!: (value: unknown) => void;
      runGet.mockReturnValue(new Promise((r) => (resolve = r)));
      show(<FileReviewCard fileReviewSet={single()} onSubmit={noop} />);
      expect(runGet).not.toHaveBeenCalled();
      expandCard();
      expect(runGet).toHaveBeenCalledWith("run_1");
      expect(screen.getByText("Loading the diff…")).toBeTruthy();
      resolve(create(RunSchema, { status: { fileChanges: [capture([{ id: "fc1", path: "src/a.ts" }])] } }));
      await waitFor(() => expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeTruthy());
    });

    it("says so when the run cannot be read", async () => {
      runGet.mockRejectedValue(new Error("down"));
      show(<FileReviewCard fileReviewSet={single()} onSubmit={noop} />);
      expandCard();
      expect(await screen.findByText("Couldn't load the diff.")).toBeTruthy();
    });

    it("shows a settled record's diffs and verdicts in diff mode", () => {
      show(
        <FileReviewCard
          fileReviewSet={single({ state: "kept" })}
          capture={capture([{ id: "fc1", path: "src/a.ts" }])}
          interactive={false}
        />,
      );
      expandCard();
      expect(screen.getByText("Kept")).toBeTruthy();
      expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeTruthy();
    });
  });

  // The session's dock and records pass showDiffs={false}: the transcript's
  // edit rows already show every diff, so the body is a compact file list
  // and the card is purely the decision surface.
  describe("list mode (showDiffs=false)", () => {
    it("starts a multi-file set expanded, with linked filename-first paths", () => {
      show(<FileReviewCard fileReviewSet={pair()} capture={null} onSubmit={noop} showDiffs={false} />);
      expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeNull();
      expect(document.querySelectorAll('[data-cursor-target="file-review-list-row"]')).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
      expect(screen.getByText("a.ts")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Copy path: src\/a\.ts/ })).toBeTruthy();
      expect(document.querySelector("[title]")).toBeNull();
    });

    it("keeps a single complete file collapsed behind the 'Files' expander", () => {
      show(<FileReviewCard fileReviewSet={single()} capture={null} onSubmit={noop} showDiffs={false} />);
      expect(document.querySelector('[data-cursor-target="file-review-list-row"]')).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Files" }));
      expect(document.querySelector('[data-cursor-target="file-review-list-row"]')).toBeTruthy();
    });

    it("shows per-file and aggregate +N −M, hiding a file's stat when it has no count", () => {
      show(
        <FileReviewCard
          fileReviewSet={pair({ linesAdded: 37, linesRemoved: 2 })}
          capture={null}
          onSubmit={noop}
          showDiffs={false}
        />,
      );
      const stats = document.querySelectorAll('[data-cursor-target="file-review-line-stats"]');
      expect(stats).toHaveLength(2);
      expect(screen.getAllByLabelText("37 added, 2 removed")).toHaveLength(2);
    });

    it("marks each file with its change-kind letter and shows a rename's source", () => {
      show(
        <FileReviewCard
          fileReviewSet={review([
            file("fc-add", "src/new.ts", { change: "added" }),
            file("fc-del", "src/old.ts", { change: "deleted" }),
            file("fc-ren", "src/new-name.ts", { change: "renamed", previousPath: "src/old-name.ts" }),
          ])}
          capture={capture([{ id: "fc-add", path: "src/new.ts", captureClass: FileCaptureClass.NON_GIT_CAS }])}
          onSubmit={noop}
          showDiffs={false}
        />,
      );
      expect(screen.getByLabelText("added").textContent).toBe("A");
      expect(screen.getByLabelText("deleted").textContent).toBe("D");
      expect(screen.getByText(/src\/old-name\.ts/)).toBeTruthy();
      expect(screen.getByText("outside git")).toBeTruthy();
    });

    it("decides from a list row and from the bar", () => {
      const onSubmit = vi.fn();
      show(<FileReviewCard fileReviewSet={pair()} capture={null} onSubmit={onSubmit} showDiffs={false} />);
      fireEvent.click(radio("Keep src/a.ts"));
      fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
      expect(onSubmit.mock.calls.map(([action, options]) => [action, options.scope])).toEqual([
        ["keep", "file"],
        ["keep", "change_set"],
      ]);
    });

    it("keeps the binary reason note as the per-file context", () => {
      show(
        <FileReviewCard
          fileReviewSet={review([file("fc-bin", "logo.png", { reviewable: "binary" })])}
          capture={null}
          onSubmit={noop}
          showDiffs={false}
        />,
      );
      expect(document.querySelector('[data-cursor-target="file-review-block-reason"]')?.textContent).toMatch(/binary file/i);
    });

    it("renders the settled record as verdict-badged list rows", () => {
      show(
        <FileReviewCard
          fileReviewSet={pair({ state: "kept" }, { state: "undone" })}
          capture={null}
          interactive={false}
          showDiffs={false}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show" }));
      expect(screen.getByText("Kept")).toBeTruthy();
      expect(screen.getByText("Discarded")).toBeTruthy();
      expect(screen.queryByRole("radio")).toBeNull();
    });
  });
});
