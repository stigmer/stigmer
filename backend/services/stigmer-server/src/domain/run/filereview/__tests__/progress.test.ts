/**
 * Pins the clear of the live file-change progress (../progress.ts): kept
 * while the change set it previews is not yet captured on the record and
 * the run has not finished; cleared once that set is captured, once the
 * run finishes, and for a progress that names no change set.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { FileChangeProgressSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

import { capturedSet } from "../../__tests__/file-review-seed.js";
import { reconcileFileChangeProgress } from "../progress.js";

const progress = create(FileChangeProgressSchema, { changeSetId: "run_a:1", filesChanged: 2 });

describe("reconcileFileChangeProgress", () => {
  it("keeps the progress of a set the record does not hold, or holds still being captured", () => {
    expect(reconcileFileChangeProgress([], progress, false)).toBe(progress);
    expect(reconcileFileChangeProgress([capturedSet("run_a:0")], progress, false)).toBe(progress);
    expect(reconcileFileChangeProgress([capturedSet("run_a:1", [], false)], progress, false)).toBe(progress);
  });

  it("clears it once its set is captured, once the run finishes, and when it names no set", () => {
    expect(reconcileFileChangeProgress([capturedSet("run_a:1")], progress, false)).toBeUndefined();
    expect(reconcileFileChangeProgress([], progress, true)).toBeUndefined();
    expect(reconcileFileChangeProgress([], create(FileChangeProgressSchema, { filesChanged: 1 }), false)).toBeUndefined();
    expect(reconcileFileChangeProgress([], undefined, false)).toBeUndefined();
  });
});
