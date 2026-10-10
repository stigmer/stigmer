/**
 * Pins the plugin eval's in-process try lane (`pluginEvalTries`): a try's
 * session and run are created through the session's and the run's own
 * create RPCs over the in-process transport, as the caller the eval's
 * workflow gives (the eval's creator, so the try is theirs) or, given
 * none, as the server's internal class; a try past its deadline is
 * terminated through the run's terminate RPC as the server, carrying the
 * run's id and the reason as given; an RPC's refusal reaches the lane
 * with its code.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { createInProcessClients } from "../inprocess.js";
import { createLogger } from "../logger.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const CREATOR: CallerIdentity = {
  identityId: "ida_creator",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

function trySession(name: string) {
  return create(SessionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: { name, org: "org_1" },
  });
}

function tryRun(message: string) {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { org: "org_1" },
    spec: { target: { case: "sessionId", value: "ses_try" }, message },
  });
}

interface Seen {
  readonly rpc: string;
  readonly identityId: string;
  readonly callerClass: string;
  readonly detail: string;
}

function laneOver(refuse = false) {
  const seen: Seen[] = [];
  const record = (rpc: string, ctx: HandlerContext, detail: string): void => {
    const caller = callerIdentityOf(ctx);
    seen.push({
      rpc,
      identityId: caller.identityId,
      callerClass: caller.callerClass,
      detail,
    });
    if (refuse) {
      throw new ConnectError(`${rpc} refused`, Code.FailedPrecondition);
    }
  };
  const routes = (router: ConnectRouter) => {
    router.service(SessionCommandController, {
      create: (session, ctx) => {
        record("session.create", ctx, session.metadata?.name ?? "");
        return create(SessionSchema, {
          metadata: { id: "ses_try", name: session.metadata?.name ?? "" },
        });
      },
    });
    router.service(RunCommandController, {
      create: (run, ctx) => {
        record("run.create", ctx, run.spec?.message ?? "");
        return create(RunSchema, { metadata: { id: "run_try" } });
      },
      terminate: (input, ctx) => {
        record("run.terminate", ctx, `${input.id}: ${input.reason}`);
        return create(RunSchema, { metadata: { id: input.id } });
      },
    });
  };
  const lane = createInProcessClients(routes, silentLogger).clients
    .pluginEvalTries;
  return { lane, seen };
}

describe("the plugin eval's in-process try lane", () => {
  it("creates the try's session and run as the caller it is given", async () => {
    const { lane, seen } = laneOver();

    const session = await lane.createSession(trySession("try-1"), CREATOR);
    const run = await lane.createRun(tryRun("rename getUser"), CREATOR);

    expect(session.metadata?.id).toBe("ses_try");
    expect(run.metadata?.id).toBe("run_try");
    expect(seen).toEqual([
      {
        rpc: "session.create",
        identityId: "ida_creator",
        callerClass: "user",
        detail: "try-1",
      },
      {
        rpc: "run.create",
        identityId: "ida_creator",
        callerClass: "user",
        detail: "rename getUser",
      },
    ]);
  });

  it("creates as the server's internal class when no caller is given, and terminates as the server", async () => {
    const { lane, seen } = laneOver();

    await lane.createSession(trySession("try-2"), undefined);
    await lane.createRun(tryRun("m"), undefined);
    await lane.terminateRun("run_try", "the case's deadline passed");

    expect(seen.map((s) => [s.rpc, s.callerClass])).toEqual([
      ["session.create", "internal"],
      ["run.create", "internal"],
      ["run.terminate", "internal"],
    ]);
    expect(seen.map((s) => s.identityId)).not.toContain("ida_creator");
    expect(seen[2]?.detail).toBe("run_try: the case's deadline passed");
  });

  it("surfaces each RPC's refusal with its code", async () => {
    const { lane } = laneOver(true);

    await expect(
      lane.createSession(trySession("t"), CREATOR),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    await expect(lane.createRun(tryRun("m"), undefined)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await expect(lane.terminateRun("run_try", "stop")).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
  });
});
