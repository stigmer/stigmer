/**
 * The persist chokepoint's two contracts: what one write does (the secret
 * backstop, which runs before the session's events are read from the rows,
 * so a secret-like write that waits for a person reaches the log withheld;
 * the usage summary, the heartbeat, the STOP; a failed progress capture
 * never fails a write), and how requests
 * coalesce (one write in flight, one follow-up at most, every request's
 * promise resolving only once its state is on the wire).
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { UpdateStatusResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunControlSignal, FileChangeKind, ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { TurnProgress } from "../capture.js";
import { newProgressCaptureState, type ProgressSubstrate } from "../../shared/filereview/progress.js";
import { PersistChokepoint } from "../persist-chokepoint.js";
import { SessionEventEmitter } from "../events/emitter.js";
import { AppendSessionEventsResponseSchema, type SessionEventPreview } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { toJsonString } from "@bufbuild/protobuf";
import { UsageAccumulator } from "../usage-accumulator.js";
import { AgentMessageSchema, ToolCallSchema, TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType, ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { FileReviewEventSchema, FileReviewEventStreamSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/ledger_pb.js";
import { FileReviewEventType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

interface Gate {
  readonly open: () => void;
  readonly opened: Promise<void>;
}

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** A client whose `updateStatus` answers through a gate the test opens, so writes can be held in flight. */
function heldClient(answers: RunControlSignal[] = []) {
  const gates: Gate[] = [];
  const writes: string[] = [];
  const client = {
    updateStatus: vi.fn(async (_id: string, status: { error: string }) => {
      const g = gate();
      gates.push(g);
      writes.push(status.error);
      await g.opened;
      return create(UpdateStatusResponseSchema, { signal: answers.shift() ?? RunControlSignal.UNSPECIFIED });
    }),
  } as unknown as StigmerClient;
  return { client, gates, writes };
}

function chokepointOver(
  client: StigmerClient,
  options: { usage?: UsageAccumulator; progress?: TurnProgress; onPlatformStop?: () => void } = {},
) {
  const status = create(RunStatusSchema, {});
  const rows = create(TurnRowsSchema, {});
  const heartbeat = vi.fn();
  const onPlatformStop = options.onPlatformStop ?? vi.fn();
  const chokepoint = new PersistChokepoint({
    client,
    executionId: "aex_test",
    status,
    rows,
    offload: undefined,
    usage: () => options.usage,
    progress: () => options.progress,
    heartbeat,
    onPlatformStop,
  });
  return { chokepoint, status, rows, heartbeat, onPlatformStop };
}

describe("PersistChokepoint: one write", () => {
  it("withholds a secret-like write's content from the session's events: no event and no preview carries it", async () => {
    const appended: SessionEvent[] = [];
    const previews: SessionEventPreview[] = [];
    const appendSessionEvents = vi.fn(async (_run: string, batch: readonly SessionEvent[], sent: readonly SessionEventPreview[]) => {
      appended.push(...batch);
      previews.push(...sent);
      return create(AppendSessionEventsResponseSchema);
    });
    const events = new SessionEventEmitter({
      client: { appendSessionEvents, listRunSessionEvents: vi.fn(async () => []) },
      runId: "aex_test",
      credential: async () => undefined,
      delay: async () => {},
    });
    await events.begin({ sessionId: "ses_1", resumed: false, rows: create(TurnRowsSchema) });
    const { client, gates } = heldClient();
    const status = create(RunStatusSchema, {});
    const rows = create(TurnRowsSchema, {});
    const chokepoint = new PersistChokepoint({
      client,
      executionId: "aex_test",
      status,
      rows,
      offload: undefined,
      usage: () => undefined,
      progress: () => undefined,
      heartbeat: vi.fn(),
      onPlatformStop: vi.fn(),
      events,
    });
    rows.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "Writing the env file.",
        toolCalls: [
          create(ToolCallSchema, {
            id: "w1",
            name: "write",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            args: { path: ".env", content: "SECRET=1" },
            argsPreview: JSON.stringify({ path: ".env", content: "SECRET=1" }),
          }),
        ],
      }),
    );

    const written = chokepoint.write();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!.open();
    await written;

    expect(appended.map((e) => e.event.case), "the write reached the log as a tool use").toContain("agentToolUse");
    for (const event of appended) {
      expect(toJsonString(SessionEventSchema, event), `${event.event.case} withholds the content`).not.toContain("SECRET=1");
    }
    for (const preview of previews) {
      expect(JSON.stringify(preview), "no preview carries the content").not.toContain("SECRET=1");
    }
  });

  it("withholds secret content, refreshes streaming_usage, writes, heartbeats, and relays STOP", async () => {
    const { client, gates } = heldClient([RunControlSignal.STOP]);
    const usage = new UsageAccumulator(ServiceTier.STANDARD, ThinkingMode.DISABLED);
    usage.addTurn({ inputTokens: 10, estimatedCostUsd: 0.01, model: "m" });
    const onPlatformStop = vi.fn();
    const { chokepoint, status, rows, heartbeat } = chokepointOver(client, { usage, onPlatformStop });
    rows.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, {
            id: "w1",
            name: "write",
            status: ToolCallStatus.TOOL_CALL_COMPLETED,
            args: { path: ".env", content: "SECRET=1" },
          }),
        ],
      }),
    );

    const written = chokepoint.write();
    gates[0]!.open();
    await written;

    expect(rows.messages[0]!.toolCalls[0]!.args, "the secret backstop ran before the write").not.toMatchObject({ content: "SECRET=1" });
    expect(status.streamingUsage?.estimatedCostUsd).toBe(0.01);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(onPlatformStop).toHaveBeenCalledTimes(1);
  });

  it("refreshes file_change_progress from the turn's capture before the write, and re-attaches only when the tree moved", async () => {
    const { client, gates } = heldClient();
    const captures: boolean[] = [true, false];
    const substrate: ProgressSubstrate = {
      capture: async () => ({
        delta: { entries: [{ pathBefore: "a.md", pathAfter: "a.md", kind: FileChangeKind.MODIFY, linesAdded: 2, linesRemoved: 0 }] },
        changed: captures.shift() ?? false,
      }),
    };
    const { chokepoint, status } = chokepointOver(client, {
      progress: { changeSetId: "aex_test:0", substrate, state: newProgressCaptureState() },
    });

    const first = chokepoint.write();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    expect(status.fileChangeProgress?.changeSetId, "attached before the bytes leave").toBe("aex_test:0");
    expect(status.fileChangeProgress?.linesAdded).toBe(2);
    const attachedAt = status.fileChangeProgress?.capturedAt;
    gates[0]!.open();
    await first;

    // The floor (2 s) has not elapsed for the second write: no capture, the
    // snapshot stands; a capture that reports `changed: false` would stand too.
    const second = chokepoint.write();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(status.fileChangeProgress?.capturedAt).toBe(attachedAt);
    gates[1]!.open();
    await second;
  });

  it("never fails a write over a progress capture that fails: the status still goes out and the heartbeat pulses", async () => {
    const { client, gates } = heldClient();
    const substrate: ProgressSubstrate = {
      capture: () => Promise.reject(new Error("Command failed: git add -A -- .\nerror: short read while indexing a.md")),
    };
    const { chokepoint, status, heartbeat } = chokepointOver(client, {
      progress: { changeSetId: "aex_test:0", substrate, state: newProgressCaptureState() },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const outcome = chokepoint.request().then(
        () => "resolved",
        (err: unknown) => err,
      );
      await vi.waitFor(() => expect(gates, "the write reached the control plane").toHaveLength(1));
      gates[0]!.open();
      expect(await outcome, "requestPersist never rejects").toBe("resolved");
      expect(status.fileChangeProgress).toBeUndefined();
      expect(heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("writes no streaming_usage when no turn was reported", async () => {
    const { client, gates } = heldClient();
    const { chokepoint, status } = chokepointOver(client, { usage: new UsageAccumulator() });
    const written = chokepoint.write();
    gates[0]!.open();
    await written;
    expect(status.streamingUsage).toBeUndefined();
  });
});

describe("PersistChokepoint: coalescing", () => {
  it("a request while a write is in flight schedules ONE follow-up and resolves only when it lands", async () => {
    const { client, gates, writes } = heldClient();
    const { chokepoint, status } = chokepointOver(client);

    status.error = "one";
    const first = chokepoint.request();
    status.error = "two";
    const second = chokepoint.request();
    status.error = "three";
    const third = chokepoint.request();

    let secondSettled = false;
    let thirdSettled = false;
    void second.then(() => (secondSettled = true));
    void third.then(() => (thirdSettled = true));

    expect(gates, "one write in flight, the follow-up waits").toHaveLength(1);
    gates[0]!.open();
    await first;
    await Promise.resolve();
    expect(secondSettled, "the follow-up has not landed yet").toBe(false);

    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(writes, "the follow-up carries the state as of the LAST request").toEqual(["one", "three"]);
    gates[1]!.open();
    await Promise.all([second, third]);
    expect(secondSettled && thirdSettled).toBe(true);
    expect(client.updateStatus).toHaveBeenCalledTimes(2);
  });

  it("sequential awaited requests write once each, in order", async () => {
    const { client, gates } = heldClient();
    const { chokepoint } = chokepointOver(client);
    const first = chokepoint.request();
    gates[0]!.open();
    await first;
    const second = chokepoint.request();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]!.open();
    await second;
    expect(client.updateStatus).toHaveBeenCalledTimes(2);
  });
});

describe("PersistChokepoint: the run's file record", () => {
  /** A ledger event for the change set: its baseline, or its candidate. */
  function ledgerEvent(kind: "baseline" | "candidate") {
    const changeSetId = "aex_test:0";
    return kind === "baseline"
      ? create(FileReviewEventSchema, {
          eventId: "b",
          changeSetId,
          eventType: FileReviewEventType.BASELINE_CAPTURED,
          payload: { case: "baselineCaptured", value: { changeSetId, turnId: changeSetId, harnessId: "unit" } },
        })
      : create(FileReviewEventSchema, {
          eventId: "c",
          changeSetId,
          eventType: FileReviewEventType.CANDIDATE_CAPTURED,
          payload: { case: "candidateCaptured", value: { changeSetId, candidateSnapshot: { git: { treeOid: "after" } } } },
        });
  }

  it("carries each change set on the write after its pin and once more with its candidate, and on no write between", async () => {
    const carried: string[][] = [];
    const client = {
      updateStatus: vi.fn(async (_id: string, status: { fileChanges: { id: string; candidateSnapshot?: unknown }[] }) => {
        carried.push(status.fileChanges.map((set) => `${set.id}${set.candidateSnapshot === undefined ? "" : "+candidate"}`));
        return create(UpdateStatusResponseSchema, { signal: RunControlSignal.UNSPECIFIED });
      }),
    } as unknown as StigmerClient;
    const { chokepoint, rows } = chokepointOver(client);
    await chokepoint.write();
    rows.fileReviewEventStream = create(FileReviewEventStreamSchema, { runId: "aex_test", events: [ledgerEvent("baseline")] });
    await chokepoint.write();
    await chokepoint.write();
    rows.fileReviewEventStream.events.push(ledgerEvent("candidate"));
    await chokepoint.write({ final: true });
    await chokepoint.write({ final: true });
    expect(carried).toEqual([[], ["aex_test:0"], [], ["aex_test:0+candidate"], []]);
  });

  it("carries a set again when the write that carried it did not land", async () => {
    const carried: number[] = [];
    let fail = true;
    const client = {
      updateStatus: vi.fn(async (_id: string, status: { fileChanges: unknown[] }) => {
        carried.push(status.fileChanges.length);
        if (fail) {
          fail = false;
          throw new Error("the control plane is down");
        }
        return create(UpdateStatusResponseSchema, { signal: RunControlSignal.UNSPECIFIED });
      }),
    } as unknown as StigmerClient;
    const { chokepoint, rows } = chokepointOver(client);
    rows.fileReviewEventStream = create(FileReviewEventStreamSchema, { runId: "aex_test", events: [ledgerEvent("baseline")] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await chokepoint.write();
      await chokepoint.write();
      await chokepoint.write();
    } finally {
      error.mockRestore();
    }
    expect(carried, "lost, then carried again, then sent").toEqual([1, 1, 0]);
  });
});
