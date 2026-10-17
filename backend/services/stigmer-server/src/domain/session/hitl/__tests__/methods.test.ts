/**
 * Pins the answers to a waiting tool use (../confirm-tool-use.ts,
 * ../grant-permission.ts, through the core ../answer.ts) on a real store:
 * served on the session's command service under can_edit on the session;
 * an allow or a deny (with its message) recorded as one
 * user.tool_confirmation in the tool use's thread, the open asks and the
 * session's status recomputed (requires_action with the remainder,
 * running once nothing is left), and the turn signalled only then; a replay answered from the log without reaching the
 * gate slot, a contrary answer refused; a tool use that is not one of the
 * session's asks not found, a purged organization's included; a grant
 * answering every waiting call of its
 * class with one grant event, and a call with no class (or whose asked
 * event the log does not hold) allowed alone; a grant an ask overtakes
 * reading the run's asks again, a bounded number of times; the gate slot
 * reading the answer whichever method carried it, with the call id the
 * tool use names. A store fault is an Internal that names no detail; a
 * workflow that cannot be signalled is Unavailable, and one that no longer
 * runs fails the run with the pinned copy, its file record kept and the
 * composed observers told.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../../extensions/authorizer.js";
import { servedMethods } from "../../../../extensions/__tests__/composed-support.js";
import type { ResolvedGateSteps } from "../../../../extensions/gate-slots.js";
import { testCallerIdentity, untouchable } from "../../../../pipeline/__tests__/support.js";
import type { PipelineStep } from "../../../../pipeline/pipeline.js";
import { createApiResourceInterceptor } from "../../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { stubConnectedEngine } from "../../../run/__tests__/engine-stub.js";
import { EngineWorkflowNotFoundError } from "../../../run/engine.js";
import type { Store } from "../../../../store/interface.js";
import type { ExecutionEngineState } from "../../../run/engine.js";
import { capturedSet } from "../../../run/__tests__/file-review-seed.js";
import { updateStatus } from "../../../run/update-status.js";
import type { RunStatusTransition } from "../../../../extensions/status-hooks.js";
import { registerSessionServices } from "../../controller.js";
import type { SessionControllerDeps } from "../../controller.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { toolUseEventId } from "../../events/ids.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { approvalAnswerOf, callIdOfToolUse, toolConfirmationEventId } from "../answer.js";
import type { ApprovalAnswer } from "../answer.js";
import { confirmToolUse } from "../confirm-tool-use.js";
import type { SessionAnswerDeps } from "../confirm-tool-use.js";
import { grantPermission } from "../grant-permission.js";
import { appendAsks } from "./asks.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_1";
const RUN = "run_1";

let temp: TempStore;
let signalled: string[];
let slotAnswers: ApprovalAnswer[];

beforeEach(() => {
  temp = tempStore();
  signalled = [];
  slotAnswers = [];
});

afterEach(async () => {
  await temp.cleanup();
});

/** A gate step that records the answer it reads. */
const recordingSlot: ResolvedGateSteps = new Map([
  [
    "agent-execution-submit-approval:gate",
    [
      {
        name: "RecordAnswerSeen",
        execute(ctx) {
          slotAnswers.push(approvalAnswerOf(ctx)!);
        },
      } satisfies PipelineStep<DescMessage>,
    ],
  ],
]);

function deps(authorizer: Authorizer = newPermissiveSingleTeamAuthorizer()): SessionAnswerDeps {
  return {
    store: temp.store,
    logger: silentLogger,
    authorizer,
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
    gateSteps: recordingSlot,
    statusObservers: [],
  };
}

interface Call {
  readonly id: string;
  readonly name: string;
  readonly server?: string;
  readonly hook?: string;
  readonly asks?: boolean;
}

/**
 * A turn of the session waiting on `calls` (a call with `asks: false` ran
 * without asking, so the log holds no ask of it), its asks in the log as
 * the runner writes them; a sub-agent's in the thread of its task.
 */
async function seedWaiting(
  calls: ReadonlyArray<Call>,
  options: { runId?: string; sessionId?: string; subAgent?: ReadonlyArray<Call> } = {},
): Promise<Run> {
  const runId = options.runId ?? RUN;
  const run = create(RunSchema, {
    metadata: { id: runId, org: "acme" },
    spec: { target: { case: "sessionId", value: options.sessionId ?? SESSION }, message: "tidy up" },
    status: { phase: RunPhase.RUN_IN_PROGRESS, fileChanges: [capturedSet(`${runId}:0`)] },
  });
  const writeDeps = { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
  await createRunAppendingEvents(writeDeps, run);
  const thread = toolUseEventId(runId, "task-1");
  await appendAsks(temp.store, runId, [
    ...calls.filter((call) => call.asks !== false),
    ...(options.subAgent ?? []).map((call) => ({ ...call, threadId: thread })),
  ]);
  const { run: waiting } = await updateRunAppendingEvents(writeDeps, runId, (r) => {
    r.status!.phase = RunPhase.RUN_WAITING_FOR_APPROVAL;
  });
  return waiting;
}

const use = (callId: string, runId = RUN) => `${runId}.${callId}`;

function confirm(toolUseId: string, result: "allow" | "deny", denyMessage = "", d = deps()) {
  return confirmToolUse(d, create(ConfirmToolUseInputSchema, { sessionId: SESSION, toolUseId, result, denyMessage }), testCallerIdentity());
}

function grant(toolUseId: string, d = deps()) {
  return grantPermission(d, create(GrantPermissionInputSchema, { sessionId: SESSION, toolUseId }), testCallerIdentity());
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

/** The session's log after the asks, as `<type>[ <detail>]`. */
async function logAfterAsks(): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(SESSION, { order: "asc", limit: 200 });
  return records.map(eventOf).flatMap((event) => {
    const type = eventTypeOf(event);
    switch (event.event.case) {
      // Each turn's own phase is pinned in domain/session/events; these pins read the session's.
      case "stigmerRunStatus":
        return [];
      case "userToolConfirmation":
        return [`${type} ${event.event.value.toolUseId} ${event.event.value.result}${event.event.value.denyMessage === "" ? "" : ` "${event.event.value.denyMessage}"`}`];
      case "stigmerPermissionGrant":
        return [`${type} ${event.event.value.toolUseId}`];
      case "sessionStatusIdle":
        return [`${type} ${event.event.value.stopReason?.type} [${event.event.value.stopReason?.eventIds.join(",")}]`];
      case "agentToolUse":
      case "agentMcpToolUse":
      case "stigmerPermissionAsked":
      case "userMessage":
        return [];
      default:
        return [type];
    }
  });
}

async function stored(runId = RUN): Promise<Run> {
  return temp.store.getResource(ApiResourceKind.run, runId, RunSchema);
}

/** The call ids of the run's asks still open in the session's log. */
async function openCalls(runId = RUN): Promise<string[]> {
  return (await temp.store.sessionEvents.openGates(SESSION, runId)).map((gate) => callIdOfToolUse(runId, gate.toolUseId));
}

describe("the session's answer methods", () => {
  it("are served on the session's command service", () => {
    const served = servedMethods((router) => registerSessionServices(router, untouchable<SessionControllerDeps>("deps")))
      .filter((method) => method.parent.typeName === SessionCommandController.typeName)
      .map((method) => method.localName);
    expect(served).toEqual(expect.arrayContaining(["confirmToolUse", "grantPermission", "interrupt"]));
  });

  it("ask can_edit on the session they name before reading anything, and a denial writes nothing", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const before = await logAfterAsks();
    const checks: AuthzCheck[] = [];
    const denying: Authorizer = {
      authorize: async (_caller, check) => {
        checks.push(check);
        return { kind: "deny", reason: "not an editor" };
      },
    };
    expect((await refusal(confirm(use("tc-1"), "allow", "", deps(denying)))).code).toBe(Code.PermissionDenied);
    expect((await refusal(grant(use("tc-1"), deps(denying)))).code).toBe(Code.PermissionDenied);
    expect(checks.map((c) => [c.permission, c.resourceKind, c.resourceId])).toEqual([
      [IamPermission.can_edit, ApiResourceKind.session, SESSION],
      [IamPermission.can_edit, ApiResourceKind.session, SESSION],
    ]);
    expect(await logAfterAsks()).toEqual(before);
    expect(slotAnswers).toEqual([]);
  });
});

describe("confirmToolUse", () => {
  it("records an allow, clears the gate, goes running and signals the turn once", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const answer = await confirm(use("tc-1"), "allow");
    expect(answer.event.case).toBe("userToolConfirmation");
    expect(answer.event.value?.id).toBe(toolConfirmationEventId(use("tc-1")));
    expect(await openCalls()).toEqual([]);
    expect(await logAfterAsks()).toEqual([
      "session.status_running",
      `session.status_idle requires_action [${use("tc-1")}]`,
      `user.tool_confirmation ${use("tc-1")} allow`,
      "session.status_running",
    ]);
    expect(signalled).toEqual([RUN]);
    // The turn's file record holds a set no one has reviewed: review never
    // holds the gate, which is the turn's asks alone (stigmer#1471).
    expect((await stored()).status?.fileChanges.map((cs) => cs.id)).toEqual([`${RUN}:0`]);
    expect(slotAnswers.map((a) => [a.toolUseId, a.toolCallId, a.result, a.grant, a.run.metadata?.id])).toEqual([
      [use("tc-1"), "tc-1", "allow", false, RUN],
    ]);
  });

  it("records a deny with its message for the agent; a message on an allow is refused", async () => {
    await seedWaiting([{ id: "tc-1", name: "shell" }]);
    expect((await refusal(confirm(use("tc-1"), "allow", "why"))).code).toBe(Code.InvalidArgument);
    const answer = await confirm(use("tc-1"), "deny", "use make clean instead");
    expect(answer.event.case === "userToolConfirmation" && answer.event.value.denyMessage).toBe("use make clean instead");
    expect(await openCalls()).toEqual([]);
  });

  it("answering one of two re-states requires_action with the remainder and signals nothing until the last", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-2", name: "shell" },
    ]);
    await confirm(use("tc-1"), "allow");
    expect(await openCalls()).toEqual(["tc-2"]);
    expect(signalled).toEqual([]);
    await confirm(use("tc-2"), "deny");
    expect(await logAfterAsks()).toEqual([
      "session.status_running",
      `session.status_idle requires_action [${use("tc-1")},${use("tc-2")}]`,
      `user.tool_confirmation ${use("tc-1")} allow`,
      `session.status_idle requires_action [${use("tc-2")}]`,
      `user.tool_confirmation ${use("tc-2")} deny`,
      "session.status_running",
    ]);
    expect(signalled).toEqual([RUN]);
  });

  it("a replay answers the recorded event without reaching the slot, the write or the signal; a contrary answer is refused", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const first = await confirm(use("tc-1"), "deny", "no");
    const again = await confirm(use("tc-1"), "deny", "no");
    expect(again.event.value?.id).toBe(first.event.value?.id);
    expect(again.seq).toBe(first.seq);
    expect(slotAnswers).toHaveLength(1);
    expect(signalled).toEqual([RUN]);
    expect((await refusal(confirm(use("tc-1"), "allow"))).code).toBe(Code.FailedPrecondition);
    expect((await refusal(confirm(use("tc-1"), "deny", "other reason"))).code).toBe(Code.FailedPrecondition);
    expect((await refusal(grant(use("tc-1")))).code).toBe(Code.FailedPrecondition);
    expect((await logAfterAsks()).filter((line) => line.startsWith("user.tool_confirmation"))).toHaveLength(1);
  });

  it("two identical answers at once record one event, and both succeed", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const [a, b] = await Promise.all([confirm(use("tc-1"), "allow"), confirm(use("tc-1"), "allow")]);
    expect(a.event.value?.id).toBe(b.event.value?.id);
    expect((await logAfterAsks()).filter((line) => line.startsWith("user.tool_confirmation"))).toHaveLength(1);
  });

  it("on a purged organization's session is not found, whichever of its rows the purge has removed so far", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-2", name: "write" },
    ]);
    // The final stage sweeps the organization's event log; its runs may
    // still be stored until their kind's purge reaches them.
    await temp.store.sessionEvents.deleteByOrg("acme");
    expect((await refusal(confirm(use("tc-1"), "allow"))).code).toBe(Code.NotFound);
    // Every row gone.
    await temp.store.deleteResource(ApiResourceKind.run, RUN);
    expect((await refusal(confirm(use("tc-2"), "allow"))).code).toBe(Code.NotFound);
    expect((await refusal(grant(use("tc-2")))).code).toBe(Code.NotFound);
    expect(signalled).toEqual([]);
    expect(slotAnswers).toEqual([]);
  });

  it("a tool use that is not one of the session's asks is not found", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-quiet", name: "read", asks: false },
    ]);
    await seedWaiting([{ id: "tc-9", name: "write" }], { runId: "run_other", sessionId: "ses_other" });
    for (const toolUseId of ["no-run-part", use("tc-unknown"), use("tc-quiet"), use("tc-9", "run_other"), use("tc-1", "run_absent")]) {
      expect((await refusal(confirm(toolUseId, "allow"))).code, toolUseId).toBe(Code.NotFound);
    }
  });

  it("a call that no longer waits is refused: its turn ended, or its ask was closed by its result", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-2", name: "write" },
    ]);
    const result = create(SessionEventSchema, {
      runId: RUN,
      event: { case: "agentToolResult", value: { id: `${use("tc-2")}.r`, toolUseId: use("tc-2") } },
    });
    await temp.store.sessionEvents.append(SESSION, "acme", [draftOf(result)], {
      kind: ApiResourceKind.run,
      id: RUN,
      schema: RunSchema,
      admit: () => undefined,
    });
    expect((await refusal(confirm(use("tc-2"), "allow"))).code).toBe(Code.FailedPrecondition);
    await updateRunAppendingEvents({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) }, RUN, (r) => {
      r.status!.phase = RunPhase.RUN_CANCELLED;
    });
    expect((await refusal(confirm(use("tc-1"), "allow"))).code).toBe(Code.FailedPrecondition);
    // The closed gate is read before the slot, so neither refusal reaches it.
    expect(slotAnswers).toEqual([]);
  });

  it("answers a sub-agent's ask in the sub-agent's thread", async () => {
    await seedWaiting([], { subAgent: [{ id: "tc-s", name: "write" }] });
    const answer = await confirm(use("tc-s"), "allow");
    expect(answer.threadId).toBe(use("task-1"));
    expect(answer.event.case === "userToolConfirmation" && answer.event.value.sessionThreadId).toBe(use("task-1"));
    expect(await openCalls()).toEqual([]);
  });
});

describe("grantPermission", () => {
  it("allows the call and every waiting call of its class in one write, with one grant; another class still waits", async () => {
    await seedWaiting([
      { id: "tc-shell-1", name: "shell" },
      { id: "tc-shell-2", name: "bash" },
      { id: "tc-write", name: "Write" },
    ]);
    const response = await grant(use("tc-shell-1"));
    expect(response.grant?.event.case === "stigmerPermissionGrant" && response.grant.event.value.lease).toMatchObject({
      category: "shell",
      server: "",
      tool: "",
    });
    expect(response.confirmations.map((c) => c.event.case === "userToolConfirmation" && c.event.value.toolUseId)).toEqual([
      use("tc-shell-1"),
      use("tc-shell-2"),
    ]);
    expect(await openCalls()).toEqual(["tc-write"]);
    expect((await logAfterAsks()).slice(2)).toEqual([
      `user.tool_confirmation ${use("tc-shell-1")} allow`,
      `stigmer.permission.grant ${use("tc-shell-1")}`,
      `user.tool_confirmation ${use("tc-shell-2")} allow`,
      `session.status_idle requires_action [${use("tc-write")}]`,
    ]);
    expect(signalled).toEqual([]);
    expect(slotAnswers.map((a) => [a.toolCallId, a.grant])).toEqual([["tc-shell-1", true]]);

    const replay = await grant(use("tc-shell-1"));
    expect(replay.grant?.event.value?.id).toBe(response.grant?.event.value?.id);
    expect(replay.confirmations).toHaveLength(2);
    expect(slotAnswers).toHaveLength(1);
  });

  it("a hook's grant is that hook on that tool, and names it", async () => {
    await seedWaiting([
      { id: "tc-a", name: "execute", hook: "safety" },
      { id: "tc-b", name: "execute", hook: "safety" },
      { id: "tc-c", name: "execute" },
    ]);
    const response = await grant(use("tc-a"));
    expect(response.grant?.event.case === "stigmerPermissionGrant" && response.grant.event.value.lease).toMatchObject({
      hook: "safety",
      tool: "execute",
    });
    expect(response.confirmations).toHaveLength(2);
    expect(await openCalls()).toEqual(["tc-c"]);
  });

  it("a call with no class is allowed alone, with no grant", async () => {
    await seedWaiting([
      { id: "tc-read", name: "read_file" },
      { id: "tc-read-2", name: "read_file" },
    ]);
    const response = await grant(use("tc-read"));
    expect(response.grant).toBeUndefined();
    expect(response.confirmations).toHaveLength(1);
    expect(await openCalls()).toEqual(["tc-read-2"]);
    expect((await grant(use("tc-read"))).confirmations).toHaveLength(1);
    expect((await refusal(confirm(use("tc-read"), "deny"))).code).toBe(Code.FailedPrecondition);
    expect((await confirm(use("tc-read"), "allow")).event.case).toBe("userToolConfirmation");
  });
});

/** The store with one of its methods replaced. */
function faulty(overrides: Partial<Store>): Store {
  return new Proxy(temp.store, {
    get(target, key, receiver) {
      return key in overrides ? (overrides as Record<string | symbol, unknown>)[key] : Reflect.get(target, key, receiver);
    },
  });
}

describe("the answer core's edges", () => {
  it("each method is answered through the session's served router", async () => {
    await seedWaiting([
      { id: "tc-1", name: "shell" },
      { id: "tc-2", name: "write" },
    ]);
    const d = deps();
    const client = createClient(
      SessionCommandController,
      createRouterTransport((router) => registerSessionServices(router, d as unknown as SessionControllerDeps), {
        router: {
          interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
        },
      }),
    );
    expect((await client.confirmToolUse({ sessionId: SESSION, toolUseId: use("tc-1"), result: "allow" })).event.case).toBe(
      "userToolConfirmation",
    );
    expect((await client.grantPermission({ sessionId: SESSION, toolUseId: use("tc-2") })).confirmations).toHaveLength(1);
    expect((await refusal(client.interrupt({ sessionId: SESSION, sessionThreadId: "x" }))).code).toBe(Code.InvalidArgument);
  });

  it("a store fault loading the run, or recording the answer, is Internal", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const loadFault = { ...deps(), store: faulty({ getResource: () => Promise.reject(new Error("disk")) }) };
    expect((await refusal(confirm(use("tc-1"), "allow", "", loadFault))).code).toBe(Code.Internal);
    const writeFault = { ...deps(), store: faulty({ writeResourceAppendingEvents: () => Promise.reject(new Error("disk")) }) };
    expect((await refusal(confirm(use("tc-1"), "allow", "", writeFault))).code).toBe(Code.Internal);
  });

  it("names the gate slot the call id a tool use carries, and none for a hashed one", () => {
    expect(callIdOfToolUse(RUN, use("tc-1"))).toBe("tc-1");
    expect(callIdOfToolUse(RUN, toolUseEventId(RUN, "call with spaces"))).toBe("");
    expect(callIdOfToolUse(RUN, use("tc-1", "run_other"))).toBe("");
  });

  it("a grant whose read of the run's asks an ask overtakes reads them again, and allows that ask too", async () => {
    await seedWaiting([
      { id: "tc-shell-1", name: "shell" },
      { id: "tc-shell-2", name: "bash" },
    ]);
    let writes = 0;
    const overtaking: SessionAnswerDeps = {
      ...deps(),
      store: faulty({
        writeResourceAppendingEvents: (async (...args: Parameters<Store["writeResourceAppendingEvents"]>) => {
          if (++writes === 1) {
            // The runner's next ask lands between the grant's read and its write.
            await appendAsks(temp.store, RUN, [{ id: "tc-shell-3", name: "shell" }]);
          }
          return temp.store.writeResourceAppendingEvents(...args);
        }) as Store["writeResourceAppendingEvents"],
      }),
    };
    const response = await grant(use("tc-shell-1"), overtaking);
    expect(response.confirmations.map((c) => c.event.case === "userToolConfirmation" && c.event.value.toolUseId)).toEqual([
      use("tc-shell-1"),
      use("tc-shell-2"),
      use("tc-shell-3"),
    ]);
    expect(signalled).toEqual([RUN]);
  });

  it("a grant whose every read an ask overtakes leaves the asks it never saw waiting for their own answer", async () => {
    await seedWaiting([{ id: "tc-shell-1", name: "shell" }]);
    let writes = 0;
    const overtaking: SessionAnswerDeps = {
      ...deps(),
      store: faulty({
        writeResourceAppendingEvents: (async (...args: Parameters<Store["writeResourceAppendingEvents"]>) => {
          const callId = `tc-late-${++writes}`;
          await appendAsks(temp.store, RUN, [{ id: callId, name: "shell" }]);
          return temp.store.writeResourceAppendingEvents(...args);
        }) as Store["writeResourceAppendingEvents"],
      }),
    };
    const response = await grant(use("tc-shell-1"), overtaking);
    // Each read saw the asks before it; the last write's own late ask is left waiting.
    expect(response.confirmations.map((c) => c.event.case === "userToolConfirmation" && c.event.value.toolUseId)).toEqual([
      use("tc-shell-1"),
      use("tc-late-1"),
      use("tc-late-2"),
    ]);
    expect(await openCalls()).toEqual(["tc-late-3"]);
    expect(signalled).toEqual([]);
  });

  it("a grant on an ask whose asked event the log does not hold allows that call alone, with no grant", async () => {
    await seedWaiting([
      { id: "tc-shell-1", name: "shell" },
      { id: "tc-shell-2", name: "bash" },
    ]);
    const asked = (await temp.store.sessionEvents.list(SESSION, { order: "asc", types: ["stigmer.permission.asked"], limit: 10 }))
      .map(eventOf);
    expect(asked).toHaveLength(2);
    const fresh = tempStore();
    try {
      // The same turn in a log that lost the clicked ask's asked event.
      const writeDeps = { store: fresh.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
      const row = await stored();
      await createRunAppendingEvents(writeDeps, row);
      const uses = (await temp.store.sessionEvents.list(SESSION, { order: "asc", types: ["agent.tool_use"], limit: 10 })).map(eventOf);
      await fresh.store.sessionEvents.append(SESSION, "acme", [...uses, asked[1]!].map(draftOf), {
        kind: ApiResourceKind.run,
        id: RUN,
        schema: RunSchema,
        admit: () => undefined,
      });
      const response = await grant(use("tc-shell-1"), { ...deps(), store: fresh.store });
      expect(response.grant).toBeUndefined();
      expect(response.confirmations).toHaveLength(1);
    } finally {
      await fresh.cleanup();
    }
  });

  it("an engine that cannot be signalled is Unavailable; the answer stands", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const d: SessionAnswerDeps = {
      ...deps(),
      engineState: () =>
        ({
          connected: true,
          engine: stubConnectedEngine({ signalApprovalGateResolved: () => Promise.reject(new Error("timeout")) }),
        }) as ExecutionEngineState,
    };
    expect((await refusal(confirm(use("tc-1"), "allow", "", d))).code).toBe(Code.Unavailable);
    expect(await openCalls()).toEqual([]);
  });

  it("a workflow that no longer runs fails the run with the pinned copy, keeps its file record and tells the observers", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const observed: RunStatusTransition[] = [];
    const d: SessionAnswerDeps = {
      ...deps(),
      engineState: () =>
        ({
          connected: true,
          engine: stubConnectedEngine({
            signalApprovalGateResolved: (runId) => Promise.reject(new EngineWorkflowNotFoundError(runId)),
          }),
        }) as ExecutionEngineState,
      statusObservers: [(t) => void observed.push(t)],
    };
    const error = await refusal(confirm(use("tc-1"), "allow", "", d));
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      `workflow not running for execution ${RUN} - the backing workflow has terminated unexpectedly and the execution has been marked as failed`,
    ]);
    const run = await stored();
    expect(run.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(run.status?.error).toBe(
      "Workflow backing this execution is no longer running. Execution has been marked as failed.",
    );
    expect(run.status?.fileChanges.map((cs) => cs.id)).toEqual([`${RUN}:0`]);
    expect(observed.map((t) => [t.oldPhase, t.newPhase, t.run.metadata?.id])).toEqual([
      [RunPhase.RUN_WAITING_FOR_APPROVAL, RunPhase.RUN_FAILED, RUN],
    ]);
    expect(
      (await logAfterAsks()).filter((line) => line.startsWith("user.tool_confirmation")),
      "the answer stays in the session's log",
    ).toEqual([`user.tool_confirmation ${use("tc-1")} allow`]);
  });

  it("a workflow that no longer runs fails the run; a fault saving that is logged and the refusal stands", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const gone = stubConnectedEngine({
      signalApprovalGateResolved: (runId) => Promise.reject(new EngineWorkflowNotFoundError(runId)),
    });
    const lines: string[] = [];
    let writes = 0;
    const d: SessionAnswerDeps = {
      ...deps(),
      logger: createLogger({ level: "error", pretty: false, write: (line) => void lines.push(line) }),
      engineState: () => ({ connected: true, engine: gone }) as ExecutionEngineState,
      store: faulty({
        writeResourceAppendingEvents: ((...args: Parameters<Store["writeResourceAppendingEvents"]>) =>
          // The answer's write lands; the reconcile's overwrite fails.
          ++writes === 1
            ? temp.store.writeResourceAppendingEvents(...args)
            : Promise.reject(new Error("disk"))) as Store["writeResourceAppendingEvents"],
      }),
    };
    expect((await refusal(confirm(use("tc-1"), "allow", "", d))).code).toBe(Code.FailedPrecondition);
    expect(lines.join("")).toContain("Failed to reconcile stale execution status");
    expect((await stored()).status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
  });

  it("a runner's status write racing an answer never loses it: the answer is recorded once and the gate clears", async () => {
    // The runner keeps writing the waiting turn's status while a person
    // answers; both go through the run's lock-serialized write.
    const updateDeps = {
      store: temp.store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      sessionEventBroker: new SessionEventBroker(silentLogger),
      statusObservers: [],
      responseDecorators: [],
    };
    for (let i = 0; i < 20; i++) {
      const runId = `run_race_${i}`;
      await seedWaiting([{ id: "tc-1", name: "write" }], { runId });
      await Promise.all([
        updateStatus(
          updateDeps,
          create(RunUpdateStatusInputSchema, { runId, status: { phase: RunPhase.RUN_WAITING_FOR_APPROVAL } }),
          testCallerIdentity(),
        ),
        confirm(use("tc-1", runId), "allow"),
      ]);
      const answers = (await temp.store.sessionEvents.list(SESSION, { order: "asc", limit: 1000 }))
        .map(eventOf)
        .filter((event) => event.event.case === "userToolConfirmation" && event.event.value.toolUseId === use("tc-1", runId));
      expect(answers, `iteration ${i}: answer lost or doubled`).toHaveLength(1);
      expect(await openCalls(runId), `iteration ${i}: the gate stayed open`).toEqual([]);
    }
  });

  it("an answer that a stop overtakes is refused under the lock, records nothing and signals nothing", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const stopping: ResolvedGateSteps = new Map([
      [
        "agent-execution-submit-approval:gate",
        [
          {
            name: "StopLandsMeanwhile",
            async execute() {
              await updateRunAppendingEvents(
                { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) },
                RUN,
                (r) => {
                  r.status!.phase = RunPhase.RUN_CANCELLED;
                },
              );
            },
          } satisfies PipelineStep<DescMessage>,
        ],
      ],
    ]);
    expect((await refusal(confirm(use("tc-1"), "allow", "", { ...deps(), gateSteps: stopping }))).code).toBe(
      Code.FailedPrecondition,
    );
    expect((await logAfterAsks()).filter((line) => line.startsWith("user.tool_confirmation"))).toEqual([]);
    expect(await openCalls()).toEqual(["tc-1"]);
    expect(signalled).toEqual([]);
  });
});
