/**
 * Pins the answers to a waiting tool use (../confirm-tool-use.ts,
 * ../grant-permission.ts, through the core ../answer.ts) on a real store:
 * served on the session's command service under can_edit on the session;
 * an allow or a deny (with its message) recorded as one
 * user.tool_confirmation in the tool use's thread, the row stamped, the
 * pending approvals and the session's status recomputed (requires_action
 * with the remainder, running once nothing is left), and the turn
 * signalled only then; a replay answered from the log without reaching the
 * gate slot, a contrary answer refused; a tool use that is not one of the
 * session's asks not found; a grant answering every waiting call of its
 * class with one grant event, and a call with no class allowed alone; the
 * gate slot reading the answer whichever method carried it. A store fault
 * is an Internal that names no detail; a workflow that cannot be signalled
 * is Unavailable, and one that no longer runs fails the run.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  RunPhase,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

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
import { StreamBroker } from "../../../run/stream-broker.js";
import { registerSessionServices } from "../../controller.js";
import type { SessionControllerDeps } from "../../controller.js";
import { SessionEventBroker } from "../../events/broker.js";
import { eventTypeOf } from "../../events/catalog.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { approvalAnswerOf, toolConfirmationEventId } from "../answer.js";
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

/** A turn of the session waiting on `calls`, its asks in the log as the runner writes them. */
async function seedWaiting(
  calls: ReadonlyArray<Call>,
  options: { runId?: string; sessionId?: string; subAgent?: ReadonlyArray<Call> } = {},
): Promise<Run> {
  const runId = options.runId ?? RUN;
  const row = (call: Call) => ({
    id: call.id,
    name: call.name,
    mcpServerSlug: call.server ?? "",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: call.asks ?? true,
    ...(call.hook === undefined ? {} : { approvalPolicySource: ApprovalPolicySource.HOOK, approvalPolicyHook: call.hook }),
  });
  const run = create(RunSchema, {
    metadata: { id: runId, org: "acme" },
    spec: { target: { case: "sessionId", value: options.sessionId ?? SESSION }, message: "tidy up" },
    status: {
      phase: RunPhase.RUN_IN_PROGRESS,
      messages: [{ toolCalls: calls.map(row) }],
      subAgentRuns:
        options.subAgent === undefined
          ? []
          : [{ id: "task-1", name: "explorer", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS, messages: [{ toolCalls: options.subAgent.map(row) }] }],
    },
  });
  const writeDeps = { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
  await createRunAppendingEvents(writeDeps, run);
  await appendAsks(temp.store, runId);
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
      case "userToolConfirmation":
        return [`${type} ${event.event.value.toolUseId} ${event.event.value.result}${event.event.value.denyMessage === "" ? "" : ` "${event.event.value.denyMessage}"`}`];
      case "stigmerPermissionGrant":
        return [`${type} ${event.event.value.toolUseId}`];
      case "sessionStatusIdle":
        return [`${type} ${event.event.value.stopReason?.type} [${event.event.value.stopReason?.eventIds.join(",")}]`];
      case "agentToolUse":
      case "agentMcpToolUse":
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

function callOf(run: Run, callId: string) {
  return [...(run.status?.messages ?? []), ...(run.status?.subAgentRuns.flatMap((s) => s.messages) ?? [])]
    .flatMap((m) => m.toolCalls)
    .find((tc) => tc.id === callId);
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
  it("records an allow, stamps the row, clears the gate, goes running and signals the turn once", async () => {
    await seedWaiting([{ id: "tc-1", name: "write" }]);
    const answer = await confirm(use("tc-1"), "allow");
    expect(answer.event.case).toBe("userToolConfirmation");
    expect(answer.event.value?.id).toBe(toolConfirmationEventId(use("tc-1")));
    const run = await stored();
    expect(callOf(run, "tc-1")?.approvalAction).toBe(ApprovalAction.APPROVE);
    expect(callOf(run, "tc-1")?.approvedBy).toBe(testCallerIdentity().identityId);
    expect(run.status?.pendingApprovals).toEqual([]);
    expect(await logAfterAsks()).toEqual([
      "session.status_running",
      `session.status_idle requires_action [${use("tc-1")}]`,
      `user.tool_confirmation ${use("tc-1")} allow`,
      "session.status_running",
    ]);
    expect(signalled).toEqual([RUN]);
    expect(slotAnswers.map((a) => [a.toolUseId, a.toolCallId, a.result, a.grant, a.run.metadata?.id])).toEqual([
      [use("tc-1"), "tc-1", "allow", false, RUN],
    ]);
  });

  it("records a deny with its message for the agent, stamped REJECT; a message on an allow is refused", async () => {
    await seedWaiting([{ id: "tc-1", name: "shell" }]);
    expect((await refusal(confirm(use("tc-1"), "allow", "why"))).code).toBe(Code.InvalidArgument);
    const answer = await confirm(use("tc-1"), "deny", "use make clean instead");
    expect(answer.event.case === "userToolConfirmation" && answer.event.value.denyMessage).toBe("use make clean instead");
    expect(callOf(await stored(), "tc-1")?.approvalAction).toBe(ApprovalAction.REJECT);
  });

  it("answering one of two re-states requires_action with the remainder and signals nothing until the last", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-2", name: "shell" },
    ]);
    await confirm(use("tc-1"), "allow");
    expect((await stored()).status?.pendingApprovals.map((p) => p.toolCallId)).toEqual(["tc-2"]);
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
    expect(slotAnswers.map((a) => a.toolUseId)).toEqual([use("tc-2")]);
  });

  it("answers a sub-agent's ask in the sub-agent's thread", async () => {
    await seedWaiting([], { subAgent: [{ id: "tc-s", name: "write" }] });
    const answer = await confirm(use("tc-s"), "allow");
    expect(answer.threadId).toBe(use("task-1"));
    expect(answer.event.case === "userToolConfirmation" && answer.event.value.sessionThreadId).toBe(use("task-1"));
    expect(callOf(await stored(), "tc-s")?.approvalAction).toBe(ApprovalAction.APPROVE);
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
    const run = await stored();
    expect(callOf(run, "tc-shell-1")?.approvalAction).toBe(ApprovalAction.APPROVE_ALL);
    expect(callOf(run, "tc-shell-2")?.approvalAction).toBe(ApprovalAction.APPROVE);
    expect(callOf(run, "tc-write")?.approvalAction).toBe(ApprovalAction.UNSPECIFIED);
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
    expect(callOf(await stored(), "tc-c")?.approvalAction).toBe(ApprovalAction.UNSPECIFIED);
  });

  it("a call with no class is allowed alone, with no grant", async () => {
    await seedWaiting([
      { id: "tc-read", name: "read_file" },
      { id: "tc-read-2", name: "read_file" },
    ]);
    const response = await grant(use("tc-read"));
    expect(response.grant).toBeUndefined();
    expect(response.confirmations).toHaveLength(1);
    expect(callOf(await stored(), "tc-read")?.approvalAction).toBe(ApprovalAction.APPROVE);
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

  it("a row stamped with a decision the log does not hold, or no longer waiting, is not answered again", async () => {
    await seedWaiting([
      { id: "tc-1", name: "write" },
      { id: "tc-2", name: "write" },
    ]);
    await temp.store.updateResource(ApiResourceKind.run, RUN, RunSchema, (r) => {
      r.status!.messages[0]!.toolCalls[0]!.approvalAction = ApprovalAction.APPROVE;
      r.status!.messages[0]!.toolCalls[1]!.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    });
    expect((await refusal(confirm(use("tc-1"), "allow"))).code).toBe(Code.FailedPrecondition);
    expect((await refusal(confirm(use("tc-2"), "allow"))).code).toBe(Code.FailedPrecondition);
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
    expect(callOf(await stored(), "tc-1")?.approvalAction).toBe(ApprovalAction.APPROVE);
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
});

