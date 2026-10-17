// Pins the mid-turn "N files changing…" strip (visibility, the compact
// summary, the Ctrl+O per-file list) and the rename-aware path rule the
// strip and the review surfaces share.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type {
  FileChangeProgress,
  FileChangeProgressEntry,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FileChangeProgressBar } from "../components/FileChangeProgressBar.js";
import { fileDisplayPath, progressEntryDisplayPath } from "../file-review.js";

// --- fixtures -------------------------------------------------------------

interface EntryOpts {
  readonly pathBefore?: string;
  readonly pathAfter?: string;
  readonly kind?: FileChangeKind;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

function makeEntry(opts: EntryOpts): FileChangeProgressEntry {
  return create(FileChangeProgressEntrySchema, {
    pathBefore: opts.pathBefore ?? "",
    pathAfter: opts.pathAfter ?? "",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    linesAdded: opts.linesAdded ?? 0,
    linesRemoved: opts.linesRemoved ?? 0,
  });
}

interface ProgressOpts {
  readonly filesChanged?: number;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly entries?: FileChangeProgressEntry[];
}

function makeProgress(opts: ProgressOpts): FileChangeProgress {
  const entries = opts.entries ?? [];
  return create(FileChangeProgressSchema, {
    changeSetId: "cs-1",
    filesChanged: opts.filesChanged ?? entries.length,
    linesAdded: opts.linesAdded ?? 0,
    linesRemoved: opts.linesRemoved ?? 0,
    entries,
    capturedAt: "2026-07-05T00:00:00Z",
  });
}

// --- FileChangeProgressBar: visibility ------------------------------------

describe("FileChangeProgressBar — visibility", () => {
  it("renders nothing when progress is undefined", () => {
    const { lastFrame } = render(<FileChangeProgressBar progress={undefined} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  it("renders nothing when no files have changed yet", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar progress={makeProgress({ filesChanged: 0 })} />,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});

// --- FileChangeProgressBar: compact summary -------------------------------

describe("FileChangeProgressBar — compact summary", () => {
  it("uses the singular noun for a single file", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar
        progress={makeProgress({
          filesChanged: 1,
          entries: [makeEntry({ pathAfter: "one.ts" })],
        })}
      />,
    );
    expect(lastFrame() ?? "").toContain("1 file changing");
  });

  it("uses the plural noun for multiple files", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar
        progress={makeProgress({
          filesChanged: 3,
          entries: [makeEntry({ pathAfter: "one.ts" })],
        })}
      />,
    );
    expect(lastFrame() ?? "").toContain("3 files changing");
  });

  it("shows the aggregate +N -M when counts exist", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar
        progress={makeProgress({
          filesChanged: 2,
          linesAdded: 12,
          linesRemoved: 4,
          entries: [makeEntry({ pathAfter: "one.ts" })],
        })}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("+12");
    expect(out).toContain("-4");
  });

  it("hides the aggregate stat when both counts are zero (never +0 -0)", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar
        progress={makeProgress({
          filesChanged: 1,
          linesAdded: 0,
          linesRemoved: 0,
          entries: [makeEntry({ pathAfter: "one.ts" })],
        })}
      />,
    );
    // No "+" anywhere means no stat rendered; the count copy carries none.
    expect(lastFrame() ?? "").not.toContain("+");
  });
});

// --- FileChangeProgressBar: expansion -------------------------------------

describe("FileChangeProgressBar — expansion", () => {
  const progress = makeProgress({
    filesChanged: 2,
    linesAdded: 8,
    linesRemoved: 1,
    entries: [
      makeEntry({ pathAfter: "src/app.ts", linesAdded: 5, linesRemoved: 1 }),
      makeEntry({ pathAfter: "src/util.ts", linesAdded: 3, linesRemoved: 0 }),
    ],
  });

  it("hides the per-file list when collapsed (default)", () => {
    const { lastFrame } = render(<FileChangeProgressBar progress={progress} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("2 files changing");
    expect(out).not.toContain("src/app.ts");
    expect(out).not.toContain("src/util.ts");
  });

  it("shows the per-file list with kind letter, path, and stats when expanded", () => {
    const { lastFrame } = render(
      <FileChangeProgressBar progress={progress} expanded />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("src/app.ts");
    expect(out).toContain("src/util.ts");
    expect(out).toContain("M"); // MODIFY kind letter
    expect(out).toContain("+5");
    expect(out).toContain("+3");
  });

  it("shows '… and K more' when the entry list is capped below the true total", () => {
    const capped = makeProgress({
      filesChanged: 5,
      entries: [
        makeEntry({ pathAfter: "a.ts" }),
        makeEntry({ pathAfter: "b.ts" }),
      ],
    });
    const { lastFrame } = render(
      <FileChangeProgressBar progress={capped} expanded />,
    );
    expect(lastFrame() ?? "").toContain("and 3 more");
  });

  it("renders a rename entry as 'before → after'", () => {
    const renamed = makeProgress({
      filesChanged: 1,
      entries: [
        makeEntry({
          pathBefore: "old/name.ts",
          pathAfter: "new/name.ts",
          kind: FileChangeKind.RENAME,
        }),
      ],
    });
    const { lastFrame } = render(
      <FileChangeProgressBar progress={renamed} expanded />,
    );
    expect(lastFrame() ?? "").toContain("old/name.ts → new/name.ts");
  });

  it("hides per-file stats for a withheld entry (zero counts)", () => {
    const secretish = makeProgress({
      filesChanged: 1,
      entries: [makeEntry({ pathAfter: ".env", linesAdded: 0, linesRemoved: 0 })],
    });
    const { lastFrame } = render(
      <FileChangeProgressBar progress={secretish} expanded />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain(".env");
    expect(out).not.toContain("+");
  });
});

// --- path helpers (direct unit coverage) ----------------------------------

/** A file of a turn's review, as the fold holds it, with only the path fields set. */
function makeFile(path: string, previousPath: string, change: string) {
  return { path, previousPath, change };
}

describe("fileDisplayPath", () => {
  it("shows the path for an added or modified file", () => {
    expect(fileDisplayPath(makeFile("new.ts", "", "added"))).toBe("new.ts");
    expect(fileDisplayPath(makeFile("app.ts", "", "modified"))).toBe("app.ts");
  });

  it("shows the path of a deleted file", () => {
    expect(fileDisplayPath(makeFile("gone.ts", "", "deleted"))).toBe("gone.ts");
  });

  it("shows 'before → after' for a rename", () => {
    expect(fileDisplayPath(makeFile("new.ts", "old.ts", "renamed"))).toBe("old.ts → new.ts");
  });

  it("falls back to the previous path when a file names none", () => {
    expect(fileDisplayPath(makeFile("", "old.ts", "modified"))).toBe("old.ts");
  });
});

describe("progressEntryDisplayPath", () => {
  it("shows the after-path for an add", () => {
    expect(
      progressEntryDisplayPath(makeEntry({ pathAfter: "new.ts", kind: FileChangeKind.ADD })),
    ).toBe("new.ts");
  });

  it("shows the after-path for a modify", () => {
    expect(
      progressEntryDisplayPath(makeEntry({ pathAfter: "app.ts" })),
    ).toBe("app.ts");
  });

  it("falls back to the before-path for a delete", () => {
    expect(
      progressEntryDisplayPath(
        makeEntry({ pathBefore: "gone.ts", kind: FileChangeKind.DELETE }),
      ),
    ).toBe("gone.ts");
  });

  it("shows 'before → after' for a rename — identical to fileDisplayPath", () => {
    expect(
      progressEntryDisplayPath(
        makeEntry({
          pathBefore: "old.ts",
          pathAfter: "new.ts",
          kind: FileChangeKind.RENAME,
        }),
      ),
    ).toBe("old.ts → new.ts");
  });
});
