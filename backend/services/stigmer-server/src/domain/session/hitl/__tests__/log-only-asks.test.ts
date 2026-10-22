/**
 * Pins that a turn's asks are read from its session's log alone: a run
 * whose asks, answers and grants are only in the log has its open gates
 * counted by the workflow's activity
 * (CountOpenGates), is answered by confirmToolUse (in the sub-agent's
 * thread the tool use names), and a grantPermission allows every waiting
 * call of its class from the tool uses and asked events in the log, and
 * the turn is signalled once no gate is open. A tool use another run
 * wrote under this run's id, or one that never asked, is no ask; a run
 * whose asks fill more than one page of the log is still read whole; and
 * a store fault reading the ask, or whether it is open, is Internal.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { Store } from "../../../../store/interface.js";
import { createAgentExecutionActivities } from "../../../../temporal/agentexecution/activities.js";
import { COUNT_OPEN_GATES_ACTIVITY_NAME } from "../../../../temporal/agentexecution/names.js";
import { stubConnectedEngine } from "../../../run/__tests__/engine-stub.js";
import type { ExecutionEngineState } from "../../../run/engine.js";
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
    queuedTurns: async () => undefined,
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

function confirm(callId: string, d = deps()) {
  return confirmToolUse(
    d,
    create(ConfirmToolUseInputSchema, { sessionId: SESSION, toolUseId: `${RUN}.${callId}`, result: "allow" }),
    testCallerIdentity(),
  );
}

async function codeOf(promise: Promise<unknown>): Promise<Code> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  }
  throw new Error("expected a refusal");
}

describe("what is an ask, read from the log", () => {
  it("is not a tool use another run wrote under this run's id, nor one that never asked", async () => {
    await seedLogOnly([{ callId: "tc-1", name: "Write" }]);
    // Another run of the session, stored beside the waiting one (a session
    // written before one turn at a time held).
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_other",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_other", org: "acme" },
        spec: { target: { case: "sessionId", value: SESSION }, message: "again" },
        status: { phase: RunPhase.RUN_IN_PROGRESS },
      }),
    );
    const use = (runId: string, callId: string, evaluatedPermission: string): SessionEvent =>
      create(SessionEventSchema, {
        runId,
        event: { case: "agentToolUse", value: { id: `${RUN}.${callId}`, name: "Write", input: {}, evaluatedPermission } },
      });
    const guard = (id: string) => ({ kind: ApiResourceKind.run, id, schema: RunSchema, admit: () => undefined });
    await temp.store.sessionEvents.append(SESSION, "acme", [draftOf(use("run_other", "tc-forged", "ask"))], guard("run_other"));
    await temp.store.sessionEvents.append(SESSION, "acme", [draftOf(use(RUN, "tc-quiet", "allow"))], guard(RUN));
    expect(await codeOf(confirm("tc-forged"))).toBe(Code.NotFound);
    expect(await codeOf(confirm("tc-quiet"))).toBe(Code.NotFound);
  });

  it("reads a run's asked events past one page", async () => {
    const asks: Ask[] = Array.from({ length: 1001 }, (_, i) => ({ callId: `tc-${i}`, name: "shell" }));
    await seedLogOnly(asks);
    const granted = await grantPermission(
      deps(),
      create(GrantPermissionInputSchema, { sessionId: SESSION, toolUseId: `${RUN}.tc-1000` }),
      testCallerIdentity(),
    );
    expect(granted.grant).toBeDefined();
    expect(granted.confirmations).toHaveLength(1001);
  }, 30_000);

  it("a store fault reading the ask, or whether it is open, is Internal", async () => {
    await seedLogOnly([{ callId: "tc-1", name: "Write" }]);
    const withLog = (sessionEvents: Partial<Store["sessionEvents"]>): SessionAnswerDeps => ({
      ...deps(),
      store: new Proxy(temp.store, {
        get(target, key, receiver) {
          return key === "sessionEvents"
            ? { ...target.sessionEvents, list: target.sessionEvents.list.bind(target.sessionEvents), openGates: target.sessionEvents.openGates.bind(target.sessionEvents), ...sessionEvents }
            : Reflect.get(target, key, receiver);
        },
      }),
    });
    expect(await codeOf(confirm("tc-1", withLog({ list: () => Promise.reject(new Error("disk")) })))).toBe(Code.Internal);
    expect(await codeOf(confirm("tc-1", withLog({ openGates: () => Promise.reject(new Error("disk")) })))).toBe(Code.Internal);
  });
});
