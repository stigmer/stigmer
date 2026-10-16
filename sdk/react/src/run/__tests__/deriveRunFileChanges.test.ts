import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { FileContentSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type CapturedFileChange,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { DisplayFileChange, DisplayFileChangeType } from "@stigmer/client";
import {
  deriveRunFileChanges,
  toFileDiffEntry,
} from "../deriveRunFileChanges";

// ---------------------------------------------------------------------------
// Fixtures: CapturedFileChange only, in each run's file record (see the
// sibling useSessionFileChanges suite, which covers the session-wrapper
// behavior over the same core).
// ---------------------------------------------------------------------------

function inlineSide(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function captured(opts: {
  id: string;
  pathBefore?: string;
  pathAfter?: string;
  before?: string;
  after?: string;
  kind?: FileChangeKind;
}): CapturedFileChange {
  const pathBefore = opts.pathBefore ?? opts.pathAfter ?? "";
  const pathAfter = opts.pathAfter ?? opts.pathBefore ?? "";
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore,
    pathAfter,
    kind: opts.kind ?? FileChangeKind.MODIFY,
    before: opts.before !== undefined ? inlineSide(opts.before) : undefined,
    after: opts.after !== undefined ? inlineSide(opts.after) : undefined,
    diffComplete: true,
  });
}

/** A run whose file record holds one change set of the given changes. */
function execWith(id: string, changes: CapturedFileChange[]): Run {
  const exec = create(RunSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(RunStatusSchema, {
    fileChanges: [create(FileChangeSetSchema, { id: `${id}:0`, changes })],
  });
  return exec;
}

function display(init: Partial<DisplayFileChange> & { path: string }): DisplayFileChange {
  return {
    changeType: "modified",
    before: undefined,
    after: undefined,
    linesAdded: 0,
    linesRemoved: 0,
    renameFrom: "",
    ...init,
  };
}

function inlineText(side: { body: { case?: string; value?: unknown } } | undefined) {
  return side?.body.case === "inline" ? side.body.value : undefined;
}

// ---------------------------------------------------------------------------
// deriveRunFileChanges — the cross-EXECUTION semantics. Same-execution
// net-collapse cases (create-then-delete, rename, sorting, …) are covered by
// the useSessionFileChanges suite, which delegates to this core.
// ---------------------------------------------------------------------------

describe("deriveRunFileChanges", () => {
  it("returns empty for no executions", () => {
    expect(deriveRunFileChanges([])).toEqual([]);
  });

  it("net-diffs the same path ACROSS executions: first execution's before -> last execution's after", () => {
    // A session's follow-up turns: two runs touching one file.
    const r = deriveRunFileChanges([
      execWith("aex_1", [
        captured({ id: "fc1", pathAfter: "src/shared.ts", before: "v0", after: "v1" }),
      ]),
      execWith("aex_2", [
        captured({ id: "fc2", pathAfter: "src/shared.ts", before: "v1", after: "v2" }),
      ]),
    ]);
    expect(r).toHaveLength(1);
    expect(inlineText(r[0].before)).toBe("v0");
    expect(inlineText(r[0].after)).toBe("v2");
    expect(r[0].changeType).toBe("modified");
  });

  it("anchors the net diff on INPUT order — reversed executions produce the reversed anchors (chronology is a correctness input)", () => {
    const first = execWith("aex_1", [
      captured({ id: "fc1", pathAfter: "src/shared.ts", before: "v0", after: "v1" }),
    ]);
    const second = execWith("aex_2", [
      captured({ id: "fc2", pathAfter: "src/shared.ts", before: "v1", after: "v2" }),
    ]);

    const reversed = deriveRunFileChanges([second, first]);
    expect(inlineText(reversed[0].before)).toBe("v1");
    expect(inlineText(reversed[0].after)).toBe("v1");
  });

  it("reconciles an add (execution 1) then a delete (execution 2) to deleted across the span", () => {
    const r = deriveRunFileChanges([
      execWith("aex_1", [
        captured({ id: "fc1", pathAfter: "src/tmp.ts", after: "scratch", kind: FileChangeKind.ADD }),
      ]),
      execWith("aex_2", [
        captured({ id: "fc2", pathBefore: "src/tmp.ts", pathAfter: "src/tmp.ts", before: "scratch", kind: FileChangeKind.DELETE }),
      ]),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].changeType).toBe("deleted");
  });

  it("rolls up a finished run and a live run in one list", () => {
    const r = deriveRunFileChanges([
      execWith("aex_done", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "a", after: "b" }),
      ]),
      execWith("aex_live", [
        captured({ id: "fc2", pathAfter: "src/b.ts", before: "x", after: "y" }),
      ]),
    ]);
    expect(r.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps distinct paths from distinct executions distinct", () => {
    const r = deriveRunFileChanges([
      execWith("aex_1", [
        captured({ id: "fc1", pathAfter: "src/one.ts", before: "a", after: "b" }),
      ]),
      execWith("aex_2", [
        captured({ id: "fc2", pathAfter: "src/two.ts", before: "c", after: "d" }),
      ]),
    ]);
    expect(r).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// toFileDiffEntry — the DisplayFileChange → FileDiffEntry projection
// ---------------------------------------------------------------------------

describe("toFileDiffEntry", () => {
  it("maps change types to the file-list vocabulary", () => {
    const of = (changeType: DisplayFileChangeType) =>
      toFileDiffEntry(display({ path: "p", changeType }));
    expect(of("added").changeType).toBe("added");
    expect(of("deleted").changeType).toBe("removed");
    expect(of("modified").changeType).toBe("modified");
    expect(of("renamed").changeType).toBe("modified");
  });

  it("derives counts from inline whole-file content", () => {
    const entry = toFileDiffEntry(
      display({
        path: "src/a.ts",
        before: inlineSide("line1\nline2\n"),
        after: inlineSide("line1\nline2 changed\nline3\n"),
      }),
    );
    expect(entry.additions).toBe(2);
    expect(entry.deletions).toBe(1);
  });

  it("falls back to capture-time counts when a side is offloaded", () => {
    const entry = toFileDiffEntry(
      display({
        path: "src/big.ts",
        before: create(FileContentSchema, {
          body: {
            case: "ref",
            value: { storageKey: "artifacts/aex_1/before", contentHash: "h1" },
          },
        }),
        after: inlineSide("new"),
        linesAdded: 10,
        linesRemoved: 4,
      }),
    );
    expect(entry.additions).toBe(10);
    expect(entry.deletions).toBe(4);
  });
});
