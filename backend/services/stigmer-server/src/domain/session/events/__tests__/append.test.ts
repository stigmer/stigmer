/**
 * Pins SessionCommandController.appendEvents (../append.ts): only the
 * runner acting for the run writes its events (the open-source decision,
 * and a composed one), only while the run is not finished, only the types
 * a runner produces, into the run's own session, whole or not at all, with
 * a resent event recognised by its id and bytes. Previews reach only the
 * streams that asked for them; stored events reach every stream.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AppendSessionEventsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../../runnerauth/runner-credential-provider.js";
import type { RunnerCredentialProvider } from "../../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../../runnerauth/runnerauth.js";
import { ResourceNotFoundError } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { NOT_THE_RUNS_RUNNER_MESSAGE, SESSION_EVENT_MAX_BYTES, appendSessionEvents } from "../append.js";
import type { AppendSessionEventsDeps } from "../append.js";
import { SessionEventBroker } from "../broker.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let broker: SessionEventBroker;
let auth: RunnerAuthService;
let credentials: RunnerCredentialProvider;

beforeEach(() => {
  temp = tempStore();
  broker = new SessionEventBroker(silentLogger);
  auth = RunnerAuthService.create(randomBytes(32));
  credentials = newExecutionScopedRunnerCredentialProvider(auth);
});

afterEach(async () => {
  await temp.cleanup();
});

function deps(overrides: Partial<AppendSessionEventsDeps> = {}): AppendSessionEventsDeps {
  return { store: temp.store, logger: silentLogger, runnerAuth: credentials, sessionEventBroker: broker, ...overrides };
}

function bearer(token: string): HandlerContext {
  return {
    requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }),
  } as unknown as HandlerContext;
}

async function seedRun(id: string, sessionId: string, phase = RunPhase.RUN_IN_PROGRESS): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      metadata: { id, org: "acme" },
      spec: { target: { case: "sessionId", value: sessionId } },
      status: { phase },
    }),
  );
}

type Input = MessageInitShape<typeof AppendSessionEventsInputSchema>;

function message(id: string, text = "hello"): NonNullable<Input["events"]>[number] {
  return { event: { case: "agentMessage", value: { id, content: [{ type: "text", text }] } } };
}

function append(input: Input, token: string, over: AppendSessionEventsDeps = deps()) {
  return appendSessionEvents(over, create(AppendSessionEventsInputSchema, input), bearer(token));
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

async function stored(sessionId: string): Promise<string[]> {
  return (await temp.store.sessionEvents.list(sessionId, { order: "asc", limit: 100 })).map((r) => r.eventId);
}

describe("the gate", () => {
  it("a credential bound to the run appends; the response carries each event's place and accepted time", async () => {
    await seedRun("run_a", "ses_a");
    const response = await append({ runId: "run_a", events: [message("m1"), message("m2")] }, auth.mintRunCredential("run_a"));
    expect(response.events.map((e) => [e.seq, e.sessionId, e.runId])).toEqual([
      [1n, "ses_a", "run_a"],
      [2n, "ses_a", "run_a"],
    ]);
    const first = response.events[0]!.event;
    expect(first.case === "agentMessage" && first.value.processedAt).toMatch(/Z$/);
    expect(first.case === "agentMessage" && [first.value.id, first.value.content]).toEqual(["m1", []]);
  });

  it("refuses no credential, garbage, and another run's credential alike, appending nothing", async () => {
    await seedRun("run_a", "ses_a");
    await seedRun("run_b", "ses_a");
    for (const token of ["", "garbage", auth.mintRunCredential("run_b")]) {
      const error = await refusal(append({ runId: "run_a", events: [message("m1")] }, token));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(NOT_THE_RUNS_RUNNER_MESSAGE);
    }
    expect(await stored("ses_a")).toEqual([]);
  });

  it("a composed decision owns the question: it admits a credential the open-source rule would refuse, and refuses one it would admit", async () => {
    await seedRun("run_a", "ses_a");
    const composed = (answer: boolean | Error): RunnerCredentialProvider => ({
      ...credentials,
      authorizeRunEventsAppend: async () => {
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      },
    });
    await append({ runId: "run_a", events: [message("m1")] }, "a-session-credential", deps({ runnerAuth: composed(true) }));
    expect(await stored("ses_a")).toEqual(["m1"]);
    for (const answer of [false, new Error("composition fault")]) {
      const error = await refusal(
        append({ runId: "run_a", events: [message("m2")] }, auth.mintRunCredential("run_a"), deps({ runnerAuth: composed(answer) })),
      );
      expect(error.code).toBe(Code.PermissionDenied);
    }
    expect(await stored("ses_a")).toEqual(["m1"]);
  });

  it("a finished run takes no more events; an absent run is refused as the gate refuses", async () => {
    await seedRun("run_done", "ses_a", RunPhase.RUN_COMPLETED);
    const finished = await refusal(append({ runId: "run_done", events: [message("m1")] }, auth.mintRunCredential("run_done")));
    expect(finished.code).toBe(Code.FailedPrecondition);
    const absent = await refusal(append({ runId: "run_gone", events: [message("m1")] }, auth.mintRunCredential("run_gone")));
    expect(absent.code).toBe(Code.PermissionDenied);
    expect(await stored("ses_a")).toEqual([]);
  });
});

describe("what a runner may append", () => {
  const serverOnly: Array<[string, NonNullable<Input["events"]>[number]["event"]]> = [
    ["user.message", { case: "userMessage", value: { id: "x", content: [{ type: "text", text: "hi" }] } }],
    ["session.status_running", { case: "sessionStatusRunning", value: { id: "x" } }],
    ["session.status_idle", { case: "sessionStatusIdle", value: { id: "x", stopReason: { type: "end_turn" } } }],
  ];
  it.each(serverOnly)("refuses %s: the user's turn and the session's status are the server's", async (_type, event) => {
    await seedRun("run_a", "ses_a");
    const error = await refusal(append({ runId: "run_a", events: [message("ok"), { event }] }, auth.mintRunCredential("run_a")));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(await stored("ses_a")).toEqual([]);
  });

  it("accepts a session.error, which a runner sees first", async () => {
    await seedRun("run_a", "ses_a");
    await append(
      {
        runId: "run_a",
        events: [{ event: { case: "sessionError", value: { id: "err", error: { type: "mcp_connection_failed_error", message: "down" } } } }],
      },
      auth.mintRunCredential("run_a"),
    );
    expect(await stored("ses_a")).toEqual(["err"]);
  });

  it("refuses an id in the server's own prefix", async () => {
    await seedRun("run_a", "ses_a");
    const error = await refusal(append({ runId: "run_a", events: [message("sevt_01forged")] }, auth.mintRunCredential("run_a")));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(await stored("ses_a")).toEqual([]);
  });

  it("refuses an event with no id, or holding no event, or past the size cap", async () => {
    await seedRun("run_a", "ses_a");
    const token = auth.mintRunCredential("run_a");
    for (const events of [[message("")], [{}], [message("big", "x".repeat(SESSION_EVENT_MAX_BYTES))]]) {
      const error = await refusal(append({ runId: "run_a", events }, token));
      expect(error.code).toBe(Code.InvalidArgument);
    }
    expect(await stored("ses_a")).toEqual([]);
  });

  it("stores the events in the run's session, whatever session the request's envelope names", async () => {
    await seedRun("run_a", "ses_a");
    await append({ runId: "run_a", events: [{ ...message("m1"), sessionId: "ses_other", runId: "run_other" }] }, auth.mintRunCredential("run_a"));
    expect(await stored("ses_a")).toEqual(["m1"]);
    expect(await stored("ses_other")).toEqual([]);
    expect((await temp.store.sessionEvents.list("ses_a", { order: "asc", limit: 1 }))[0]?.runId).toBe("run_a");
  });
});

describe("resends", () => {
  it("a resent event is answered with its first place and not stored twice", async () => {
    await seedRun("run_a", "ses_a");
    const token = auth.mintRunCredential("run_a");
    await append({ runId: "run_a", events: [message("m1")] }, token);
    const again = await append({ runId: "run_a", events: [message("m1"), message("m2")] }, token);
    expect(again.events.map((e) => e.seq)).toEqual([1n, 2n]);
    expect(await stored("ses_a")).toEqual(["m1", "m2"]);
  });

  it("the same id with another event is ALREADY_EXISTS, and nothing of the batch is stored", async () => {
    await seedRun("run_a", "ses_a");
    const token = auth.mintRunCredential("run_a");
    await append({ runId: "run_a", events: [message("m1")] }, token);
    const error = await refusal(append({ runId: "run_a", events: [message("m2"), message("m1", "changed")] }, token));
    expect(error.code).toBe(Code.AlreadyExists);
    expect(await stored("ses_a")).toEqual(["m1"]);
  });

  it("an id another session holds is this session's own: a runner cannot claim or change another session's event", async () => {
    await seedRun("run_a", "ses_a");
    await seedRun("run_b", "ses_b");
    await append({ runId: "run_a", events: [message("shared", "a's words")] }, auth.mintRunCredential("run_a"));
    await append({ runId: "run_b", events: [message("shared", "b's words")] }, auth.mintRunCredential("run_b"));
    const a = await temp.store.sessionEvents.list("ses_a", { order: "asc", limit: 10 });
    const b = await temp.store.sessionEvents.list("ses_b", { order: "asc", limit: 10 });
    expect(new TextDecoder().decode(a[0]!.data)).toContain("a's words");
    expect(new TextDecoder().decode(b[0]!.data)).toContain("b's words");
  });
});

describe("live delivery", () => {
  it("stored events reach every stream; previews only the streams that asked for their type", async () => {
    await seedRun("run_a", "ses_a");
    const plain = broker.subscribe("ses_a", []);
    const messages = broker.subscribe("ses_a", ["agent.message"]);
    const thinking = broker.subscribe("ses_a", ["agent.thinking"]);
    await append(
      {
        runId: "run_a",
        events: [message("m1")],
        previews: [
          { preview: { case: "eventStart", value: { event: { id: "m2", type: "agent.message" } } } },
          { preview: { case: "eventDelta", value: { eventId: "m2", delta: { type: "content_delta", content: { type: "text", text: "he" } } } } },
          { preview: { case: "eventStart", value: { event: { id: "t1", type: "agent.thinking" } } } },
        ],
      },
      auth.mintRunCredential("run_a"),
    );
    expect(plain.queue.map((f) => f.frame.case)).toEqual(["event"]);
    expect(messages.queue.map((f) => f.frame.case)).toEqual(["eventStart", "eventDelta", "event"]);
    expect(thinking.queue.map((f) => f.frame.case)).toEqual(["eventStart", "event"]);
  });

  it("a resend reaches no stream a second time", async () => {
    await seedRun("run_a", "ses_a");
    const token = auth.mintRunCredential("run_a");
    await append({ runId: "run_a", events: [message("m1")] }, token);
    const stream = broker.subscribe("ses_a", []);
    await append({ runId: "run_a", events: [message("m1")] }, token);
    expect(stream.queue).toEqual([]);
  });
});

describe("the edges", () => {
  it("refuses a request that names no run, and a run in no session", async () => {
    const noRun = await refusal(append({ runId: "", events: [message("m1")] }, auth.mintRunCredential("run_a")));
    expect(noRun.code).toBe(Code.InvalidArgument);
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_lone",
      RunSchema,
      create(RunSchema, { metadata: { id: "run_lone", org: "acme" }, status: { phase: RunPhase.RUN_IN_PROGRESS } }),
    );
    const lone = await refusal(append({ runId: "run_lone", events: [message("m1")] }, auth.mintRunCredential("run_lone")));
    expect(lone.code).toBe(Code.FailedPrecondition);
  });

  it("a run that finished, or was deleted, between the load and the store's lock is refused as it would be before", async () => {
    await seedRun("run_a", "ses_a");
    const racing = (finish: (guard: { admit(row: unknown): void }) => never | Promise<never>) =>
      deps({
        store: {
          getResource: (...args: Parameters<typeof temp.store.getResource>) => temp.store.getResource(...args),
          sessionEvents: {
            append: async (_s: string, _o: string, _d: unknown, guard: { admit(row: unknown): void }) => finish(guard),
          },
        } as unknown as AppendSessionEventsDeps["store"],
      });
    const finished = await refusal(
      append({ runId: "run_a", events: [message("m1")] }, auth.mintRunCredential("run_a"), racing((guard) => {
        guard.admit(create(RunSchema, { metadata: { id: "run_a" }, status: { phase: RunPhase.RUN_COMPLETED } }));
        throw new Error("unreachable");
      })),
    );
    expect(finished.code).toBe(Code.FailedPrecondition);
    const deleted = await refusal(
      append({ runId: "run_a", events: [message("m1")] }, auth.mintRunCredential("run_a"), racing(() => {
        throw new ResourceNotFoundError("run/run_a");
      })),
    );
    expect(deleted.code).toBe(Code.PermissionDenied);
    const fault = await refusal(
      append({ runId: "run_a", events: [message("m1")] }, auth.mintRunCredential("run_a"), racing(() => {
        throw new Error("database is locked");
      })),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("a fault loading the run is a sanitized INTERNAL, not a refusal", async () => {
    const failing = deps({
      store: { getResource: () => Promise.reject(new Error("database is locked")) } as unknown as AppendSessionEventsDeps["store"],
    });
    const error = await refusal(append({ runId: "run_a", events: [message("m1")] }, auth.mintRunCredential("run_a"), failing));
    expect(error.code).toBe(Code.Internal);
  });
});
