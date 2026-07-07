/**
 * write-back-utils — the structured seam between the runner's raw
 * `git diff --stat` text and the presentation layer. The parser must be
 * strict: wrong numbers are worse than the raw-text fallback, so anything
 * that is not the exact trailing summary line returns null.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { WorkspaceWriteBackSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import {
  parseDiffStatSummary,
  trailingDiffStatLine,
  writeBackDisplayName,
} from "../write-back-utils";

describe("parseDiffStatSummary", () => {
  it("parses the full three-segment summary line", () => {
    expect(
      parseDiffStatSummary(" 3 files changed, 42 insertions(+), 7 deletions(-)"),
    ).toEqual({ filesChanged: 3, insertions: 42, deletions: 7 });
  });

  it("parses singular forms (1 file / 1 insertion / 1 deletion)", () => {
    expect(
      parseDiffStatSummary(" 1 file changed, 1 insertion(+), 1 deletion(-)"),
    ).toEqual({ filesChanged: 1, insertions: 1, deletions: 1 });
  });

  it("parses an insertions-only summary (deletions segment omitted by git)", () => {
    expect(parseDiffStatSummary(" 1 file changed, 55 insertions(+)")).toEqual({
      filesChanged: 1,
      insertions: 55,
      deletions: 0,
    });
  });

  it("parses a deletions-only summary (insertions segment omitted by git)", () => {
    expect(parseDiffStatSummary(" 2 files changed, 9 deletions(-)")).toEqual({
      filesChanged: 2,
      insertions: 0,
      deletions: 9,
    });
  });

  it("parses a bare 'N file changed' summary with no count segments", () => {
    expect(parseDiffStatSummary(" 1 file changed")).toEqual({
      filesChanged: 1,
      insertions: 0,
      deletions: 0,
    });
  });

  it("reads the trailing line of a full --stat block, ignoring per-file lines", () => {
    const stat = [
      " notes.md                    | 55 ++++++++++",
      " src/{old.ts => new.ts}      |  5 +-",
      " 2 files changed, 58 insertions(+), 2 deletions(-)",
    ].join("\n");
    expect(parseDiffStatSummary(stat)).toEqual({
      filesChanged: 2,
      insertions: 58,
      deletions: 2,
    });
  });

  it("tolerates trailing whitespace/newlines after the summary line", () => {
    expect(parseDiffStatSummary(" 1 file changed, 2 insertions(+)\n\n")).toEqual({
      filesChanged: 1,
      insertions: 2,
      deletions: 0,
    });
  });

  it("returns null for an empty or blank string", () => {
    expect(parseDiffStatSummary("")).toBeNull();
    expect(parseDiffStatSummary("  \n  ")).toBeNull();
  });

  it("returns null for unrecognized text rather than guessing", () => {
    expect(parseDiffStatSummary(" changed")).toBeNull();
    expect(parseDiffStatSummary("nothing to see here")).toBeNull();
    // A per-file line with no trailing summary must not parse.
    expect(parseDiffStatSummary(" notes.md | 55 +++")).toBeNull();
  });
});

describe("trailingDiffStatLine", () => {
  it("returns the last non-empty line, trimmed", () => {
    expect(trailingDiffStatLine(" a.ts | 1 +\n 1 file changed \n\n")).toBe(
      "1 file changed",
    );
  });

  it("returns null for blank input", () => {
    expect(trailingDiffStatLine("")).toBeNull();
    expect(trailingDiffStatLine(" \n ")).toBeNull();
  });
});

describe("writeBackDisplayName", () => {
  it("prefers the configured workspace entry name", () => {
    const wb = create(WorkspaceWriteBackSchema, {
      workspaceEntryName: "acme/api",
      pullRequestUrl: "https://github.com/other/repo/pull/1",
    });
    expect(writeBackDisplayName(wb)).toBe("acme/api");
  });

  // Single-entry sessions can write back under an empty entry name (the
  // runner's resolveEntry convention) — the repo identity from the PR URL is
  // the next-most-honest label.
  it("derives owner/repo from the PR URL when the entry name is empty", () => {
    const wb = create(WorkspaceWriteBackSchema, {
      workspaceEntryName: "",
      pullRequestUrl: "https://github.com/acme/my-app/pull/42",
    });
    expect(writeBackDisplayName(wb)).toBe("acme/my-app");
  });

  it("falls back to the generic label when neither name nor PR URL exists", () => {
    const wb = create(WorkspaceWriteBackSchema, {
      workspaceEntryName: "",
      pullRequestUrl: "",
    });
    expect(writeBackDisplayName(wb)).toBe("Workspace");
  });

  it("does not mis-parse a non-PR URL", () => {
    const wb = create(WorkspaceWriteBackSchema, {
      workspaceEntryName: "",
      pullRequestUrl: "https://github.com/acme/my-app",
    });
    expect(writeBackDisplayName(wb)).toBe("Workspace");
  });
});
