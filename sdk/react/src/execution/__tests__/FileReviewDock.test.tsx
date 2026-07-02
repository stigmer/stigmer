/**
 * FileReviewDock — the composer-docked decision surface for pending file
 * reviews. These tests cover the dock's own responsibilities: emptiness,
 * per-set submit binding, error threading, the defensive multi-set stack, and
 * the height-capped scroll container. Decision-case behavior (per-file
 * verdicts, binary acknowledgment, blocked files) lives in the FileReviewCard
 * suites — the dock renders the same card in list mode.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  DiffCompleteness,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { FileReviewDock } from "../FileReviewDock";

function changeSet(id: string, paths: string[]): FileChangeSet {
  return create(FileChangeSetSchema, {
    id,
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: `agg-${id}`,
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: paths.map((path) =>
      create(CapturedFileChangeSchema, {
        id: `${id}:${path}`,
        pathBefore: path,
        pathAfter: path,
        kind: FileChangeKind.MODIFY,
        before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
        fileDigest: `d-${path}`,
        diffComplete: true,
      }),
    ),
  });
}

afterEach(() => {
  cleanup();
});

describe("FileReviewDock", () => {
  it("renders nothing when no sets are pending", () => {
    const { container } = render(
      <FileReviewDock changeSets={[]} onSubmit={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an interactive decision bar for a pending set, in list mode", () => {
    render(
      <FileReviewDock changeSets={[changeSet("cs-1", ["src/a.ts"])]} onSubmit={() => {}} />,
    );
    expect(screen.getByText("Review file changes")).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-approve"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-cursor-target="file-review-reject"]'),
    ).toBeTruthy();
    // List mode: the expander reveals the file inventory, never a diff — the
    // transcript's stamped edit rows own the diffs.
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(document.querySelector('[data-cursor-target="file-diff"]')).toBeNull();
    expect(
      document.querySelector('[data-cursor-target="file-review-list-row"]'),
    ).toBeTruthy();
  });

  it("binds each set's id into the card-level submit", () => {
    const onSubmit = vi.fn();
    render(
      <FileReviewDock changeSets={[changeSet("cs-1", ["src/a.ts"])]} onSubmit={onSubmit} />,
    );
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cursor-target="file-review-approve"]',
      )!,
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-cs-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("threads a keyed decision error to the failed set's card", () => {
    const decisionErrors = new Map([["cs-1", new Error("digest mismatch")]]);
    render(
      <FileReviewDock
        changeSets={[changeSet("cs-1", ["src/a.ts"])]}
        onSubmit={() => {}}
        decisionErrors={decisionErrors}
      />,
    );
    const err = screen.getByText(/Couldn.t submit decision — digest mismatch/);
    expect(err.getAttribute("data-cursor-target")).toBe("file-review-error");
  });

  it("stacks multiple pending sets — none is ever dropped", () => {
    render(
      <FileReviewDock
        changeSets={[changeSet("cs-1", ["a.ts"]), changeSet("cs-2", ["b.ts"])]}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getAllByText("Review file changes")).toHaveLength(2);
  });

  it("caps the dock's height with an internal scroll container", () => {
    // A set that starts expanded (many files) must scroll inside the dock
    // rather than growing the fixed strip past the viewport.
    const { container } = render(
      <FileReviewDock changeSets={[changeSet("cs-1", ["a.ts", "b.ts"])]} onSubmit={() => {}} />,
    );
    const dock = container.querySelector('[data-cursor-target="file-review-dock"]');
    expect(dock).toBeTruthy();
    const scroller = dock!.firstElementChild!;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("max-h-");
  });
});
