/**
 * Positioning + emission of file-review records in buildThreadItems: each
 * SETTLED review of a turn (the fold's `Turn.fileReview`) renders as a
 * read-only `file-review-record` inside its own turn's segment, right after
 * the last row that edited one of its files (matched by the row's path),
 * with a segment-tail backstop for a review no row edited (shell-made
 * changes). A set still undecided on a live turn is never a thread item —
 * its decision surface is the composer-docked FileReviewDock — while one
 * left undecided by an ended turn is recorded honestly. An empty set and a
 * thread with records off emit nothing.
 */
import { describe, it, expect } from "vitest";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import {
  changes,
  decided,
  result,
  said,
  status,
  toolId,
  turnsOf,
  use,
  user,
  type ChangedFile,
} from "./__fixtures__/thread-events";

const R = "run_a";
const R2 = "run_b";

function edit(runId: string, call: string, path: string) {
  return [use(runId, call, "edit_file", { path, old_string: "a", new_string: "b" }), result(runId, call, "ok")];
}

function shell(runId: string, call: string, command: string) {
  return [use(runId, call, "execute", { command }), result(runId, call, "")];
}

function files(...paths: string[]): ChangedFile[] {
  return paths.map((path) => ({ id: `fc-${path}`, path }));
}

function build(...events: Array<SessionEvent | readonly SessionEvent[]>): ThreadItem[] {
  return buildThreadItems(turnsOf(...events), [], { includeFileReviewRecords: true });
}

function recordIndex(items: readonly ThreadItem[], setId: string): number {
  return items.findIndex((i) => i.kind === "file-review-record" && i.fileReviewSet.changeSetId === setId);
}

function groupHas(item: ThreadItem | undefined, id: string): boolean {
  return item?.kind === "tool-group" && item.toolUses.some((tu) => tu.id === id);
}

describe("buildThreadItems — file-review record positioning", () => {
  it("places a settled record right after the LAST row that edited one of its files", () => {
    const items = build(
      user(R, "go"),
      said(R, 0, "Let me edit."),
      edit(R, "e1", "/workspace/notes.md"),
      said(R, 1, "Running tests."),
      shell(R, "sh", "npm test"),
      said(R, 2, "One more edit."),
      edit(R, "e2", "README.md"),
      said(R, 3, "All done, summary follows."),
      status(R, "completed"),
      changes(R, "cs1", files("notes.md", "README.md")),
      decided(R, "cs1", "keep"),
    );
    const rec = recordIndex(items, "cs1");

    expect(rec).toBeGreaterThan(-1);
    expect(groupHas(items[rec - 1], toolId(R, "e2"))).toBe(true);
    const closing = items.findIndex((i) => i.kind === "message" && i.message.text === "All done, summary follows.");
    expect(rec).toBeLessThan(closing);
  });

  it("falls back to the segment tail for a review no row edited (shell-made changes)", () => {
    const items = build(user(R, "go"), said(R, 0, "Shell only."), shell(R, "sh", "echo x > f.txt"), status(R, "completed"), changes(R, "cs1", files("f.txt")));

    expect(recordIndex(items, "cs1")).toBe(items.length - 1);
  });

  it("does not anchor to an edit row that names no path", () => {
    const items = build(
      user(R, "go"),
      use(R, "e0", "edit_file", { old_string: "a", new_string: "b" }),
      result(R, "e0", "ok"),
      said(R, 0, "Done."),
      status(R, "completed"),
      changes(R, "cs1", files("f.txt")),
    );

    expect(recordIndex(items, "cs1")).toBe(items.length - 1);
  });

  it("never emits a set still undecided on a live turn — the composer dock owns it", () => {
    const items = build(user(R, "go"), status(R, "running"), edit(R, "e1", "a.ts"), changes(R, "cs1", files("a.ts")));

    expect(items.map((i) => i.kind)).not.toContain("file-review-record");
  });

  it("records a set an ended turn left undecided, honestly", () => {
    const items = build(user(R, "go"), edit(R, "e1", "a.ts"), status(R, "failed"), changes(R, "cs1", files("a.ts")));

    expect(recordIndex(items, "cs1")).toBeGreaterThan(-1);
  });

  it("emits a decided set of a live turn", () => {
    const items = build(user(R, "go"), status(R, "running"), edit(R, "e1", "a.ts"), changes(R, "cs1", files("a.ts")), decided(R, "cs1", "undo"));

    expect(recordIndex(items, "cs1")).toBeGreaterThan(-1);
  });

  it("keeps each settled turn's record in its own segment, and skips the live turn's pending one", () => {
    const items = build(
      user(R, "first"),
      said(R, 0, "Turn one edit."),
      edit(R, "e1", "a.ts"),
      status(R, "completed"),
      changes(R, "cs-old", files("a.ts")),
      decided(R, "cs-old", "keep"),
      user(R2, "second"),
      status(R2, "running"),
      said(R2, 0, "Turn two edit."),
      edit(R2, "e1", "b.ts"),
      changes(R2, "cs-new", files("b.ts")),
    );
    const old = recordIndex(items, "cs-old");
    const secondTurn = items.findIndex((i) => i.kind === "message" && i.message.text === "Turn two edit.");

    expect(old).toBeGreaterThan(-1);
    expect(old).toBeLessThan(secondTurn);
    expect(recordIndex(items, "cs-new")).toBe(-1);
  });

  it("anchors each of a turn's settled sets to its own rows, in transcript order", () => {
    const items = build(
      user(R, "go"),
      said(R, 0, "Part one."),
      edit(R, "e1", "a.ts"),
      said(R, 1, "Part two."),
      edit(R, "e2", "b.ts"),
      status(R, "completed"),
      changes(R, "cs0", files("a.ts")),
      changes(R, "cs1", files("b.ts")),
    );
    const rec0 = recordIndex(items, "cs0");
    const rec1 = recordIndex(items, "cs1");

    expect(rec1).toBeGreaterThan(rec0);
    expect(groupHas(items[rec0 - 1], toolId(R, "e1"))).toBe(true);
    expect(groupHas(items[rec1 - 1], toolId(R, "e2"))).toBe(true);
  });

  it("does not anchor to a row that only read a file of the set", () => {
    const items = build(
      user(R, "go"),
      use(R, "r1", "read_file", { path: "a.ts" }),
      result(R, "r1", "contents"),
      said(R, 0, "Read it."),
      status(R, "completed"),
      changes(R, "cs1", files("a.ts")),
    );

    expect(recordIndex(items, "cs1")).toBe(items.length - 1);
  });

  it("skips an empty set, and emits nothing when records are off", () => {
    expect(
      build(user(R, "go"), edit(R, "e1", "a.ts"), status(R, "completed"), changes(R, "cs1", [])).map((i) => i.kind),
    ).not.toContain("file-review-record");

    const turns = turnsOf(user(R, "go"), edit(R, "e1", "a.ts"), status(R, "completed"), changes(R, "cs1", files("a.ts")));
    expect(buildThreadItems(turns, []).map((i) => i.kind)).not.toContain("file-review-record");
  });
});
