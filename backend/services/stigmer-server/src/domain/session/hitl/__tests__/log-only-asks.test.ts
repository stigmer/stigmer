/**
 * Pins that a turn's asks are read from its session's log alone: a run
 * whose transcript rows are empty (no messages, no sub-agent runs, no
 * pending approvals) and whose asks, answers and grants are only in the
 * log still has its open gates counted by the workflow's activity
 * (CountOpenGates), is answered by confirmToolUse (in the sub-agent's
 * thread the tool use names), and a grantPermission allows every waiting
 * call of its class from the tool uses and asked events in the log, and
 * the turn is signalled once no gate is open.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { createAgentExecutionActivities } from "../../../../temporal/agentexecution/activities.js";
import { COUNT_OPEN_GATES_ACTIVITY_NAME } from "../../../../temporal/agentexecution/names.js";
import { stubConnectedEngine } from "../../../run/__tests__/engine-stub.js";
import type { ExecutionEngineState } from "../../../run/engine.js";
import { StreamBroker } from "../../../run/stream-broker.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { confirmToolUse } from "../confirm-tool-use.js";
import type { SessionAnswerDeps } from "../confirm-tool-use.js";
import { grantPermission } from "../grant-permission.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_log";
const RUN = "run_log";
const THREAD = `${RUN}.task-1`;

let temp: TempStore;
let signalled: string[];

beforeEach(() => {
  temp = tempStore();
  signalled = [];
});

afterEach(async () => {
  await temp.cleanup();
});

function deps(): SessionAnswerDeps {
  return {
    store: temp.store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: new StreamBroker(silentLogger),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    engineState: () =>
      ({
        connected: true,
        engine: stubConnectedEngine({
          signalApprovalGateResolved: async (runId) => {
            signalled.push(runId);
          },
        }),
      }) as ExecutionEngineState,
    gateSteps: new Map(),
    statusObservers: [],
  };
}

interface Ask {
  readonly callId: string;
  readonly name: string;
  readonly threadId?: string;
  readonly policySource?: string;
}

/** A tool use that asks and its asked event, as the runner writes them. */
function askEvents(ask: Ask): SessionEvent[] {
  const id = `${RUN}.${ask.callId}`;
  const threadId = ask.threadId ?? "";
  return [
    create(SessionEventSchema, {
      runId: RUN,
      threadId,
      event: {
        case: "agentToolUse",
        value: { id, name: ask.name, input: {}, evaluatedPermission: "ask", sessionThreadId: threadId },
      },
    }),
    create(SessionEventSchema, {
      runId: RUN,
      threadId,
      event: {
        case: "stigmerPermissionAsked",
        value: { id: `${id}.ask`, toolUseId: id, message: `run ${ask.name}`, policySource: ask.policySource ?? "builtin_category" },
      },
    }),
  ];
}

/** A waiting turn whose rows hold nothing: its asks are in the log only. */
async function seedLogOnly(asks: ReadonlyArray<Ask>): Promise<void> {
  const writeDeps = { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
  await createRunAppendingEvents(
    writeDeps,
    create(RunSchema, {
      metadata: { id: RUN, org: "acme" },
      spec: { target: { case: "sessionId", value: SESSION }, message: "tidy up" },
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    }),
  );
  await temp.store.sessionEvents.append(SESSION, "acme", asks.flatMap(askEvents).map(draftOf), {
    kind: ApiResourceKind.run,
    id: RUN,
    schema: RunSchema,
    admit: () => undefined,
  });
  await updateRunAppendingEvents(writeDeps, RUN, (run) => {
    run.status!.phase = RunPhase.RUN_WAITING_FOR_APPROVAL;
  });
}

async function openGateCount(): Promise<number> {
  const activities = createAgentExecutionActivities({
    store: temp.store,
    logger: silentLogger,
    statusWriter: () => {
      throw new Error("counting gates writes no status");
    },
    sessionEventBroker: new SessionEventBroker(silentLogger),
  });
  const count = activities[COUNT_OPEN_GATES_ACTIVITY_NAME] as (executionId: string, sessionId: string) => Promise<number>;
  return count(RUN, SESSION);
}

async function confirmations(): Promise<Array<[string, string, string]>> {
  const records = await temp.store.sessionEvents.list(SESSION, { order: "asc", types: ["user.tool_confirmation"], limit: 50 });
  return records.map(eventOf).flatMap((event) =>
    event.event.case === "userToolConfirmation"
      ? [[event.event.value.toolUseId, event.event.value.result, event.event.value.sessionThreadId] as [string, string, string]]
      : [],
  );
}

describe("a turn whose asks are only in its session's log", () => {
  it("has its open gates counted, its asks answered and granted by class, and is signalled once none is open", async () => {
    await seedLogOnly([
      { callId: "tc-write", name: "Write", threadId: THREAD },
      { callId: "tc-shell-1", name: "shell" },
      { callId: "tc-shell-2", name: "bash" },
    ]);
    const stored = await temp.store.getResource(ApiResourceKind.run, RUN, RunSchema);
    expect(stored.status?.messages).toEqual([]);
    expect(stored.status?.subAgentRuns).toEqual([]);
    expect(stored.status?.pendingApprovals).toEqual([]);
    expect(await openGateCount()).toBe(3);

    const answer = await confirmToolUse(
      deps(),
      create(ConfirmToolUseInputSchema, { sessionId: SESSION, toolUseId: `${RUN}.tc-write`, result: "allow" }),
      testCallerIdentity(),
    );
    expect(answer.threadId).toBe(THREAD);
    expect(await openGateCount()).toBe(2);
    expect(signalled).toEqual([]);

    const granted = await grantPermission(
      deps(),
      create(GrantPermissionInputSchema, { sessionId: SESSION, toolUseId: `${RUN}.tc-shell-1` }),
      testCallerIdentity(),
    );
    expect(granted.grant?.event.case === "stigmerPermissionGrant" && granted.grant.event.value.lease).toMatchObject({
      category: "shell",
      server: "",
      tool: "",
    });
    expect(await confirmations()).toEqual([
      [`${RUN}.tc-write`, "allow", THREAD],
      [`${RUN}.tc-shell-1`, "allow", ""],
      [`${RUN}.tc-shell-2`, "allow", ""],
    ]);
    expect(await openGateCount()).toBe(0);
    expect(signalled).toEqual([RUN]);
  });
});
