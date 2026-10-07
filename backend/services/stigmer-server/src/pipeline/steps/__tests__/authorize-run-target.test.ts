/**
 * Pins the AuthorizeRunTarget step's contract (2026-09-11):
 * the step is a thin shell around authorizeResolvedResource — a resolver
 * that answers no target makes NO check (the chain's own invariant guards
 * own the shape-less arm); a resolved target reaches the Authorizer
 * verbatim; deny carries the RESOLVER's copy; not-found answers the
 * load-first NOT_FOUND; unavailable is INTERNAL; the internal caller class
 * skips. The resolver is handed the record being built and, on an update,
 * the stored row (EXISTING_RESOURCE_KEY), so it can ask only about what a
 * write introduces; the step runs as AuthorizeRunTarget, or as
 * AuthorizeRunAgent for a chain's second question. Also pins
 * isRunGateCheck: exactly the three (kind, permission)
 * pairs the resolvers can produce, and nothing adjacent — the cloud's
 * lane-admission decorator keys on this predicate, so a drift here would
 * either deny a schedule fire or admit a lane to a check it never owned.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import { AUTHORIZATION_UNAVAILABLE_MESSAGE } from "../authorize.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import {
  RUN_GATE_CHECKS,
  isRunGateCheck,
  newAuthorizeRunTargetStep,
} from "../authorize-run-target.js";
import type { RunTarget } from "../authorize-run-target.js";

function fakeAuthorizer(decision: AuthzDecision): {
  authorizer: Authorizer;
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

async function captureError(
  run: () => void | Promise<void>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to reject");
}

const TARGET: RunTarget = {
  ...RUN_GATE_CHECKS.agent,
  resourceId: "agt_01target",
  deniedMessage: "unauthorized to run agent 'agt_01target'",
};

function sessionCtx(callerClass?: string) {
  return new RequestContext(
    SessionSchema,
    create(SessionSchema, { metadata: { name: "s", org: "acme" } }),
    callerClass === undefined
      ? testCallerIdentity()
      : testCallerIdentity({ callerClass }),
    ApiResourceKind.session,
  );
}

describe("AuthorizeRunTarget — the step shell", () => {
  it("is named AuthorizeRunTarget in every chain, and AuthorizeRunAgent for a chain's second question (shared vocabulary)", () => {
    const { authorizer } = fakeAuthorizer({ kind: "allow" });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => TARGET,
    );
    expect(step.name).toBe("AuthorizeRunTarget");
    expect(
      newAuthorizeRunTargetStep<typeof SessionSchema>(
        authorizer,
        () => TARGET,
        "AuthorizeRunAgent",
      ).name,
    ).toBe("AuthorizeRunAgent");
  });

  it("makes NO check when the resolver answers no target", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "deny", reason: "" });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => undefined,
    );
    await step.execute(sessionCtx());
    expect(checks).toEqual([]);
  });

  it("hands the resolved target to the Authorizer verbatim and proceeds on allow", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    const seen: unknown[] = [];
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      (record, stored) => {
        seen.push([record, stored]);
        return TARGET;
      },
    );
    const ctx = sessionCtx();
    await step.execute(ctx);
    expect(checks).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01target",
      },
    ]);
    // The resolver reads the record being BUILT (newState), where the
    // chain's own resolution steps write, never the immutable input; a
    // create has no stored row.
    expect(seen).toEqual([[ctx.newState, undefined]]);
  });

  it("hands an update's resolver the stored row the chain loaded", async () => {
    const { authorizer } = fakeAuthorizer({ kind: "allow" });
    const seen: unknown[] = [];
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      (record, stored) => {
        seen.push([record, stored]);
        return undefined;
      },
    );
    const ctx = sessionCtx();
    const stored = create(SessionSchema, {
      metadata: { id: "ses_01stored", name: "s", org: "acme" },
    });
    ctx.set(EXISTING_RESOURCE_KEY, stored);
    await step.execute(ctx);
    expect(seen).toEqual([[ctx.newState, stored]]);
  });

  it("deny → PERMISSION_DENIED carrying the resolver's copy", async () => {
    const { authorizer } = fakeAuthorizer({
      kind: "deny",
      reason: "fga said no",
    });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => TARGET,
    );
    const err = await captureError(() => step.execute(sessionCtx()));
    expect(err.code).toBe(Code.PermissionDenied);
    expect(err.rawMessage).toBe(TARGET.deniedMessage);
  });

  it("not-found → the load-first chain's NOT_FOUND naming the target", async () => {
    const { authorizer } = fakeAuthorizer({ kind: "not-found" });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => TARGET,
    );
    const err = await captureError(() => step.execute(sessionCtx()));
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toContain("agt_01target");
  });

  it("unavailable → INTERNAL, never a softened denial", async () => {
    const { authorizer } = fakeAuthorizer({
      kind: "unavailable",
      cause: new Error("fga down"),
    });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => TARGET,
    );
    const err = await captureError(() => step.execute(sessionCtx()));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe(AUTHORIZATION_UNAVAILABLE_MESSAGE);
  });

  it("the internal caller class skips (the server acting as itself)", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "deny", reason: "" });
    const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
      authorizer,
      () => TARGET,
    );
    await step.execute(sessionCtx("internal"));
    expect(checks).toEqual([]);
  });

  it("every other caller class is checked — a lane is admitted by its Authorizer, never by this step", async () => {
    for (const callerClass of [
      "user",
      "machine",
      "runner",
      "guest",
      "schedule",
    ]) {
      const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
      const step = newAuthorizeRunTargetStep<typeof SessionSchema>(
        authorizer,
        () => TARGET,
      );
      await step.execute(sessionCtx(callerClass));
      expect(checks, callerClass).toHaveLength(1);
    }
  });
});

describe("isRunGateCheck — the one definition of the run-gate check set", () => {
  const pairs: ReadonlyArray<[string, ApiResourceKind, IamPermission]> = [
    ["agent", ApiResourceKind.agent, IamPermission.can_execute],
    ["session", ApiResourceKind.session, IamPermission.can_create_run_in],
  ];

  it.each(pairs)(
    "%s is a run-gate check",
    (_name, resourceKind, permission) => {
      expect(
        isRunGateCheck({ permission, resourceKind, resourceId: "x" }),
      ).toBe(true);
    },
  );

  it("names exactly two checks, one per entry the resolvers draw from", () => {
    expect(Object.keys(RUN_GATE_CHECKS).sort()).toEqual(
      ["agent", "session"].sort(),
    );
    for (const [, resourceKind, permission] of pairs) {
      expect(
        Object.values(RUN_GATE_CHECKS).filter(
          (c) => c.resourceKind === resourceKind && c.permission === permission,
        ),
      ).toHaveLength(1);
    }
  });

  it.each([
    ["session#can_view", ApiResourceKind.session, IamPermission.can_view],
    ["agent#can_edit", ApiResourceKind.agent, IamPermission.can_edit],
    ["agent#can_view", ApiResourceKind.agent, IamPermission.can_view],
    [
      "run#can_execute",
      ApiResourceKind.run,
      IamPermission.can_execute,
    ],
    [
      "organization#can_create_session",
      ApiResourceKind.organization,
      IamPermission.can_create_session,
    ],
    ["session#can_execute", ApiResourceKind.session, IamPermission.can_execute],
  ] as const)(
    "%s is NOT a run-gate check",
    (_name, resourceKind, permission) => {
      expect(
        isRunGateCheck({ permission, resourceKind, resourceId: "x" }),
      ).toBe(false);
    },
  );
});
