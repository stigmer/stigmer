/**
 * Pins the host app's answer to a call of one of its own tools
 * (../answer-custom-tool-use.ts, through the core ../answer.ts) on a real
 * store: the call opens its gate in the log and the session idles with
 * requires_action naming it; the answer, under can_edit on the session, is
 * one user.custom_tool_result carrying the text and is_error as sent, under
 * the derived `sevt_ctr_` id; the turn is signalled once no gate of the run
 * is left, an approval waiting beside the call included; a replay answers
 * the recorded event and a different answer is refused; a call is answered
 * only by its own kind of answer (an approval never answers a host's call,
 * nor a host's result a person's ask); a stopped turn's call no longer
 * waits; content other than text, or more text than the limit, is refused
 * before anything is read. The approval gate slot never runs: a host's
 * answer is no approval.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  AnswerCustomToolUseInputSchema,
  ConfirmToolUseInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../../../extensions/gate-slots.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import type { PipelineStep } from "../../../../pipeline/pipeline.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { stubConnectedEngine } from "../../../run/__tests__/engine-stub.js";
import type { ExecutionEngineState } from "../../../run/engine.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { toolUseEventId } from "../../events/ids.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { answerCustomToolUse } from "../answer-custom-tool-use.js";
import { MAX_CUSTOM_RESULT_CHARS, customToolResultEventId } from "../answer.js";
import { confirmToolUse } from "../confirm-tool-use.js";
import type { SessionAnswerDeps } from "../confirm-tool-use.js";
import { appendAsks } from "./asks.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_1";
const RUN = "run_1";

let temp: TempStore;
let signalled: string[];
let slotRuns: number;

beforeEach(() => {
  temp = tempStore();
  signalled = [];
  slotRuns = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

const countingSlot: ResolvedGateSteps = new Map([
  [
    "agent-execution-submit-approval:gate",
    [
      {
        name: "CountApprovals",
        execute() {
          slotRuns += 1;
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
    gateSteps: countingSlot,
    statusObservers: [],
  };
}

const writeDeps = () => ({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) });
const use = (callId: string) => toolUseEventId(RUN, callId);

/** A turn waiting on the host's calls `custom` and the person's asks `asks`, as the runner writes them. */
async function seedWaiting(custom: readonly string[], asks: readonly string[] = []): Promise<void> {
  await createRunAppendingEvents(
    writeDeps(),
    create(RunSchema, {
      metadata: { id: RUN, org: "acme" },
      spec: { target: { case: "sessionId", value: SESSION }, message: "register it" },
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    }),
  );
  await appendAsks(temp.store, RUN, asks.map((id) => ({ id, name: "write" })));
  await temp.store.sessionEvents.append(
    SESSION,
    "acme",
    custom.map((id) =>
      draftOf(
        create(SessionEventSchema, {
          runId: RUN,
          event: { case: "agentCustomToolUse", value: { id: use(id), name: "show_form", input: { service: id } } },
        }),
      ),
    ),
    { kind: ApiResourceKind.run, id: RUN, schema: RunSchema, admit: () => undefined },
  );
  await updateRunAppendingEvents(writeDeps(), RUN, (r) => {
    r.status!.phase = RunPhase.RUN_WAITING_FOR_APPROVAL;
  });
}

function answer(toolUseId: string, text: string | readonly string[], isError = false, d = deps()) {
  const texts = typeof text === "string" ? [text] : text;
  return answerCustomToolUse(
    d,
    create(AnswerCustomToolUseInputSchema, {
      sessionId: SESSION,
      customToolUseId: toolUseId,
      content: texts.map((t) => ({ type: "text", text: t })),
      isError,
    }),
    testCallerIdentity(),
  );
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

/** The session's status and answers, as `<type>[ <detail>]`. */
async function log(): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(SESSION, { order: "asc", limit: 200 });
  return records.map(eventOf).flatMap((event) => {
    const type = eventTypeOf(event);
    switch (event.event.case) {
      case "sessionStatusIdle":
        return [`${type} ${event.event.value.stopReason?.type} [${event.event.value.stopReason?.eventIds.join(",")}]`];
      case "sessionStatusRunning":
        return [type];
      case "userCustomToolResult":
        return [`${type} ${event.event.value.customToolUseId} ${event.event.value.isError ? "error" : "ok"} ${JSON.stringify(event.event.value.content.map((b) => b.text))}`];
      case "userToolConfirmation":
        return [`${type} ${event.event.value.toolUseId} ${event.event.value.result}`];
      default:
        return [];
    }
  });
}

async function openCalls(): Promise<string[]> {
  return (await temp.store.sessionEvents.openGates(SESSION, RUN)).map((gate) => gate.toolUseId);
}

describe("answerCustomToolUse", () => {
  it("records the host's answer as the call's result, clears the gate and signals the turn once; no approval slot runs", async () => {
    await seedWaiting(["cu-1"]);
    expect(await openCalls()).toEqual([use("cu-1")]);
    const recorded = await answer(use("cu-1"), ["registered", " as svc_payments"]);
    expect(recorded.event.case).toBe("userCustomToolResult");
    expect(recorded.event.value?.id).toBe(customToolResultEventId(use("cu-1")));
    expect(recorded.runId).toBe(RUN);
    expect(await openCalls()).toEqual([]);
    expect(await log()).toEqual([
      "session.status_running",
      `session.status_idle requires_action [${use("cu-1")}]`,
      `user.custom_tool_result ${use("cu-1")} ok ["registered"," as svc_payments"]`,
      "session.status_running",
    ]);
    expect(signalled).toEqual([RUN]);
    expect(slotRuns).toBe(0);
  });

  it("records is_error, which the agent reads as the tool's failure", async () => {
    await seedWaiting(["cu-1"]);
    const recorded = await answer(use("cu-1"), "the person cancelled the form", true);
    expect(recorded.event.case === "userCustomToolResult" && recorded.event.value.isError).toBe(true);
    expect(signalled).toEqual([RUN]);
  });

  it("a replay answers the recorded event without a second write or signal; a different answer is refused", async () => {
    await seedWaiting(["cu-1"]);
    const first = await answer(use("cu-1"), "done");
    const again = await answer(use("cu-1"), "done");
    expect(again.event.value?.id).toBe(first.event.value?.id);
    expect(again.seq).toBe(first.seq);
    expect(signalled).toEqual([RUN]);
    for (const other of [answer(use("cu-1"), "other text"), answer(use("cu-1"), "done", true), answer(use("cu-1"), ["do", "ne"])]) {
      const error = await refusal(other);
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(`tool use ${use("cu-1")} was already answered otherwise; an answer is final`);
    }
    expect((await log()).filter((line) => line.startsWith("user.custom_tool_result"))).toHaveLength(1);
  });

  it("with an approval waiting beside it, re-states requires_action with the approval and signals only once both are answered", async () => {
    await seedWaiting(["cu-1"], ["tc-1"]);
    expect(await openCalls()).toEqual([use("tc-1"), use("cu-1")]);
    await answer(use("cu-1"), "done");
    expect(signalled).toEqual([]);
    expect(await openCalls()).toEqual([use("tc-1")]);
    await confirmToolUse(deps(), create(ConfirmToolUseInputSchema, { sessionId: SESSION, toolUseId: use("tc-1"), result: "allow" }), testCallerIdentity());
    expect(await log()).toEqual([
      "session.status_running",
      `session.status_idle requires_action [${use("tc-1")},${use("cu-1")}]`,
      `user.custom_tool_result ${use("cu-1")} ok ["done"]`,
      `session.status_idle requires_action [${use("tc-1")}]`,
      `user.tool_confirmation ${use("tc-1")} allow`,
      "session.status_running",
    ]);
    expect(signalled).toEqual([RUN]);
    expect(slotRuns).toBe(1);
  });

  it("answers each call only with its own kind of answer: an approval's call and a host's call are not found to the other", async () => {
    await seedWaiting(["cu-1"], ["tc-1"]);
    const approvalAnswered = await refusal(answer(use("tc-1"), "done"));
    expect(approvalAnswered.code).toBe(Code.NotFound);
    expect(approvalAnswered.rawMessage).toContain(use("tc-1"));
    const hostAnswered = await refusal(
      confirmToolUse(deps(), create(ConfirmToolUseInputSchema, { sessionId: SESSION, toolUseId: use("cu-1"), result: "allow" }), testCallerIdentity()),
    );
    expect(hostAnswered.code).toBe(Code.NotFound);
    expect((await refusal(answer(use("cu-missing"), "done"))).code).toBe(Code.NotFound);
    expect((await refusal(answer("no-run-prefix", "done"))).code).toBe(Code.NotFound);
    expect(await openCalls()).toEqual([use("tc-1"), use("cu-1")]);
    expect(signalled).toEqual([]);
  });

  it("asks can_edit on the session before reading anything, and a denial writes nothing", async () => {
    await seedWaiting(["cu-1"]);
    const before = await log();
    const checks: AuthzCheck[] = [];
    const denying: Authorizer = {
      authorize: async (_caller, check) => {
        checks.push(check);
        return { kind: "deny", reason: "not an editor" };
      },
    };
    expect((await refusal(answer(use("cu-1"), "done", false, deps(denying)))).code).toBe(Code.PermissionDenied);
    expect(checks.map((c) => [c.permission, c.resourceKind, c.resourceId])).toEqual([[IamPermission.can_edit, ApiResourceKind.session, SESSION]]);
    expect(await log()).toEqual(before);
  });

  it("a call whose turn was stopped no longer waits", async () => {
    await seedWaiting(["cu-1"]);
    await updateRunAppendingEvents(writeDeps(), RUN, (r) => {
      r.status!.phase = RunPhase.RUN_CANCELLED;
    });
    const error = await refusal(answer(use("cu-1"), "done"));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(`tool use ${use("cu-1")} no longer waits: its turn is RUN_CANCELLED`);
    expect(signalled).toEqual([]);
  });

  it("refuses content other than text, or more text than the limit, before anything is read", async () => {
    await seedWaiting(["cu-1"]);
    const image = await refusal(
      answerCustomToolUse(
        deps(),
        create(AnswerCustomToolUseInputSchema, {
          sessionId: SESSION,
          customToolUseId: use("cu-1"),
          content: [{ type: "image", source: { type: "file", fileId: "file_1" } }],
        }),
        testCallerIdentity(),
      ),
    );
    expect(image.code).toBe(Code.InvalidArgument);
    expect(image.rawMessage).toBe("a custom tool's answer holds text blocks only; a block of type 'image' cannot be sent yet");
    const long = await refusal(answer(use("cu-1"), ["x".repeat(MAX_CUSTOM_RESULT_CHARS), "y"]));
    expect(long.code).toBe(Code.InvalidArgument);
    expect(long.rawMessage).toBe(`a custom tool's answer holds at most ${MAX_CUSTOM_RESULT_CHARS} characters of text; this one holds ${MAX_CUSTOM_RESULT_CHARS + 1}`);
    expect(await openCalls()).toEqual([use("cu-1")]);
  });
});
