/**
 * Pins the in-process lane a reconcile turn is created through
 * (`reconcileTurnCreator`, the run an undo on an ended turn starts): the run
 * reaches the run's own create RPC over the in-process transport, as the
 * person who decided, never as the server's internal class; the RPC's
 * refusal reaches the lane with its code.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { createInProcessClients } from "../inprocess.js";
import { createLogger } from "../logger.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const DECIDER: CallerIdentity = {
  identityId: "ida_decider",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

function reconcileRun() {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { org: "org_1" },
    spec: {
      target: { case: "sessionId", value: "ses_1" },
      reconcileFileReview: true,
    },
  });
}

function laneOver(refuse = false) {
  const seen: { identityId: string; callerClass: string; reconcile: boolean }[] = [];
  const routes = (router: ConnectRouter) => {
    router.service(RunCommandController, {
      create: (run, ctx) => {
        const caller = callerIdentityOf(ctx);
        seen.push({
          identityId: caller.identityId,
          callerClass: caller.callerClass,
          reconcile: run.spec?.reconcileFileReview ?? false,
        });
        if (refuse) {
          throw new ConnectError("run.create refused", Code.PermissionDenied);
        }
        return create(RunSchema, { metadata: { id: "run_reconcile" } });
      },
    });
  };
  const lane = createInProcessClients(routes, silentLogger).clients
    .reconcileTurnCreator;
  return { lane, seen };
}

describe("the reconcile turn's in-process lane", () => {
  it("creates the run through the run's create RPC as the person who decided", async () => {
    const { lane, seen } = laneOver();

    const run = await lane.create(reconcileRun(), DECIDER);

    expect(run.metadata?.id).toBe("run_reconcile");
    expect(seen).toEqual([
      { identityId: "ida_decider", callerClass: "user", reconcile: true },
    ]);
  });

  it("surfaces the create RPC's refusal with its code", async () => {
    const { lane } = laneOver(true);

    await expect(lane.create(reconcileRun(), DECIDER)).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
  });
});
