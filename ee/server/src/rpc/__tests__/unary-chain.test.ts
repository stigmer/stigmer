/**
 * The unary chain's contract, pinned once so every controller built on it
 * inherits the proof: Authorize runs first and a denial never reaches the
 * domain step (PERMISSION_DENIED with the proto method's copy); a
 * structurally invalid input is INVALID_ARGUMENT before the domain step;
 * an authorizer outage answers INTERNAL, not a leak; a ConnectError the
 * domain step throws passes through byte-identically; an unexpected Error
 * in the domain step answers the sanitized INTERNAL; the domain step's
 * NAME is what the pipeline logs on failure; the optional shaping steps
 * run after ValidateProto and before the domain step with the kind on
 * the context, and a denial reaches none of them.
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamsSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/io_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import type { Authorizer, Logger, PipelineStep, RequestContext } from "@stigmer/server";
import { callerIdentityKey } from "@stigmer/server";

import { runUnaryChain } from "../unary-chain.js";

const allow: Authorizer = {
  authorize: () => Promise.resolve({ kind: "allow" }),
};
const deny: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
};
const outage: Authorizer = {
  authorize: () => Promise.reject(new Error("the authorizer's backend is unreachable")),
};

/** The pipeline logs a failed step at WARN with the step's name and the real error. */
function recordingLogger(): Logger & {
  warnings: Array<Record<string, unknown>>;
} {
  const warnings: Array<Record<string, unknown>> = [];
  return {
    warnings,
    debug() {},
    info() {},
    warn(_message: string, fields?: Record<string, unknown>) {
      warnings.push(fields ?? {});
    },
    error() {},
  } as unknown as Logger & { warnings: Array<Record<string, unknown>> };
}

function identityInterceptor(): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, {
      identityId: "ida_member",
      callerClass: "user",
      issuer: "https://issuer.invalid",
      rawToken: "tok",
    });
    return next(request);
  };
}

/** The chain's names in these cases: the test's own, so no log line reads as a real handler's. */
const NAMES = { chain: "chain-contract", step: "ListTeamsByOrg" };

/** The list one team makes, the domain step's default answer. */
function oneTeam() {
  return create(TeamsSchema, { entries: [create(TeamSchema, { metadata: { id: "team_1" } })] });
}

/** One RPC over the chain: listByOrg answering one team, or throwing what the test injects. */
function clientFor(
  authorizer: Authorizer,
  logger: Logger,
  domain: () => Promise<unknown> = async () => oneTeam(),
) {
  const method = TeamQueryController.method.listByOrg;
  const transport = createRouterTransport(
    (router) => {
      router.service(TeamQueryController, {
        listByOrg: (input, ctx) =>
          runUnaryChain(
            NAMES,
            method,
            input,
            ctx,
            { authorizer, logger },
            async () =>
              (await domain()) as ReturnType<
                typeof create<typeof TeamsSchema>
              >,
          ),
      });
    },
    { router: { interceptors: [identityInterceptor()] } },
  );
  return createClient(TeamQueryController, transport);
}

async function failure(work: Promise<unknown>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a ConnectError");
}

describe("runUnaryChain", () => {
  it("runs Authorize → ValidateProto → the domain step and answers the domain's result", async () => {
    let ran = 0;
    const client = clientFor(allow, recordingLogger(), async () => {
      ran++;
      return oneTeam();
    });
    const teams = await client.listByOrg({ org: "org_1" });
    expect(teams.entries.map((team) => team.metadata?.id)).toEqual(["team_1"]);
    expect(ran).toBe(1);
  });

  it("a denial is PERMISSION_DENIED with the proto method's copy, and the domain step never runs", async () => {
    let ran = 0;
    const client = clientFor(deny, recordingLogger(), async () => {
      ran++;
      return create(TeamsSchema);
    });
    const error = await failure(client.listByOrg({ org: "org_1" }));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage.length).toBeGreaterThan(0);
    expect(ran).toBe(0);
  });

  it("a structurally invalid input is INVALID_ARGUMENT before the domain step", async () => {
    let ran = 0;
    const client = clientFor(allow, recordingLogger(), async () => {
      ran++;
      return create(TeamsSchema);
    });
    // org is required (`min_len = 1`) on the proto; the empty request fails validation.
    const error = await failure(client.listByOrg({}));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(ran).toBe(0);
  });

  it("an authorizer outage answers INTERNAL and never the outage's own text", async () => {
    const client = clientFor(outage, recordingLogger());
    const error = await failure(client.listByOrg({ org: "org_1" }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).not.toContain("the authorizer's backend is unreachable");
  });

  it("a ConnectError the domain step throws passes through byte-identically", async () => {
    const client = clientFor(allow, recordingLogger(), async () => {
      throw new ConnectError(
        "Record not found for org: org_1",
        Code.NotFound,
      );
    });
    const error = await failure(client.listByOrg({ org: "org_1" }));
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("Record not found for org: org_1");
  });

  it("an unexpected fault in the domain step answers the sanitized INTERNAL and logs under the step's name", async () => {
    const logger = recordingLogger();
    const client = clientFor(allow, logger, async () => {
      throw new Error("relation store.missing does not exist");
    });
    const error = await failure(client.listByOrg({ org: "org_1" }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).not.toContain("store.missing");
    expect(JSON.stringify(logger.warnings)).toContain("ListTeamsByOrg");
    expect(JSON.stringify(logger.warnings)).toContain("store.missing");
  });

  it("runs the shaping steps after ValidateProto and before the domain step, with the kind on the context", async () => {
    const order: string[] = [];
    const method = TeamQueryController.method.listByOrg;
    const shaping: PipelineStep<typeof method.input>[] = ["First", "Second"].map(
      (name) => ({
        name,
        execute: (ctx: RequestContext<typeof method.input>) => {
          order.push(`${name}:${ApiResourceKind[ctx.apiResourceKind]}`);
        },
      }),
    );
    const transport = createRouterTransport(
      (router) => {
        router.service(TeamQueryController, {
          listByOrg: (input, ctx) =>
            runUnaryChain(
              NAMES,
              method,
              input,
              ctx,
              { authorizer: allow, logger: recordingLogger() },
              async (reqCtx) => {
                order.push(`Domain:${ApiResourceKind[reqCtx.apiResourceKind]}`);
                return oneTeam();
              },
              { kind: ApiResourceKind.team, steps: shaping },
            ),
        });
      },
      { router: { interceptors: [identityInterceptor()] } },
    );
    await createClient(TeamQueryController, transport).listByOrg({ org: "org_1" });
    expect(order).toEqual(["First:team", "Second:team", "Domain:team"]);

    // A denial never reaches a shaping step either.
    order.length = 0;
    const denied = createRouterTransport(
      (router) => {
        router.service(TeamQueryController, {
          listByOrg: (input, ctx) =>
            runUnaryChain(
              NAMES,
              method,
              input,
              ctx,
              { authorizer: deny, logger: recordingLogger() },
              async () => create(TeamsSchema, {}),
              { kind: ApiResourceKind.team, steps: shaping },
            ),
        });
      },
      { router: { interceptors: [identityInterceptor()] } },
    );
    const error = await failure(
      createClient(TeamQueryController, denied).listByOrg({ org: "org_1" }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(order).toEqual([]);
  });
});
