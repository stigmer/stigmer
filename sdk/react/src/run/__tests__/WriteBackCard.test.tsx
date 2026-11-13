/**
 * WriteBackCard — phase-honest rendering of a workspace write-back record
 * as a card: the repository and its status pill, the branch as a tag with
 * its copy control and base, then the pull request link and the change
 * counts.
 *
 * The high-stakes matrix is the phase: each phase reads in a truthful
 * word on the right pill, FAILED errors are destructive, and a PUSHED
 * record carrying a PR error renders it as a degraded notice with the
 * branch info intact (the branch IS live).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkspaceWriteBackSchema,
  WorkspaceWriteBackPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";
import { WriteBackCard } from "../WriteBackCard";

function makeWriteBack(overrides: Record<string, unknown> = {}) {
  return create(WorkspaceWriteBackSchema, {
    workspaceEntryName: "acme/api",
    branchName: "stigmer/ses-01test",
    baseBranch: "main",
    commitSha: "abc123",
    diffSummary: " 2 files changed, 10 insertions(+), 3 deletions(-)",
    phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    pullRequestUrl: "https://github.com/acme/api/pull/12",
    pullRequestNumber: 12,
    ...overrides,
  });
}

afterEach(() => cleanup());

describe("WriteBackCard", () => {
  it("renders the name, the open pull request pill, the branch tag, the PR link and parsed stats for a PR_CREATED record", () => {
    render(<WriteBackCard writeBack={makeWriteBack()} />);

    expect(screen.getByText("acme/api")).toBeTruthy();
    const pill = screen.getByText("Pull request open");
    expect(pill.className).toContain("--stgm-status-ready");

    const link = screen.getByRole("link", { name: /pull request #12 on github/i });
    expect(link.textContent).toBe("#12 on GitHub");
    expect(link.getAttribute("href")).toBe("https://github.com/acme/api/pull/12");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");

    // The branch is a mono tag, with its base said in words.
    const branch = screen.getByText("stigmer/ses-01test");
    expect(branch.closest(".stg\\:font-mono")).toBeTruthy();
    expect(screen.getByText("into main")).toBeTruthy();

    // The --stat summary line renders structured, not as raw mono text.
    expect(screen.getByText("2 files changed")).toBeTruthy();
    expect(screen.getByText("+10 additions")).toBeTruthy();
    expect(screen.getByText("-3 deletions")).toBeTruthy();
  });

  it("draws no change counts for a record with no --stat summary", () => {
    render(<WriteBackCard writeBack={makeWriteBack({ diffSummary: "" })} />);
    expect(screen.queryByText(/files? changed/)).toBeNull();
    expect(screen.getByText("Pull request open")).toBeTruthy();
  });

  it("falls back to the raw trailing --stat line when the summary is unparseable", () => {
    render(
      <WriteBackCard
        writeBack={makeWriteBack({ diffSummary: " something unexpected" })}
      />,
    );
    expect(screen.getByText("something unexpected")).toBeTruthy();
  });

  // Single-entry sessions can write back under an empty entry name (the
  // runner's resolveEntry convention) — the header must never be blank.
  it("derives the header from the PR URL when the entry name is empty", () => {
    render(
      <WriteBackCard writeBack={makeWriteBack({ workspaceEntryName: "" })} />,
    );
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(
      screen.getByRole("article", { name: "Write-back: acme/api" }),
    ).toBeTruthy();
  });

  it("pills each phase in a truthful word on the right status", () => {
    const cases = [
      [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_COMMITTED, "Committed", "--stgm-status-pending"],
      [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED, "Pushed", "--stgm-status-ready"],
      [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED, "Pull request open", "--stgm-status-ready"],
      [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED, "Failed", "--stgm-status-failed"],
    ] as const;
    for (const [phase, word, token] of cases) {
      const hasPR = phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED;
      render(
        <WriteBackCard
          writeBack={makeWriteBack({
            phase,
            pullRequestUrl: hasPR ? "https://github.com/acme/api/pull/12" : "",
            pullRequestNumber: hasPR ? 12 : 0,
          })}
        />,
      );
      expect(screen.getByText(word).className, word).toContain(token);
      cleanup();
    }
  });

  it("names the pull request's host, and falls back to words when it has no number", () => {
    render(
      <WriteBackCard
        writeBack={makeWriteBack({
          pullRequestUrl: "https://gitlab.example.com/acme/api/pull/7",
          pullRequestNumber: 0,
        })}
      />,
    );
    expect(screen.getByRole("link").textContent).toBe("Pull request on gitlab.example.com");
  });

  it("copies the branch name with transient feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<WriteBackCard writeBack={makeWriteBack()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /copy branch name/i }),
    );

    expect(writeText).toHaveBeenCalledWith("stigmer/ses-01test");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy(),
    );
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
    expect(error.className).toContain("stg:text-destructive");
    const pill = screen.getByText("Failed");
    expect(pill.className).toContain("--stgm-status-failed");
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
    expect(screen.getByText("Pushed").className).toContain("--stgm-status-ready");
    const notice = screen.getByText(/no github token/i);
    expect(notice.className).toContain("stg:text-status-degraded");
    expect(notice.className).not.toContain("stg:text-destructive");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders no error block for a clean record", () => {
    const { container } = render(<WriteBackCard writeBack={makeWriteBack()} />);
    expect(container.querySelector(".bg-destructive-subtle")).toBeNull();
    expect(container.querySelector(".bg-status-degraded-subtle")).toBeNull();
  });
});
