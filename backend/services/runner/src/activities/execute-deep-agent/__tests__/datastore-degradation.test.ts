/**
 * Datastore degradation disclosure, activity half (issue #325).
 *
 * The activity appends the operator-facing MESSAGE_SYSTEM notice to
 * `initialStatus.messages` BEFORE streaming (index.ts) — deliberately not
 * through a status builder, because the v2 and v3 stream paths each
 * construct their own builder around that same proto. These tests pin the
 * property that push site depends on: BOTH builders preserve pre-seeded
 * messages (ExecutionState only appends; index rebuilds touch runtime
 * tool-call state, and a MESSAGE_SYSTEM row carries no tool calls), so
 * the notice survives whichever stream version runs and rides every
 * persist. The prompt half (section selection) is pinned in
 * shared/__tests__/datastore-attachment.test.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  EXPECTED_RECORD_TOOLS,
  formatDatastoreDegradationNotice,
} from "../../../shared/datastore-attachment.js";
import { StatusBuilder } from "../status-builder.js";
import { V3StatusBuilder } from "../v3-status-builder.js";
import { normalize } from "../v3-protocol-normalizer.js";
import {
  resetSeq,
  makeMessageStart,
  makeMessageFinish,
  makeTextDelta,
} from "../__test-utils__/v3-event-fixtures.js";

beforeEach(() => resetSeq());

/** initialStatus as index.ts shapes it when setup reports missing tools. */
function statusWithDegradationNotice(): AgentExecutionStatus {
  const status = create(AgentExecutionStatusSchema, {});
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: formatDatastoreDegradationNotice(1, [...EXPECTED_RECORD_TOOLS]),
    timestamp: "2026-08-11T00:00:00.000Z",
  }));
  return status;
}

describe("datastore degradation notice survives streaming (issue #325)", () => {
  it("v2 StatusBuilder preserves the pre-seeded notice through a streamed turn", () => {
    const initialStatus = statusWithDegradationNotice();
    const sb = new StatusBuilder("exec-1", initialStatus);

    sb.processEvent({
      event: "on_chat_model_stream",
      run_id: "run-1",
      data: { chunk: { content: "I cannot reach the datastore right now." } },
    });
    sb.processEvent({ event: "on_chat_model_end", run_id: "run-1", data: {} });

    const messages = sb.currentStatus.messages;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].type).toBe(MessageType.MESSAGE_SYSTEM);
    expect(messages[0].content).toContain("0/5 record tools connected");
    expect(messages[0].content).toContain("declared 1 datastore(s)");
  });

  it("v3 V3StatusBuilder preserves the pre-seeded notice through a streamed turn", () => {
    const initialStatus = statusWithDegradationNotice();
    const sb = new V3StatusBuilder("exec-1", initialStatus);

    const protocolEvents = [
      makeMessageStart("run-1"),
      makeTextDelta("run-1", "I cannot reach the datastore right now."),
      makeMessageFinish("run-1"),
    ];
    for (const raw of protocolEvents) {
      for (const e of normalize(raw)) {
        sb.processEvent(e);
      }
    }

    const messages = sb.currentStatus.messages;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].type).toBe(MessageType.MESSAGE_SYSTEM);
    expect(messages[0].content).toContain("0/5 record tools connected");
  });

  it("both builders share the initialStatus proto, so the append needs no builder", () => {
    // The push-site contract itself: mutating initialStatus.messages is
    // visible through whichever builder wraps it.
    const initialStatus = create(AgentExecutionStatusSchema, {});
    const sb = new StatusBuilder("exec-1", initialStatus);
    initialStatus.messages.push(create(AgentMessageSchema, {
      type: MessageType.MESSAGE_SYSTEM,
      content: formatDatastoreDegradationNotice(2, ["delete_record"]),
      timestamp: "2026-08-11T00:00:00.000Z",
    }));
    expect(sb.currentStatus.messages).toHaveLength(1);
    expect(sb.currentStatus.messages[0].content).toContain(
      "4/5 record tools connected",
    );
  });
});
