/**
 * FileReviewDock — the composer-docked decision surface for the newest
 * turn's undecided file reviews (`FileReviewSet`s from the session's fold).
 * These tests cover the dock's own responsibilities: emptiness, binding each
 * set's id into the decision, each set's captured bytes threaded to its card
 * (its provenance badge), error threading, the defensive multi-set stack,
 * and the height-capped scroll container. Decision-case behavior lives in
 * the FileReviewCard suite — the dock renders the same card in list mode.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  FileCaptureClass,
  FileChangeKind,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewSet } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { FileReviewDock } from "../FileReviewDock";

function review(id: string, paths: string[]): FileReviewSet {
  return {
    changeSetId: id,
    runId: "run_1",
    aggregateDigest: `agg-${id}`,
    files: paths.map((path) => ({
      fileChangeId: `${id}:${path}`,
      path,
      previousPath: "",
      change: "modified",
      digest: `d-${path}`,
      linesAdded: 1,
      linesRemoved: 0,
      reviewable: "complete",
      state: "undecided",
      decidedBy: "",
    })),
    decisions: [],
    reconciles: [],
    undecided: true,
    processedAt: "",
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={{ run: { get: vi.fn() } } as never}>{children}</StigmerContext.Provider>;
}

const show = (dock: ReactElement) => render(dock, { wrapper: Providers });

afterEach(() => {
  cleanup();
});

describe("FileReviewDock", () => {
  it("renders nothing when no sets are undecided", () => {
    const { container } = show(<FileReviewDock fileReviewSets={[]} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an interactive decision bar for an undecided set, in list mode", () => {
    show(<FileReviewDock fileReviewSets={[review("cs-1", ["src/a.ts"])]} onSubmit={() => {}} />);
    expect(screen.getByText("Review file changes")).toBeTruthy();
    expect(document.querySelector('[data-cursor-target="file-review-approve"]')).toBeTruthy();
    expect(document.querySelector('[data-cursor-target="file-review-reject"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeNull();
    expect(document.querySelector('[data-cursor-target="file-review-list-row"]')).toBeTruthy();
  });

  it("binds each set's id into the card-level decision", () => {
    const onSubmit = vi.fn();
    show(<FileReviewDock fileReviewSets={[review("cs-1", ["src/a.ts"])]} onSubmit={onSubmit} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-cursor-target="file-review-approve"]')!);
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "keep", {
      scope: "change_set",
      expectedDigest: "agg-cs-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("hands each card its set's captured bytes", () => {
    const capture = create(FileChangeSetSchema, {
      id: "cs-1",
      changes: [
        create(CapturedFileChangeSchema, {
          id: "cs-1:.env.local",
          pathAfter: ".env.local",
          kind: FileChangeKind.MODIFY,
          captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
        }),
      ],
    });
    show(
      <FileReviewDock
        fileReviewSets={[review("cs-1", [".env.local"])]}
        captures={new Map([["cs-1", capture]])}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("gitignored")).toBeTruthy();
  });

  it("threads a keyed decision error to the failed set's card", () => {
    show(
      <FileReviewDock
        fileReviewSets={[review("cs-1", ["src/a.ts"])]}
        onSubmit={() => {}}
        decisionErrors={new Map([["cs-1", new Error("digest mismatch")]])}
      />,
    );
    const err = screen.getByText(/Couldn.t submit decision — digest mismatch/);
    expect(err.getAttribute("data-cursor-target")).toBe("file-review-error");
  });

  it("stacks multiple undecided sets — none is ever dropped", () => {
    show(<FileReviewDock fileReviewSets={[review("cs-1", ["a.ts"]), review("cs-2", ["b.ts"])]} onSubmit={() => {}} />);
    expect(screen.getAllByText("Review file changes")).toHaveLength(2);
  });

  it("caps the dock's height with an internal scroll container", () => {
    const { container } = show(<FileReviewDock fileReviewSets={[review("cs-1", ["a.ts", "b.ts"])]} onSubmit={() => {}} />);
    const scroller = container.querySelector('[data-cursor-target="file-review-dock"]')!.firstElementChild!;
    expect(scroller.className).toContain("stg:overflow-y-auto");
    expect(scroller.className).toContain("max-h-");
  });
});
