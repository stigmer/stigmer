/**
 * Pins SessionCommandController.bindHarnessState (../bind-harness.ts):
 * only the runner acting for the run records the harness state, only while
 * the run is not finished, into the run's own session's status. The id it
 * replaces joins the history once, and nothing a person edits moves: the
 * spec and the etag stay as they were.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { BindHarnessStateInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { NOT_THE_RUNS_RUNNER_TO_BIND_MESSAGE, bindHarnessState } from "../bind-harness.js";
import type { BindHarnessStateDeps } from "../bind-harness.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let auth: RunnerAuthService;
let deps: BindHarnessStateDeps;

beforeEach(() => {
  temp = tempStore();
  auth = RunnerAuthService.create(randomBytes(32));
  deps = {
    store: temp.store,
    logger: silentLogger,
    runnerAuth: newExecutionScopedRunnerCredentialProvider(auth),
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

async function seedSession(id: string): Promise<Session> {
  const session = create(SessionSchema, {
    metadata: { id, org: "acme", slug: id, name: id },
    spec: { subject: "Fix the build" },
  });
  await temp.store.saveResource(ApiResourceKind.session, id, SessionSchema, session);
  return session;
}

async function seedRun(
  id: string,
  target: { case: "sessionId"; value: string } | { case: undefined; value?: undefined },
  phase = RunPhase.RUN_IN_PROGRESS,
): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, { metadata: { id, org: "acme" }, spec: { target }, status: { phase } }),
  );
}

function bind(runId: string, harnessStateId: string, token: string) {
  return bindHarnessState(deps, create(BindHarnessStateInputSchema, { runId, harnessStateId }), bearer(token));
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

function storedSession(id: string): Promise<Session> {
  return temp.store.getResource(ApiResourceKind.session, id, SessionSchema);
}

describe("bindHarnessState", () => {
  it("records the id in the run's session's status; the id it replaces joins the history once; spec and etag stay", async () => {
    const seeded = await seedSession("ses_a");
    await seedRun("run_a", { case: "sessionId", value: "ses_a" });
    const token = auth.mintRunCredential("run_a");

    const first = await bind("run_a", "hs-1", token);
    expect([first.harnessStateId, first.harnessStateIdHistory]).toEqual(["hs-1", []]);
    await bind("run_a", "hs-2", token);
    const again = await bind("run_a", "hs-2", token);
    expect([again.harnessStateId, again.harnessStateIdHistory]).toEqual(["hs-2", ["hs-1"]]);
    const third = await bind("run_a", "hs-3", token);
    expect(third.harnessStateIdHistory).toEqual(["hs-1", "hs-2"]);

    const stored = await storedSession("ses_a");
    expect(stored.status?.harnessStateId).toBe("hs-3");
    expect(stored.status?.harnessStateIdHistory).toEqual(["hs-1", "hs-2"]);
    expect(stored.spec?.subject).toBe("Fix the build");
    expect(stored.metadata?.etag).toBe(seeded.metadata?.etag);
    expect(stored.metadata?.etag).not.toBe("");
  });

  it("refuses no credential, garbage, another run's credential and an unknown run alike, writing nothing", async () => {
    await seedSession("ses_a");
    await seedRun("run_a", { case: "sessionId", value: "ses_a" });
    await seedRun("run_b", { case: "sessionId", value: "ses_a" });
    for (const [runId, token] of [
      ["run_a", ""],
      ["run_a", "garbage"],
      ["run_a", auth.mintRunCredential("run_b")],
      ["run_missing", auth.mintRunCredential("run_missing")],
    ] as const) {
      const error = await refusal(bind(runId, "hs-forged", token));
      expect(error.code, `${runId} ${token.slice(0, 8)}`).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(NOT_THE_RUNS_RUNNER_TO_BIND_MESSAGE);
    }
    expect((await storedSession("ses_a")).status?.harnessStateId ?? "").toBe("");
  });

  it("refuses a finished run and a run in no session", async () => {
    await seedSession("ses_a");
    await seedRun("run_done", { case: "sessionId", value: "ses_a" }, RunPhase.RUN_COMPLETED);
    const finished = await refusal(bind("run_done", "hs-1", auth.mintRunCredential("run_done")));
    expect(finished.code).toBe(Code.FailedPrecondition);
    expect(finished.rawMessage).toBe("run 'run_done' is finished; it records no more harness state");

    await seedRun("run_alone", { case: undefined });
    const alone = await refusal(bind("run_alone", "hs-1", auth.mintRunCredential("run_alone")));
    expect(alone.code).toBe(Code.FailedPrecondition);
    expect(alone.rawMessage).toBe("run 'run_alone' is in no session; it has no harness state to record");
    expect((await storedSession("ses_a")).status?.harnessStateId ?? "").toBe("");
  });

  it("refuses an empty run id or harness id, and answers NotFound for a session deleted since", async () => {
    const noRun = await refusal(bind("", "hs-1", "anything"));
    expect([noRun.code, noRun.rawMessage]).toEqual([Code.InvalidArgument, "run_id is required"]);
    const noId = await refusal(bind("run_a", "", "anything"));
    expect([noId.code, noId.rawMessage]).toEqual([Code.InvalidArgument, "harness_state_id is required"]);

    await seedRun("run_orphan", { case: "sessionId", value: "ses_gone" });
    const gone = await refusal(bind("run_orphan", "hs-1", auth.mintRunCredential("run_orphan")));
    expect(gone.code).toBe(Code.NotFound);
  });

  it("answers INTERNAL, naming no store detail, when the store fails reading the run or writing the session", async () => {
    await seedSession("ses_a");
    await seedRun("run_a", { case: "sessionId", value: "ses_a" });
    const token = auth.mintRunCredential("run_a");
    const failing = (method: "getResource" | "updateResource") =>
      new Proxy(temp.store, {
        get(target, key, receiver) {
          if (key === method) {
            return () => Promise.reject(new Error("disk unplugged"));
          }
          const value: unknown = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

    for (const method of ["getResource", "updateResource"] as const) {
      const error = await refusal(
        bindHarnessState(
          { ...deps, store: failing(method) },
          create(BindHarnessStateInputSchema, { runId: "run_a", harnessStateId: "hs-1" }),
          bearer(token),
        ),
      );
      expect(error.code, method).toBe(Code.Internal);
      expect(error.rawMessage, method).not.toContain("disk unplugged");
    }
  });
});
