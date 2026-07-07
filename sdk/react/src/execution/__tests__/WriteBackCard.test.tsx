/**
 * WriteBackCard — phase-honest rendering of a workspace write-back record.
 * The high-stakes matrix is the error treatment: FAILED errors are
 * destructive, while a PUSHED record carrying a PR error renders it as a
 * degraded notice with the branch info intact (the branch IS live).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkspaceWriteBackSchema,
  WorkspaceWriteBackPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { WriteBackCard } from "../WriteBackCard";

function makeWriteBack(overrides: Record<string, unknown> = {}) {
  return create(WorkspaceWriteBackSchema, {
    workspaceEntryName: "acme/api",
    branchName: "stigmer/ses-01test",
    baseBranch: "main",
    commitSha: "abc123",
    diffSummary: " 2 files changed",
    phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    pullRequestUrl: "https://github.com/acme/api/pull/12",
    pullRequestNumber: 12,
    ...overrides,
  });
}

afterEach(() => cleanup());

describe("WriteBackCard", () => {
  it("renders branch, diff summary, and the PR link for a PR_CREATED record", () => {
    render(<WriteBackCard writeBack={makeWriteBack()} />);
    expect(screen.getByText("stigmer/ses-01test")).toBeTruthy();
    expect(screen.getByText(/2 files changed/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /view pr #12/i });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/api/pull/12");
    expect(screen.getByText("PR Created")).toBeTruthy();
  });

  it("renders a FAILED record's error destructively", () => {
    render(
      <WriteBackCard
        writeBack={makeWriteBack({
          phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
          error: "git push failed: connection reset",
          pullRequestUrl: "",
          pullRequestNumber: 0,
        })}
      />,
    );
    const error = screen.getByText(/git push failed/);
    expect(error.className).toContain("text-destructive");
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders a PUSHED record's PR error as a degraded notice, branch info intact", () => {
    render(
      <WriteBackCard
        writeBack={makeWriteBack({
          phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED,
          error: "No GitHub token available to open a pull request.",
          pullRequestUrl: "",
          pullRequestNumber: 0,
        })}
      />,
    );
    // The branch is live — never styled as a failure.
    expect(screen.getByText("stigmer/ses-01test")).toBeTruthy();
    expect(screen.getByText("Pushed")).toBeTruthy();
    const notice = screen.getByText(/no github token/i);
    expect(notice.className).toContain("text-status-degraded");
    expect(notice.className).not.toContain("text-destructive");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders no error block for a clean record", () => {
    const { container } = render(<WriteBackCard writeBack={makeWriteBack()} />);
    expect(container.querySelector(".bg-destructive-subtle")).toBeNull();
    expect(container.querySelector(".bg-status-degraded-subtle")).toBeNull();
  });
});
