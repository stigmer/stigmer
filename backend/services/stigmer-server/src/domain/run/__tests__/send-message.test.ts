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
 * instead; a message queued while nothing works (a turn ended in between,
 * or a queue nothing started) has the queue's turn started at once, and
 * the reply names that turn when it reads the message; a queued message
 * keeps the person its turn would record; a refused admission
 * takes back the files and decides nothing. A queued turn keeps the
 * organization its admission settled. Run create (createTurn) admits then
 * starts, taking back the files of a turn that failed.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { errorReasonOf, permissionDeniedError } from "../../../pipeline/errors.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../session/events/run-writes.js";
import {
  SEND_MESSAGE_NEEDS_SESSION_MESSAGE,
  SESSION_TURN_PAUSED_REASON,
  SESSION_TURN_WAITS_FOR_ANSWER_REASON,
} from "../constants.js";
import { runPersonOfCaller } from "../../vault/resolve.js";
import { queuedTurnOf } from "../../session/events/queue.js";
import { createTurn, sendMessage } from "../send-message.js";
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
    deps = {
      ...deps,
      queuedTurns: async (sessionId) => {
        queuedTurns.push(sessionId);
        const queued = await temp.store.sessionEvents.queued(sessionId);
        return create(RunSchema, {
          metadata: { id: "run_q" },
          spec: { queuedMessageIds: queued.map((each) => each.record.eventId) },
        });
      },
    };
    const reply = await sendMessage(deps, message("hello"), caller);
    expect(queuedTurns).toEqual(["s1"]);
    expect(reply.run?.metadata?.id).toBe("run_q");
    expect(reply.message?.runId, "the queue's turn wrote no message here, so the queued one answers").toBe("");
  });

  it("starts a queue nothing works on when a message is sent, naming no turn that does not read it", async () => {
    await working();
    await sendMessage(deps, message("one"), caller);
    await updateRunAppendingEvents(deps, "a", (run) => {
      run.status!.phase = RunPhase.RUN_FAILED;
    });
    deps = {
      ...deps,
      queuedTurns: async (sessionId) => {
        queuedTurns.push(sessionId);
        const [oldest] = await temp.store.sessionEvents.queued(sessionId);
        return create(RunSchema, { metadata: { id: "run_q" }, spec: { queuedMessageIds: [oldest!.record.eventId] } });
      },
    };
    const reply = await sendMessage(deps, message("two"), caller);
    expect(calls).toEqual(["admit", "admit"]);
    expect(queuedTurns).toEqual(["s1"]);
    expect(reply.run).toBeUndefined();
    expect(reply.message?.runId).toBe("");
  });

  it("answers the queue's turn with the message as it read it", async () => {
    await working();
    await sendMessage(deps, message("one"), caller);
    await updateRunAppendingEvents(deps, "a", (run) => {
      run.status!.phase = RunPhase.RUN_COMPLETED;
    });
    deps = {
      ...deps,
      queuedTurns: async (sessionId) => {
        const queued = await temp.store.sessionEvents.queued(sessionId);
        const turn = create(RunSchema, {
          metadata: { id: "run_q", org: "acme" },
          spec: {
            target: { case: "sessionId", value: sessionId },
            queuedMessageIds: queued.map((each) => each.record.eventId),
          },
          status: { phase: RunPhase.RUN_PENDING },
        });
        await createRunAppendingEvents(deps, turn);
        return turn;
      },
    };
    const reply = await sendMessage(deps, message("two"), caller);
    expect(reply.run?.metadata?.id).toBe("run_q");
    expect(reply.message?.runId).toBe("run_q");
    expect(reply.message?.event.case === "userMessage" && reply.message.event.value.content[0]?.text).toBe("two");
  });

  it("keeps the person the message's turn would record with the queued message, its authority", async () => {
    await working();
    await sendMessage(deps, message("mine"), caller);
    const [queued] = await temp.store.sessionEvents.queued("s1");
    expect(queuedTurnOf(queued!).status?.credentials?.person ?? "").toBe(runPersonOfCaller(caller) ?? "");
  });

  it("refuses the message when the working turn starts waiting between the decision and the enqueue", async () => {
    await working();
    let reads = 0;
    deps = {
      ...deps,
      store: new Proxy(temp.store, {
        get(target, property, receiver) {
          if (property === "writeSessionQueue") {
            return async (...args: Parameters<typeof target.writeSessionQueue>) => {
              reads += 1;
              if (reads === 2) {
                await updateRunAppendingEvents({ store: target, sessionEventBroker: deps.sessionEventBroker }, "a", (run) => {
                  run.status!.phase = RunPhase.RUN_WAITING_FOR_APPROVAL;
                });
              }
              return target.writeSessionQueue(...args);
            };
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    await expect(sendMessage(deps, message("x"), caller)).rejects.toSatisfy(
      (error) =>
        JSON.stringify(refusal(error)) === JSON.stringify([Code.FailedPrecondition, SESSION_TURN_WAITS_FOR_ANSWER_REASON]),
    );
    expect(calls).toEqual(["admit", "undo"]);
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

describe("the turn a message would start", () => {
  it("takes the organization its admission settled when the request named none", async () => {
    await working();
    const request = message("hello");
    request.metadata!.org = "";
    await sendMessage(deps, request, caller);
    const [queued] = await temp.store.sessionEvents.queued("s1");
    expect(fromBinary(RunSchema, queued!.turn).metadata?.org).toBe("acme");
  });

  it("is an internal fault when a started turn's message is not in the log", async () => {
    deps = {
      ...deps,
      chain: {
        ...chain(),
        start: async (reqCtx) => {
          reqCtx.newState.status!.phase = RunPhase.RUN_PENDING;
          await temp.store.saveResource(ApiResourceKind.run, reqCtx.newState.metadata!.id, RunSchema, reqCtx.newState);
        },
      },
    };
    await expect(sendMessage(deps, message("hello"), caller)).rejects.toSatisfy(
      (error) => error instanceof ConnectError && error.code === Code.Internal,
    );
  });
});

describe("createTurn", () => {
  it("admits then starts, and answers the started turn", async () => {
    const reqCtx = new RequestContext(RunSchema, message("hello"), caller, ApiResourceKind.run);
    const run = await createTurn(chain(), reqCtx);
    expect(calls).toEqual(["admit", "start"]);
    expect(run.metadata?.id).toBe("run_1");
  });

  it("takes back the files of a turn whose start failed", async () => {
    beforeStart = async () => {
      throw permissionDeniedError("a gate refused");
    };
    const reqCtx = new RequestContext(RunSchema, message("hello"), caller, ApiResourceKind.run);
    await expect(createTurn(chain(), reqCtx)).rejects.toThrow("a gate refused");
    expect(calls).toEqual(["admit", "start", "undo"]);
  });
});
