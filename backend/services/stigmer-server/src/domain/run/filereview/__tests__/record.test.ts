/**
 * Pins the run's file record (../record.ts): a status write's sets are
 * merged by set id — a held set still being captured is replaced where it
 * stands, a captured one is never replaced by a different capture, a new
 * one is added after the others, a held set the write does not carry is
 * kept, and a set with no id or another run's id is passed over; a set is
 * captured once its candidate is; and the gates a keep is checked against
 * (the target's digest, the completeness rule and its one exception, an
 * acknowledged binary).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { DiffCompleteness } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema, FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";

import { capturedSet, reviewableChange } from "../../__tests__/file-review-seed.js";
import {
  everyIncompleteChangeIsBinary,
  findChange,
  findChangeSet,
  isCaptured,
  keepBlockedReason,
  targetDigest,
  upsertFileChanges,
} from "../record.js";

describe("upsertFileChanges", () => {
  it("keeps every stored set a write does not carry, and adds a new one after them", () => {
    const first = capturedSet("run_a:0");
    const second = capturedSet("run_a:1");
    expect(upsertFileChanges("run_a", [first], [second]).map((cs) => cs.id)).toEqual(["run_a:0", "run_a:1"]);
  });

  it("replaces a set still being captured by its capture, where it stands, never moving or duplicating it", () => {
    const pinned = capturedSet("run_a:0", [], false);
    const second = capturedSet("run_a:1");
    const captured = capturedSet("run_a:0", [reviewableChange(), { ...reviewableChange(), id: "fc-2" }]);
    const merged = upsertFileChanges("run_a", [pinned, second], [captured]);
    expect(merged.map((cs) => cs.id)).toEqual(["run_a:0", "run_a:1"]);
    expect(merged[0]).toBe(captured);
    expect(merged[1]).toBe(second);
  });

  it("never replaces a captured set with a different capture, nor uncaptures it with a late baseline", () => {
    const captured = capturedSet("run_a:0");
    const swapped = capturedSet("run_a:0", [reviewableChange(), { ...reviewableChange(), id: "fc-2" }]);
    const lateBaseline = capturedSet("run_a:0", [], false);
    expect(upsertFileChanges("run_a", [captured], [swapped])[0]).toBe(captured);
    expect(upsertFileChanges("run_a", [captured], [lateBaseline])[0]).toBe(captured);
    const retried = capturedSet("run_a:0");
    expect(upsertFileChanges("run_a", [captured], [retried])[0], "an identical retry is taken").toBe(retried);
  });

  it("passes over a set whose id names another run", () => {
    const own = capturedSet("run_a:0");
    expect(upsertFileChanges("run_a", [own], [capturedSet("run_b:0"), capturedSet("run_ab:0")]).map((cs) => cs.id)).toEqual([
      "run_a:0",
    ]);
  });

  it("passes over a set with no id, and leaves the stored list itself untouched", () => {
    const stored = [capturedSet("run_a:0")];
    const merged = upsertFileChanges("run_a", stored, [create(FileChangeSetSchema, {})]);
    expect(merged.map((cs) => cs.id)).toEqual(["run_a:0"]);
    upsertFileChanges("run_a", stored, [capturedSet("run_a:1")]);
    expect(stored).toHaveLength(1);
  });
});

describe("a captured set", () => {
  it("is one whose candidate is captured; a baseline alone is still being captured", () => {
    expect(isCaptured(capturedSet("run_a:0"))).toBe(true);
    expect(isCaptured(capturedSet("run_a:0", [], false))).toBe(false);
  });
});

describe("the keep gates", () => {
  const set = capturedSet("run_a:0");

  it("find a set and a file by id, and name the digest a decision is checked against", () => {
    expect(findChangeSet([set], "run_a:0")).toBe(set);
    expect(findChangeSet([set], "run_a:9")).toBeUndefined();
    expect(findChange(set, "fc-1")?.id).toBe("fc-1");
    expect(targetDigest(set, "change_set", "")).toBe(set.aggregateDigest);
    expect(targetDigest(set, "file", "fc-1")).toBe(set.changes[0]?.fileDigest);
    expect(targetDigest(set, "file", "fc-9")).toBe("");
  });

  it("let a complete target be kept, and refuse an absent set or file", () => {
    expect(keepBlockedReason(set, "change_set", "", false)).toBe("");
    expect(keepBlockedReason(set, "file", "fc-1", false)).toBe("");
    expect(keepBlockedReason(undefined, "change_set", "", false)).toBe("change set is not reviewable");
    expect(keepBlockedReason(set, "file", "fc-9", false)).toBe("file change fc-9 is not reviewable");
  });

  it("refuse a target whose diff cannot be shown whole, except an acknowledged binary", () => {
    const binary = create(CapturedFileChangeSchema, { id: "fc-bin", diffComplete: false, after: { isBinary: true } });
    const secret = create(CapturedFileChangeSchema, { id: "fc-secret", diffComplete: false });
    const blocked = create(FileChangeSetSchema, {
      id: "run_a:1",
      changes: [binary, secret],
      diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
    });
    expect(keepBlockedReason(blocked, "file", "fc-bin", true)).toBe("");
    expect(keepBlockedReason(blocked, "file", "fc-bin", false)).toContain("cannot be approved");
    expect(keepBlockedReason(blocked, "file", "fc-secret", true)).toContain("cannot be approved");
    expect(keepBlockedReason(blocked, "change_set", "", true)).toContain("cannot be approved");
    expect(everyIncompleteChangeIsBinary(blocked)).toBe(false);

    const binaryOnly = create(FileChangeSetSchema, {
      id: "run_a:2",
      changes: [binary],
      diffCompleteness: DiffCompleteness.BINARY_SUMMARY_ONLY,
    });
    expect(everyIncompleteChangeIsBinary(binaryOnly)).toBe(true);
    expect(keepBlockedReason(binaryOnly, "change_set", "", true)).toBe("");
    expect(keepBlockedReason(binaryOnly, "change_set", "", false)).toContain("cannot be approved");
    expect(everyIncompleteChangeIsBinary(set)).toBe(false);
  });
});
