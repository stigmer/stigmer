/**
 * Pins a person's stop of one background command
 * (../stop-background-command.ts) on a real store: served on the session's
 * command service under can_edit on the session, asked before anything is
 * read; one stigmer.background_command.stop_requested recorded in the
 * command's thread under its derived id and published to the session's
 * live stream; a second stop answered with the first; a tool use that
 * started no background command, of another session's run or of no run,
 * not found; a command that ended, or a turn that is not working,
 * refused, also when the end lands between the read and the locked write;
 * a store fault Internal.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { StopBackgroundCommandInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../../extensions/authorizer.js";
import { servedMethods } from "../../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity, untouchable } from "../../../../pipeline/__tests__/support.js";
import { createApiResourceInterceptor } from "../../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import type { Store } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { registerSessionServices } from "../../controller.js";
import type { SessionControllerDeps } from "../../controller.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { toolUseEventId } from "../../events/ids.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../events/run-writes.js";
import { backgroundStopRequestEventId, stopBackgroundCommand } from "../stop-background-command.js";
import type { StopBackgroundCommandDeps } from "../stop-background-command.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_1";
const RUN = "run_1";
const SUB_THREAD = `${RUN}.task-1`;

let temp: TempStore;
let broker: SessionEventBroker;

beforeEach(() => {
  temp = tempStore();
  broker = new SessionEventBroker(silentLogger);
});

afterEach(async () => {
  await temp.cleanup();
});

function deps(authorizer: Authorizer = newPermissiveSingleTeamAuthorizer(), store: Store = temp.store): StopBackgroundCommandDeps {
  return { store, logger: silentLogger, authorizer, sessionEventBroker: broker };
}

const use = (callId: string, runId = RUN) => toolUseEventId(runId, callId);

function status(runId: string, callId: string, phase: "running" | "ended", threadId = ""): SessionEvent {
  const toolUseId = use(callId, runId);
  return create(SessionEventSchema, {
    runId,
    threadId,
    event: {
      case: "stigmerBackgroundCommandStatus",
      value: {
        id: `${toolUseId}.${phase === "running" ? "bg" : "bg.end"}`,
        toolUseId,
        sessionThreadId: threadId,
        phase,
        ...(phase === "running" ? { timeoutSeconds: 300 } : { ending: "exited", exitCode: 0, output: "ok\n" }),
      },
    },
  });
}

/** A working turn of `sessionId` whose log holds `events`, as its runner writes them. */
async function seedTurn(events: ReadonlyArray<SessionEvent>, options: { runId?: string; sessionId?: string } = {}): Promise<void> {
  const runId = options.runId ?? RUN;
  const run = create(RunSchema, {
    metadata: { id: runId, org: "acme" },
    spec: { target: { case: "sessionId", value: options.sessionId ?? SESSION }, message: "run the server" },
    status: { phase: RunPhase.RUN_IN_PROGRESS },
  });
  await createRunAppendingEvents({ store: temp.store, sessionEventBroker: broker }, run);
  await appendRunnerEvents(runId, options.sessionId ?? SESSION, events);
}

async function appendRunnerEvents(runId: string, sessionId: string, events: ReadonlyArray<SessionEvent>): Promise<void> {
  await temp.store.sessionEvents.append(sessionId, "acme", events.map(draftOf), {
    kind: ApiResourceKind.run,
    id: runId,
    schema: RunSchema,
    admit: () => undefined,
  });
}

async function setPhase(phase: RunPhase, runId = RUN): Promise<void> {
  await updateRunAppendingEvents({ store: temp.store, sessionEventBroker: broker }, runId, (run) => {
    run.status!.phase = phase;
  });
}

function stop(toolUseId: string, d = deps()): Promise<SessionEvent> {
  return stopBackgroundCommand(d, create(StopBackgroundCommandInputSchema, { sessionId: SESSION, toolUseId }), testCallerIdentity());
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

/** The session's stop requests, as `<tool use> <thread>`. */
async function stopRequests(): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(SESSION, {
    order: "asc",
    types: ["stigmer.background_command.stop_requested"],
    limit: 100,
  });
  return records
    .map(eventOf)
    .flatMap((event) =>
      event.event.case === "stigmerBackgroundCommandStopRequested"
        ? [`${event.event.value.toolUseId} ${event.event.value.sessionThreadId || "root"}`]
        : [],
    );
}

describe("stopBackgroundCommand", () => {
  it("is served on the session's command service, and answered through it", async () => {
    const served = servedMethods((router) => registerSessionServices(router, untouchable<SessionControllerDeps>("deps")))
      .filter((method) => method.parent.typeName === SessionCommandController.typeName)
      .map((method) => method.localName);
    expect(served).toContain("stopBackgroundCommand");

    await seedTurn([status(RUN, "tc-1", "running")]);
    const client = createClient(
      SessionCommandController,
      createRouterTransport((router) => registerSessionServices(router, deps() as unknown as SessionControllerDeps), {
        router: {
          interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
        },
      }),
    );
    const answer = await client.stopBackgroundCommand({ sessionId: SESSION, toolUseId: use("tc-1") });
    expect(answer.event.case).toBe("stigmerBackgroundCommandStopRequested");
  });

  it("asks can_edit on the session before reading anything, and a denial writes nothing", async () => {
    await seedTurn([status(RUN, "tc-1", "running")]);
    const checks: AuthzCheck[] = [];
    const denying: Authorizer = {
      authorize: async (_caller, check) => {
        checks.push(check);
        return { kind: "deny", reason: "not an editor" };
      },
    };
    expect((await refusal(stop(use("tc-1"), deps(denying)))).code).toBe(Code.PermissionDenied);
    expect(checks.map((c) => [c.permission, c.resourceKind, c.resourceId])).toEqual([
      [IamPermission.can_edit, ApiResourceKind.session, SESSION],
    ]);
    expect(await stopRequests()).toEqual([]);
  });

  it("records one request in the command's thread, under its derived id, and publishes it", async () => {
    await seedTurn([status(RUN, "tc-1", "running"), status(RUN, "tc-2", "running", SUB_THREAD)]);
    const published: SessionEvent[] = [];
    const publish = broker.publish.bind(broker);
    broker.publish = (sessionId, org, events) => {
      published.push(...events);
      publish(sessionId, org, events);
    };
    const root = await stop(use("tc-1"));
    const sub = await stop(use("tc-2"));
    expect(root.event.value?.id).toBe(backgroundStopRequestEventId(use("tc-1")));
    expect(root.seq).toBeGreaterThan(0n);
    expect(root.runId).toBe(RUN);
    expect(sub.threadId).toBe(SUB_THREAD);
    expect(await stopRequests()).toEqual([`${use("tc-1")} root`, `${use("tc-2")} ${SUB_THREAD}`]);
    expect(published.filter((e) => e.event.case === "stigmerBackgroundCommandStopRequested")).toHaveLength(2);
  });

  it("answers a second stop with the first, recording nothing new, even once the command ended", async () => {
    await seedTurn([status(RUN, "tc-1", "running")]);
    const first = await stop(use("tc-1"));
    expect(await stop(use("tc-1"))).toEqual(first);
    await appendRunnerEvents(RUN, SESSION, [status(RUN, "tc-1", "ended")]);
    expect(await stop(use("tc-1"))).toEqual(first);
    expect(await stopRequests()).toHaveLength(1);
  });

  it("reads every page of a run's background events to find the command", async () => {
    const others = Array.from({ length: 1000 }, (_, i) => status(RUN, `other-${i}`, "running"));
    await seedTurn([...others, status(RUN, "tc-last", "running")]);
    const stopped = await stop(use("tc-last"));
    expect(stopped.event.case).toBe("stigmerBackgroundCommandStopRequested");
  });

  it("finds no command for a tool use that started none, of another session, or of no run", async () => {
    await seedTurn([status(RUN, "tc-1", "running")]);
    await seedTurn([status("run_2", "tc-9", "running")], { runId: "run_2", sessionId: "ses_2" });
    for (const toolUseId of [use("tc-2"), use("tc-9", "run_2"), "no-run", use("tc-1", "run_gone")]) {
      expect((await refusal(stop(toolUseId))).code, toolUseId).toBe(Code.NotFound);
    }
    expect(await stopRequests()).toEqual([]);
  });

  it("refuses a command that already ended, and one whose turn is not working", async () => {
    await seedTurn([status(RUN, "tc-1", "running"), status(RUN, "tc-1", "ended"), status(RUN, "tc-2", "running")]);
    const ended = await refusal(stop(use("tc-1")));
    expect(ended.code).toBe(Code.FailedPrecondition);
    expect(ended.rawMessage).toContain("already ended");
    await setPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const waiting = await refusal(stop(use("tc-2")));
    expect(waiting.code).toBe(Code.FailedPrecondition);
    expect(waiting.rawMessage).toContain("the turn is not working");
    expect(await stopRequests()).toEqual([]);
  });

  it("checks again under the lock: an end or a stop that landed after the read refuses the write", async () => {
    await seedTurn([status(RUN, "tc-1", "running"), status(RUN, "tc-2", "running"), status(RUN, "tc-3", "running")]);
    // The command ends between the chain's read and its locked write.
    const endsMeanwhile = (event: SessionEvent): Store =>
      new Proxy(temp.store, {
        get(target, key, receiver) {
          if (key === "writeResourceAppendingEvents") {
            return async (...args: unknown[]) => {
              await appendRunnerEvents(RUN, SESSION, [event]);
              return (target.writeResourceAppendingEvents as (...a: unknown[]) => Promise<unknown>)(...args);
            };
          }
          return Reflect.get(target, key, receiver);
        },
      });
    const ended = await refusal(stop(use("tc-1"), deps(undefined, endsMeanwhile(status(RUN, "tc-1", "ended")))));
    expect(ended.code).toBe(Code.FailedPrecondition);
    expect(ended.rawMessage).toContain("already ended");

    // An identical stop recorded meanwhile is this one's replay.
    const first = create(SessionEventSchema, {
      runId: RUN,
      event: {
        case: "stigmerBackgroundCommandStopRequested",
        value: { id: backgroundStopRequestEventId(use("tc-2")), toolUseId: use("tc-2") },
      },
    });
    const replay = await stop(use("tc-2"), deps(undefined, endsMeanwhile(first)));
    expect(replay.event.value?.id).toBe(backgroundStopRequestEventId(use("tc-2")));
    expect(await stopRequests()).toEqual([`${use("tc-2")} root`]);

    // The turn stopped meanwhile.
    const stopsMeanwhile = new Proxy(temp.store, {
      get(target, key, receiver) {
        if (key === "writeResourceAppendingEvents") {
          return async (...args: unknown[]) => {
            await setPhase(RunPhase.RUN_CANCELLED);
            return (target.writeResourceAppendingEvents as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const cancelled = await refusal(stop(use("tc-3"), deps(undefined, stopsMeanwhile)));
    expect(cancelled.code).toBe(Code.FailedPrecondition);
    expect(cancelled.rawMessage).toContain("the turn is not working");
  });

  it("is Internal on a store fault, and NotFound when the run goes before the write", async () => {
    await seedTurn([status(RUN, "tc-1", "running")]);
    const faulty = (overrides: Partial<Store>): Store =>
      new Proxy(temp.store, {
        get(target, key, receiver) {
          return key in overrides ? (overrides as Record<string | symbol, unknown>)[key] : Reflect.get(target, key, receiver);
        },
      });
    expect((await refusal(stop(use("tc-1"), deps(undefined, faulty({ getResource: () => Promise.reject(new Error("disk")) }))))).code).toBe(
      Code.Internal,
    );
    const listFault = faulty({
      sessionEvents: new Proxy(temp.store.sessionEvents, {
        get(target, key, receiver) {
          return key === "list" ? () => Promise.reject(new Error("disk")) : Reflect.get(target, key, receiver);
        },
      }),
    });
    expect((await refusal(stop(use("tc-1"), deps(undefined, listFault)))).code).toBe(Code.Internal);
    expect(
      (await refusal(stop(use("tc-1"), deps(undefined, faulty({ writeResourceAppendingEvents: () => Promise.reject(new Error("disk")) }))))).code,
    ).toBe(Code.Internal);
    const removed = faulty({
      writeResourceAppendingEvents: (async () => {
        const { ResourceNotFoundError } = await import("../../../../store/interface.js");
        throw new ResourceNotFoundError(`run/${RUN}`);
      }) as Store["writeResourceAppendingEvents"],
    });
    expect((await refusal(stop(use("tc-1"), deps(undefined, removed)))).code).toBe(Code.NotFound);
  });
});
