/**
 * Pins the two file-review stream writers on a run whose status has no
 * stream yet, the shape of a run that predates the ledger or has not
 * captured anything: the decision writer and the runner-event fold each
 * open the stream keyed by the run's id (the `run_id` the stream carries
 * on the wire) and then append, so the first event never lands on a
 * stream that names no run. The fold's two invariants ride along: a
 * runner-sent FILE_DECIDED is dropped, and a re-sent event is never
 * duplicated.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  FileDecisionAction,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import {
  ACTOR_USER,
  appendRunnerEvents,
  buildFileDecision,
  recordFileDecisionEvent,
} from "../author.js";

const RUN_ID = "aex_author";
const CHANGE_SET_ID = "cs_author";

describe("recordFileDecisionEvent on a status with no stream", () => {
  it("opens the stream under the run's id and appends the user's FILE_DECIDED", () => {
    const status = create(AgentRunStatusSchema);
    const decision = buildFileDecision(
      CHANGE_SET_ID,
      "",
      FileDecisionScope.CHANGE_SET,
      FileDecisionAction.APPROVE,
      "sha256:abc",
      "usr_reviewer",
      "2026-10-06T00:00:00Z",
      "",
      false,
    );

    recordFileDecisionEvent(status, RUN_ID, decision);

    const stream = status.fileReviewEventStream;
    expect(stream?.runId).toBe(RUN_ID);
    expect(stream?.events).toHaveLength(1);
    const event = stream?.events[0];
    expect(event?.eventId).toBe(
      `${CHANGE_SET_ID}:${CHANGE_SET_ID}:FILE_REVIEW_EVENT_TYPE_FILE_DECIDED`,
    );
    expect(event?.eventType).toBe(FileReviewEventType.FILE_DECIDED);
    expect(event?.actor).toBe(ACTOR_USER);
    expect(event?.payload.case).toBe("fileDecided");
  });
});

describe("appendRunnerEvents on a status with no stream", () => {
  it("opens the stream under the run's id, folds capture events once, and drops a runner FILE_DECIDED", () => {
    const status = create(AgentRunStatusSchema);
    const baseline = {
      eventId: `${CHANGE_SET_ID}:${CHANGE_SET_ID}:BASELINE_CAPTURED`,
      changeSetId: CHANGE_SET_ID,
      eventType: FileReviewEventType.BASELINE_CAPTURED,
      actor: "runner",
    };
    const request = create(AgentRunStatusSchema, {
      fileReviewEventStream: {
        runId: RUN_ID,
        events: [
          baseline,
          baseline,
          {
            eventId: `${CHANGE_SET_ID}:${CHANGE_SET_ID}:FILE_DECIDED`,
            changeSetId: CHANGE_SET_ID,
            eventType: FileReviewEventType.FILE_DECIDED,
            actor: "runner",
          },
        ],
      },
    });

    appendRunnerEvents(status, RUN_ID, request);

    const stream = status.fileReviewEventStream;
    expect(stream?.runId).toBe(RUN_ID);
    expect(stream?.events.map((e) => e.eventType)).toEqual([
      FileReviewEventType.BASELINE_CAPTURED,
    ]);
  });
});
