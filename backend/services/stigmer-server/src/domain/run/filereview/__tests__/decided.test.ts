/**
 * Pins the `stigmer.file_review.decided` event a decision is recorded as
 * (../decided.ts): its id is the target's alone (the change set and, for a
 * file decision, the file), the same text every decision on that target
 * was keyed by before, so a second decision on a target collides; a
 * change-set decision names no file; and the event carries the decider and
 * every word as given, valid against the event's own rules.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decidedEvent, fileReviewDecidedEventId } from "../decided.js";

describe("the decided event id", () => {
  it("hashes the target's key, so one target has one id whatever the decision", () => {
    const key = "run_a:0:fc-1:FILE_REVIEW_EVENT_TYPE_FILE_DECIDED";
    expect(fileReviewDecidedEventId("run_a:0", "file", "fc-1")).toBe(
      `sevt_fd_${createHash("sha256").update(key).digest("hex").slice(0, 40)}`,
    );
    const setKey = "run_a:0:run_a:0:FILE_REVIEW_EVENT_TYPE_FILE_DECIDED";
    expect(fileReviewDecidedEventId("run_a:0", "change_set", "ignored")).toBe(
      `sevt_fd_${createHash("sha256").update(setKey).digest("hex").slice(0, 40)}`,
    );
    expect(fileReviewDecidedEventId("run_a:0", "file", "fc-1")).not.toBe(fileReviewDecidedEventId("run_a:0", "file", "fc-2"));
  });
});

describe("decidedEvent", () => {
  it("records the decision on the change set's run, with its decider", () => {
    const event = decidedEvent("run_a", {
      changeSetId: "run_a:0",
      scope: "file",
      fileChangeId: "fc-1",
      action: "undo",
      expectedDigest: "sha256:abc",
      origin: "person",
      reason: "not this",
      decidedBy: "usr_ada",
    });
    expect(event.runId).toBe("run_a");
    expect(event.threadId).toBe("");
    expect(event.event.case).toBe("stigmerFileReviewDecided");
    if (event.event.case !== "stigmerFileReviewDecided") return;
    const { $typeName: _type, ...value } = event.event.value;
    expect(value).toEqual({
      id: fileReviewDecidedEventId("run_a:0", "file", "fc-1"),
      processedAt: "",
      changeSetId: "run_a:0",
      scope: "file",
      fileChangeId: "fc-1",
      action: "undo",
      expectedDigest: "sha256:abc",
      origin: "person",
      reason: "not this",
      decidedBy: "usr_ada",
    });
  });

  it("names no file on a change-set decision", () => {
    const event = decidedEvent("run_a", {
      changeSetId: "run_a:0",
      scope: "change_set",
      fileChangeId: "fc-1",
      action: "keep",
      expectedDigest: "sha256:agg",
      origin: "next_turn",
      reason: "",
      decidedBy: "",
    });
    expect(event.event.case === "stigmerFileReviewDecided" && event.event.value.fileChangeId).toBe("");
  });
});
