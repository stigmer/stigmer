/**
 * Pins SessionCommandController.claimInput (../claim-input.ts): only the
 * runner acting for the run takes its session's queue, only while the run
 * works; it takes every message still queued, in the order sent, moved to
 * the head of the log as this run's, each accepted, and answers them; with
 * nothing queued it answers nothing and writes nothing; and the run's
 * status reply says whether messages wait (UpdateStatusResponse
 * input_pending is pinned with the status merge).
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ClaimSessionInputInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../../runnerauth/runnerauth.js";
import { ResourceNotFoundError } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { AppendSessionEventsDeps } from "../append.js";
import { NOT_THE_RUNS_RUNNER_MESSAGE } from "../append.js";
import { SessionEventBroker } from "../broker.js";
import { claimSessionInput } from "../claim-input.js";
import { enqueueMessage } from "../queue.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../run-writes.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let auth: RunnerAuthService;
let deps: AppendSessionEventsDeps;

beforeEach(() => {
  temp = tempStore();
  auth = RunnerAuthService.create(randomBytes(32));
  deps = {
    store: temp.store,
    logger: silentLogger,
    runnerAuth: newExecutionScopedRunnerCredentialProvider(auth),
    sessionEventBroker: new SessionEventBroker(silentLogger),
  };
});

afterEach(async () => {
  await temp.cleanup();
});

function bearer(token: string): HandlerContext {
  return {
    requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }),
  } as unknown as HandlerContext;
}

function claim(runId: string, token = auth.mintRunCredential(runId)) {
  return claimSessionInput(deps, create(ClaimSessionInputInputSchema, { runId }), bearer(token));
}

async function working(id = "a", sessionId = "s1"): Promise<void> {
  await createRunAppendingEvents(
    deps,
    create(RunSchema, {
      metadata: { id, org: "acme" },
      spec: { target: { case: "sessionId", value: sessionId }, message: "build it" },
      status: { phase: RunPhase.RUN_PENDING },
    }),
  );
}

async function queue(text: string): Promise<string> {
  const outcome = await enqueueMessage(deps, {
    sessionId: "s1",
    org: "acme",
    sender: "person-a",
    turn: create(RunSchema, { spec: { target: { case: "sessionId", value: "s1" }, message: text } }),
  });
  return "queued" in outcome && outcome.queued.event.case === "userMessage" ? outcome.queued.event.value.id : "";
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

describe("claimInput", () => {
  it("takes every queued message, in the order sent, as the run's own at the head of the log", async () => {
    await working();
    const one = await queue("one");
    const two = await queue("two");
    const response = await claim("a");
    expect(response.events.map((event) => [event.runId, event.event.case === "userMessage" ? event.event.value.id : ""])).toEqual([
      ["a", one],
      ["a", two],
    ]);
    expect(response.events.every((event) => event.event.value?.processedAt !== "")).toBe(true);
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
    const [newest] = await temp.store.sessionEvents.list("s1", { order: "desc", limit: 1 });
    expect(newest?.eventId).toBe(two);
  });

  it("answers nothing and writes nothing when nothing waits", async () => {
    await working();
    const before = await temp.store.getResource(ApiResourceKind.run, "a", RunSchema);
    expect((await claim("a")).events).toEqual([]);
    const after = await temp.store.getResource(ApiResourceKind.run, "a", RunSchema);
    expect(after.metadata?.etag).toBe(before.metadata?.etag);
  });

  it("refuses anyone but the run's runner, and a run id left out", async () => {
    await working();
    await working("b", "s2");
    for (const token of ["", "garbage", auth.mintRunCredential("b")]) {
      const error = await refusal(claim("a", token));
      expect([error.code, error.rawMessage]).toEqual([Code.PermissionDenied, NOT_THE_RUNS_RUNNER_MESSAGE]);
    }
    expect((await refusal(claim("", "garbage"))).code).toBe(Code.InvalidArgument);
    const gone = await refusal(claim("nope"));
    expect(gone.code).toBe(Code.PermissionDenied);
  });

  it("refuses a run that does not work: waiting, paused or finished", async () => {
    await working();
    await queue("one");
    for (const phase of [RunPhase.RUN_WAITING_FOR_APPROVAL, RunPhase.RUN_PAUSED, RunPhase.RUN_COMPLETED]) {
      await updateRunAppendingEvents(deps, "a", (run) => {
        run.status!.phase = phase;
      });
      expect((await refusal(claim("a"))).code).toBe(Code.FailedPrecondition);
    }
    expect(await temp.store.sessionEvents.queued("s1")).toHaveLength(1);
  });

  it("answers the store's faults: a refusal under the lock as it is, a run gone as the runner's refusal, any other as Internal", async () => {
    await working();
    await queue("one");
    const failingWrite = (error: Error) => {
      deps = {
        ...deps,
        store: new Proxy(temp.store, {
          get(target, property, receiver) {
            if (property === "writeResourceAppendingEvents") {
              return () => Promise.reject(error);
            }
            const value: unknown = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    };
    failingWrite(new ConnectError("held", Code.FailedPrecondition));
    expect((await refusal(claim("a"))).code).toBe(Code.FailedPrecondition);
    failingWrite(new ResourceNotFoundError("run/a"));
    expect((await refusal(claim("a"))).rawMessage).toBe(NOT_THE_RUNS_RUNNER_MESSAGE);
    failingWrite(new Error("disk full"));
    expect((await refusal(claim("a"))).code).toBe(Code.Internal);
  });

  it("is an internal fault when the run cannot be read", async () => {
    await working();
    deps = {
      ...deps,
      store: new Proxy(temp.store, {
        get(target, property, receiver) {
          if (property === "getResource") {
            return () => Promise.reject(new Error("disk full"));
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    expect((await refusal(claim("a"))).code).toBe(Code.Internal);
  });
});
