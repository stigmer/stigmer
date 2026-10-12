// Unit arms for the approval-answer helpers. What they pin:
// - the newest status decides: a running after an idle reads as no idle,
//   and an idle carries its stop reason and the ids it names;
// - the requires_action wait answers the ids once the idle names as many
//   calls as asked, and is red, naming the newest status, when it never
//   does; the idle wait answers once the reason matches and is red
//   otherwise;
// - the answers of a run read from its confirmations and grants, a deny
//   with its message, and anything else by its case;
// - an answer per the contract gives the answer, then holds the run to the
//   remainder it must carry.
// Pure: hand-built events and stubbed clients, no target.
// Domain: conformance support (approvals are session events).
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { type SessionEvent, SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { answersOf, awaitIdleWith, awaitRequiresAction, confirmPerContract, newestIdle, sessionLog } from "../answers";

const FAST = { timeoutMs: 50, pollMs: 5 };

function event(value: MessageInitShape<typeof SessionEventSchema>["event"]): SessionEvent {
  return create(SessionEventSchema, { event: value });
}

const running = () => event({ case: "sessionStatusRunning", value: { id: "r" } });
const idle = (type: string, eventIds: string[] = []) =>
  event({ case: "sessionStatusIdle", value: { id: `i-${type}`, stopReason: { type, eventIds } } });
const message = () => event({ case: "agentMessage", value: { id: "m" } });

function logClients(...logs: SessionEvent[][]) {
  let call = 0;
  const listEvents = vi.fn(async () => ({ events: logs[Math.min(call++, logs.length - 1)] ?? [] }));
  return { clients: { sessionQuery: { listEvents } } as unknown as ConformanceClients, listEvents };
}

describe("newestIdle", () => {
  it("reads the newest status: an idle with its reason and ids, none once running, none before any", () => {
    expect(newestIdle([running(), idle("requires_action", ["a", "b"]), message()])).toEqual({
      type: "requires_action",
      eventIds: ["a", "b"],
    });
    expect(newestIdle([idle("end_turn"), running(), message()])).toBeUndefined();
    expect(newestIdle([message()])).toBeUndefined();
  });
});

describe("sessionLog and the waits", () => {
  it("reads the whole log of the session", async () => {
    const c = logClients([message()]);
    expect(await sessionLog(c.clients, "ses_1")).toHaveLength(1);
    expect(c.listEvents).toHaveBeenCalledWith({ sessionId: "ses_1", pageSize: 1000 });
  });

  it("answers the ids once the idle names as many calls as asked", async () => {
    const c = logClients([running()], [idle("requires_action", ["a"])], [idle("requires_action", ["a", "b"])]);
    expect(await awaitRequiresAction(c.clients, "ses_1", 2, FAST)).toEqual(["a", "b"]);
  });

  it("is red, naming the newest status, when the idle never names them", async () => {
    await expect(awaitRequiresAction(logClients([running()]).clients, "ses_1", 1, FAST)).rejects.toThrow(
      /did not go idle with requires_action naming 1 call\(s\).*running or none/,
    );
    await expect(
      awaitRequiresAction(logClients([idle("end_turn")]).clients, "ses_1", 1, FAST),
    ).rejects.toThrow(/end_turn/);
  });

  it("the idle wait answers once the reason matches, and is red otherwise", async () => {
    await expect(awaitIdleWith(logClients([running()], [idle("end_turn")]).clients, "ses_1", "end_turn", FAST)).resolves.toBeUndefined();
    await expect(awaitIdleWith(logClients([running()]).clients, "ses_1", "end_turn", FAST)).rejects.toThrow(
      /did not go idle with end_turn.*running or none/,
    );
  });
});

describe("answersOf", () => {
  it("reads a run's confirmations and grants in log order", async () => {
    const c = logClients([
      event({ case: "userToolConfirmation", value: { id: "c1", toolUseId: "u1", result: "allow" } }),
      event({ case: "stigmerPermissionGrant", value: { id: "g1", toolUseId: "u1", scope: "turn" } }),
      event({ case: "userToolConfirmation", value: { id: "c2", toolUseId: "u2", result: "deny", denyMessage: "no" } }),
      message(),
    ]);
    expect(await answersOf(c.clients, "ses_1", "run_1")).toEqual(["u1 allow", "grant u1", 'u2 deny "no"', "agentMessage"]);
    expect(c.listEvents).toHaveBeenCalledWith({
      sessionId: "ses_1",
      runId: "run_1",
      types: ["user.tool_confirmation", "stigmer.permission.grant"],
      pageSize: 1000,
    });
  });
});

describe("confirmPerContract", () => {
  it("gives the answer, then holds the run to the remainder it must carry", async () => {
    const run = create(RunSchema, { metadata: { id: "run_1" }, status: { pendingApprovals: [{ toolCallId: "tc-2" }] } });
    const get = vi.fn(async () => run);
    const answer = vi.fn(async () => undefined);
    const clients = { agentExecutionQuery: { get } } as unknown as ConformanceClients;
    expect(await confirmPerContract({ clients, runId: "run_1", answer, expectedRemaining: 1, label: "one left" })).toBe(run);
    expect(answer).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith({ value: "run_1" });
    await expect(
      confirmPerContract({ clients, runId: "run_1", answer, expectedRemaining: 0, label: "none left" }),
    ).rejects.toThrow(/none left/);
  });
});
