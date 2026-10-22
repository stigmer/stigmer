/**
 * Pins RunCommandController.sendMessage's orchestration (../send-message.ts)
 * over a real store, with the run create chain's two halves stood in (the
 * chain itself is pinned where it is built): a message names an existing
 * session; it is admitted before anything is decided; with nothing holding
 * the session its turn starts and the reply names the turn's user.message
 * and the run; with a turn working it is queued and the reply is the
 * queued user.message; a turn waiting for an answer or paused refuses it
 * (FAILED_PRECONDITION with its reason) and takes back its files; a turn
 * that started between the decision and the start queues the message
 * instead; a message queued while nothing works has the queue's turn
 * started at once, and the reply names that turn; a refused admission
 * takes back the files and decides nothing.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { errorReasonOf, permissionDeniedError } from "../../../pipeline/errors.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { RequestContext } from "../../../pipeline/request-context.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../session/events/run-writes.js";
import {
  SEND_MESSAGE_NEEDS_SESSION_MESSAGE,
  SESSION_TURN_PAUSED_REASON,
  SESSION_TURN_WAITS_FOR_ANSWER_REASON,
} from "../constants.js";
import { sendMessage } from "../send-message.js";
import type { SendMessageDeps, TurnChain } from "../send-message.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const caller = testCallerIdentity({ identityId: "person-a" });

let temp: TempStore;
let calls: string[];
let nextId: number;
let beforeStart: () => Promise<void>;
let afterRefusal: () => Promise<void>;
let admitFails: boolean;
let queuedTurns: Array<string>;
let deps: SendMessageDeps;

/** The chain's two halves stood in: admission stamps an id and the files' blocks, start persists through the run write. */
function chain(): TurnChain {
  return {
    admit: async (reqCtx: RequestContext<typeof RunSchema>) => {
      calls.push("admit");
      if (admitFails) {
        throw permissionDeniedError("unauthorized to add an execution to session 's1'");
      }
      const state = reqCtx.newState;
      state.metadata = { ...state.metadata!, id: `run_${nextId++}`, org: "acme" } as Run["metadata"];
      state.spec!.fileIds = (state.spec?.fileIds ?? []).map((id) => `copy-of-${id}`);
      state.status = create(RunStatusSchema, {
        messageFiles: (state.spec?.fileIds ?? []).map((fileId) => ({ type: "document", source: { type: "file", fileId } })),
      });
    },
    start: async (reqCtx: RequestContext<typeof RunSchema>) => {
      calls.push("start");
      await beforeStart();
      reqCtx.newState.status!.phase = RunPhase.RUN_PENDING;
      try {
        await createRunAppendingEvents(deps, reqCtx.newState);
      } catch (error) {
        await afterRefusal();
        throw error;
      }
    },
    undo: async () => {
      calls.push("undo");
    },
  };
}

beforeEach(() => {
  temp = tempStore();
  calls = [];
  nextId = 1;
  beforeStart = async () => {};
  afterRefusal = async () => {};
  admitFails = false;
  queuedTurns = [];
  deps = {
    store: temp.store,
    logger: silentLogger,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    chain: chain(),
    queuedTurns: async (sessionId) => {
      queuedTurns.push(sessionId);
      return undefined;
    },
  };
});

afterEach(async () => {
  await temp.cleanup();
});

function message(text: string, fileIds: string[] = [], sessionId = "s1"): Run {
  return create(RunSchema, {
    metadata: { name: "run-1", org: "acme" },
    spec: {
      target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId },
      message: text,
      fileIds,
    },
  });
}

async function working(id = "a"): Promise<void> {
  await createRunAppendingEvents(
    deps,
    create(RunSchema, {
      metadata: { id, org: "acme" },
      spec: { target: { case: "sessionId", value: "s1" }, message: "build it" },
      status: { phase: RunPhase.RUN_PENDING },
    }),
  );
}

function refusal(error: unknown): [Code, string | undefined] {
  return error instanceof ConnectError ? [error.code, errorReasonOf(error)] : [Code.Unknown, undefined];
}

describe("sendMessage", () => {
  it("refuses a message that names no existing session, before anything runs", async () => {
    await expect(sendMessage(deps, message("hi", [], ""), caller)).rejects.toThrow(SEND_MESSAGE_NEEDS_SESSION_MESSAGE);
    expect(calls).toEqual([]);
  });

  it("starts the turn when nothing holds the session, answering its user.message and the run", async () => {
    const reply = await sendMessage(deps, message("hello"), caller);
    expect(calls).toEqual(["admit", "start"]);
    expect(reply.run?.metadata?.id).toBe("run_1");
    expect(reply.message?.runId).toBe("run_1");
    expect(reply.message?.event.case === "userMessage" && reply.message.event.value.processedAt).not.toBe("");
  });

  it("queues the message while a turn works, with the files it was admitted with, and starts nothing", async () => {
    await working();
    const reply = await sendMessage(deps, message("also the README", ["file_1"]), caller);
    expect(calls).toEqual(["admit"]);
    expect(reply.run).toBeUndefined();
    expect(reply.message?.runId).toBe("");
    const content = reply.message?.event.case === "userMessage" ? reply.message.event.value.content : [];
    expect(content.map((block) => [block.type, block.text, block.source?.fileId ?? ""])).toEqual([
      ["text", "also the README", ""],
      ["document", "", "copy-of-file_1"],
    ]);
    const [queued] = await temp.store.sessionEvents.queued("s1");
    expect(queued?.sender).toBe("person-a");
    expect(queuedTurns).toEqual([]);
  });

  it("refuses the message while a turn waits for an answer or is paused, and takes back its files", async () => {
    await working();
    await updateRunAppendingEvents(deps, "a", (run) => {
      run.status!.phase = RunPhase.RUN_WAITING_FOR_APPROVAL;
    });
    await expect(sendMessage(deps, message("x"), caller)).rejects.toSatisfy(
      (error) =>
        JSON.stringify(refusal(error)) === JSON.stringify([Code.FailedPrecondition, SESSION_TURN_WAITS_FOR_ANSWER_REASON]),
    );
    expect(calls).toEqual(["admit", "undo"]);
    await updateRunAppendingEvents(deps, "a", (run) => {
      run.status!.phase = RunPhase.RUN_PAUSED;
    });
    await expect(sendMessage(deps, message("x"), caller)).rejects.toSatisfy(
      (error) => JSON.stringify(refusal(error)) === JSON.stringify([Code.FailedPrecondition, SESSION_TURN_PAUSED_REASON]),
    );
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
  });

  it("queues the message when another turn started between the decision and the start", async () => {
    beforeStart = async () => {
      beforeStart = async () => {};
      await working("b");
    };
    const reply = await sendMessage(deps, message("hello"), caller);
    expect(calls).toEqual(["admit", "start"]);
    expect(reply.run).toBeUndefined();
    expect(reply.message?.runId).toBe("");
    expect(await temp.store.sessionEvents.queued("s1")).toHaveLength(1);
  });

  it("starts the queue's turn at once for a message queued while nothing works, and answers that turn", async () => {
    // A turn starts between the decision and the start, and ends before
    // the message is queued: nothing works as it is queued.
    beforeStart = async () => {
      beforeStart = async () => {};
      await working("b");
    };
    afterRefusal = async () => {
      await updateRunAppendingEvents(deps, "b", (run) => {
        run.status!.phase = RunPhase.RUN_COMPLETED;
      });
    };
    const started = create(RunSchema, { metadata: { id: "run_q" } });
    deps = {
      ...deps,
      queuedTurns: async (sessionId) => {
        queuedTurns.push(sessionId);
        return started;
      },
    };
    const reply = await sendMessage(deps, message("hello"), caller);
    expect(queuedTurns).toEqual(["s1"]);
    expect(reply.run?.metadata?.id).toBe("run_q");
    expect(reply.message?.runId, "the queue's turn wrote no message here, so the queued one answers").toBe("");
  });

  it("takes back the files and decides nothing when the admission refuses", async () => {
    admitFails = true;
    await expect(sendMessage(deps, message("x"), caller)).rejects.toThrow("unauthorized");
    expect(calls).toEqual(["admit", "undo"]);
  });

  it("lets a start's own refusal through, its files taken back", async () => {
    beforeStart = async () => {
      throw permissionDeniedError("a gate refused");
    };
    await expect(sendMessage(deps, message("x"), caller)).rejects.toThrow("a gate refused");
    expect(calls).toEqual(["admit", "start", "undo"]);
  });
});
