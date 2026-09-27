// Unit arms for the judge's subject.
// Domain: conformance benchmark.
//
// Pinned: the subject opens with its fixed heading, so it is never a
// `${ … }` expression; it carries each turn's message and final reply, a
// failed or silent turn said as such, the files changed, each named file's
// content in a fence its own backticks cannot close (or its absence), and
// the checks; it never names a harness, a model or a tool; a runaway file is
// cut with the cut stated.
import { describe, expect, it } from "vitest";
import { composeSubject, FILE_CONTENT_LIMIT_BYTES, SUBJECT_HEADING } from "../subject";

describe("composeSubject", () => {
  const subject = composeSubject({
    turns: [
      { prompt: "Make 90s work.", reply: "Done: seconds round down.", outcome: "completed" },
      { prompt: "Run the tests.", reply: "", outcome: "completed" },
      { prompt: "And again?", reply: "", outcome: "failed" },
    ],
    filesChanged: [
      { path: "duration/duration.go", change: "modified" },
      { path: "NOTES.md", change: "added" },
    ],
    namedFiles: [
      { path: "duration/duration.go", content: "package duration\n// ```not a fence end```\n" },
      { path: "gone.txt", content: null },
    ],
    checks: [{ name: "go_test", outcome: "passed", detail: "go test ./...: exit 0\nok  example.com/orders-sync/duration" }],
  });

  it("opens with the fixed heading and is never an expression", () => {
    expect(subject.startsWith(`${SUBJECT_HEADING}\n`)).toBe(true);
    expect(subject.startsWith("${")).toBe(false);
  });

  it("carries every turn, a silent and a failed turn said as such", () => {
    expect(subject).toContain("## Turn 1\n\n### The user\n\nMake 90s work.\n\n### The agent's final reply\n\nDone: seconds round down.");
    expect(subject).toContain("(The agent gave no text reply.)");
    expect(subject).toContain("(No reply: the turn ended failed.)");
  });

  it("carries the changed files, each named file in a fence its content cannot close, an absent file, and the checks", () => {
    expect(subject).toContain("- modified: duration/duration.go\n- added: NOTES.md");
    expect(subject).toContain("## duration/duration.go, after the last turn\n\n````\npackage duration\n// ```not a fence end```\n````");
    expect(subject).toContain("## gone.txt, after the last turn\n\n(This file does not exist after the last turn.)");
    expect(subject).toContain("### go_test: passed\n\n```\ngo test ./...: exit 0");
  });

  it("never names a harness, a model or a tool", () => {
    for (const word of ["cursor", "native", "deep-agent", "claude", "sonnet", "lookup_order", "read_file", "write_file"]) {
      expect(subject.toLowerCase(), word).not.toContain(word);
    }
  });

  it("says None when nothing changed, and cuts a runaway file with the cut stated", () => {
    const big = "x".repeat(FILE_CONTENT_LIMIT_BYTES + 10);
    const cut = composeSubject({ turns: [], filesChanged: [], namedFiles: [{ path: "big.txt", content: big }], checks: [] });
    expect(cut).toContain("## Files that differ from the starting state\n\nNone.");
    expect(cut).toContain("(cut here: 10 more bytes)");
    expect(cut).not.toContain("## Checks");
  });
});
