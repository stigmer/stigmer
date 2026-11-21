/**
 * Pins who may have a URL for a run's artifact keys (authorize.ts), arm by
 * arm:
 *
 *   - a runner credential bound to the key's run is admitted while that
 *     run is live, and refused once it has ended;
 *   - one bound to another live run of the same session and organization
 *     is admitted (a later turn reads an earlier turn's file review);
 *   - one bound to a run of another session, or of another organization,
 *     is refused, and never reaches the identity path;
 *   - a composition's own runner decision admits on yes, and on no leaves
 *     the bearer to the identity path;
 *   - an identity is admitted by the authorizer's allow on the run, with
 *     edit for an upload and view for a download; deny and not-found
 *     refuse, unavailable is unavailable;
 *   - a caller the composed classifier names a visitor, or one it throws
 *     on, is refused before the authorizer is asked;
 *   - no credential, or one no verifier claims, is unauthenticated, and a
 *     verifier that throws a non-authentication fault is unavailable.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { AuthzCheck, AuthzDecision, Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity, IdentityVerifier } from "../../../extensions/identity.js";
import type { BoundExecutionStore } from "../../../runnerauth/bound-execution.js";
import { InvalidTokenError, TOKEN_TYPE_EXECUTION_SCOPED } from "../../../runnerauth/runnerauth.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { decideArtifactAccess, type RunnerArtifactAccessDeps } from "../authorize.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const logger = createLogger({ level: "error", pretty: false, write: () => {} });

function run(id: string, sessionId: string, opts: { org?: string; ended?: boolean } = {}) {
  return create(RunSchema, {
    metadata: { id, name: id, org: opts.org ?? "acme" },
    spec: { target: { case: "sessionId", value: sessionId } },
    status: {
      phase: opts.ended === true ? RunPhase.RUN_COMPLETED : RunPhase.RUN_IN_PROGRESS,
      completedAt: opts.ended === true ? "2026-11-18T12:00:00Z" : "",
    },
  });
}

function storeOf(rows: Record<string, unknown>): BoundExecutionStore {
  const unused = (): Promise<never> => Promise.reject(new Error("unused"));
  return {
    getResource<Desc extends DescMessage>(kind: ApiResourceKind, id: string, _schema: Desc): Promise<MessageShape<Desc>> {
      const row = rows[id];
      return row === undefined
        ? Promise.reject(new ResourceNotFoundError(`${kind}/${id}`))
        : Promise.resolve(row as MessageShape<Desc>);
    },
    connectAttempts: { create: unused, delete: unused, deleteExpired: unused, deleteByOrg: unused, findLive: unused },
  };
}

/** Run credentials are `run:<id>`; anything else is not one. */
function verify(lane: string, token: string): string {
  if (lane !== TOKEN_TYPE_EXECUTION_SCOPED || !token.startsWith("run:")) {
    throw new InvalidTokenError();
  }
  return token.slice("run:".length);
}

const person: CallerIdentity = { identityId: "ida_person", callerClass: "user", issuer: "test", rawToken: "person" };

function depsOf(opts: {
  rows?: Record<string, unknown>;
  decide?: (check: AuthzCheck) => AuthzDecision;
  verifier?: (token: string) => Promise<CallerIdentity | null>;
  authorizeRunnerForRun?: (token: string, runId: string) => Promise<boolean>;
  isVisitor?: (caller: CallerIdentity) => boolean;
}): RunnerArtifactAccessDeps & { checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  const authorizer: Authorizer = {
    authorize(_caller, check) {
      checks.push(check);
      return Promise.resolve(opts.decide?.(check) ?? { kind: "deny", reason: "test" });
    },
  };
  const verifier: IdentityVerifier = {
    name: "test",
    verify: opts.verifier ?? ((token) => Promise.resolve(token === "person" ? person : null)),
  } as IdentityVerifier;
  return {
    checks,
    logger,
    now: () => NOW,
    store: storeOf(
      opts.rows ?? {
        run_1: run("run_1", "ses_a"),
        run_2: run("run_2", "ses_a"),
        run_3: run("run_3", "ses_b"),
        run_4: run("run_4", "ses_a", { org: "other" }),
        run_old: run("run_old", "ses_a", { ended: true }),
      },
    ),
    runnerAuth: {
      verify,
      ...(opts.authorizeRunnerForRun === undefined ? {} : { authorizeRunnerForRun: opts.authorizeRunnerForRun }),
    },
    identityVerifiers: [verifier],
    authorizer,
    ...(opts.isVisitor === undefined ? {} : { visitorClassifier: { isVisitor: opts.isVisitor } }),
  };
}

describe("decideArtifactAccess: a runner credential", () => {
  it("admits its own live run, and refuses it once the run has ended", async () => {
    const deps = depsOf({});
    expect(await decideArtifactAccess(deps, "run:run_1", "run_1", true)).toEqual({ kind: "allow", by: "runner" });
    expect(await decideArtifactAccess(deps, "run:run_old", "run_old", true)).toEqual({ kind: "deny" });
  });

  it("admits another run of its session and organization, the later turn reading an earlier one's review", async () => {
    const deps = depsOf({});
    expect(await decideArtifactAccess(deps, "run:run_2", "run_1", false)).toEqual({ kind: "allow", by: "runner" });
    expect(await decideArtifactAccess(deps, "run:run_1", "run_old", false)).toEqual({ kind: "allow", by: "runner" });
  });

  it("refuses another session's run, another organization's, and an unknown run, without asking the authorizer", async () => {
    const deps = depsOf({ decide: () => ({ kind: "allow" }) });
    expect(await decideArtifactAccess(deps, "run:run_1", "run_3", false)).toEqual({ kind: "deny" });
    expect(await decideArtifactAccess(deps, "run:run_1", "run_4", false)).toEqual({ kind: "deny" });
    expect(await decideArtifactAccess(deps, "run:run_1", "run_missing", false)).toEqual({ kind: "deny" });
    expect(deps.checks).toEqual([]);
  });

  it("follows a composition's own runner decision on yes, and hands a no to the identity path", async () => {
    const deps = depsOf({
      authorizeRunnerForRun: (token) => Promise.resolve(token === "sandbox"),
      decide: () => ({ kind: "allow" }),
    });
    expect(await decideArtifactAccess(deps, "sandbox", "run_3", true)).toEqual({ kind: "allow", by: "runner" });
    expect(await decideArtifactAccess(deps, "person", "run_3", true)).toEqual({ kind: "allow", by: "ida_person" });
  });
});

describe("decideArtifactAccess: an identity", () => {
  it("asks edit on the run for an upload and view for a download", async () => {
    const deps = depsOf({ decide: () => ({ kind: "allow" }) });
    await decideArtifactAccess(deps, "person", "run_1", true);
    await decideArtifactAccess(deps, "person", "run_1", false);
    expect(deps.checks.map((c) => [c.permission, c.resourceId])).toEqual([
      [IamPermission.can_edit, "run_1"],
      [IamPermission.can_view, "run_1"],
    ]);
  });

  it.each([
    [{ kind: "deny", reason: "no" } as AuthzDecision, { kind: "deny" }],
    [{ kind: "not-found" } as AuthzDecision, { kind: "deny" }],
    [{ kind: "unavailable", cause: new Error("fga down") } as AuthzDecision, { kind: "unavailable", cause: "fga down" }],
  ])("maps the authorizer's %o", async (decision, expected) => {
    expect(await decideArtifactAccess(depsOf({ decide: () => decision }), "person", "run_1", false)).toEqual(expected);
  });

  it("is unauthenticated with no credential, one nobody claims, or one a verifier refuses", async () => {
    expect(await decideArtifactAccess(depsOf({}), "", "run_1", false)).toEqual({ kind: "unauthenticated" });
    expect(await decideArtifactAccess(depsOf({}), "stranger", "run_1", false)).toEqual({ kind: "unauthenticated" });
    const refusing = depsOf({ verifier: () => Promise.reject(new ConnectError("expired", Code.Unauthenticated)) });
    expect(await decideArtifactAccess(refusing, "person", "run_1", false)).toEqual({ kind: "unauthenticated" });
  });

  it("refuses a caller the composed classifier names a visitor, and one it cannot classify, without asking the authorizer", async () => {
    const visitor = depsOf({ decide: () => ({ kind: "allow" }), isVisitor: () => true });
    expect(await decideArtifactAccess(visitor, "person", "run_1", false)).toEqual({ kind: "deny" });
    expect(visitor.checks).toEqual([]);
    const broken = depsOf({
      decide: () => ({ kind: "allow" }),
      isVisitor: () => {
        throw new Error("classifier down");
      },
    });
    expect(await decideArtifactAccess(broken, "person", "run_1", true)).toEqual({ kind: "deny" });
    expect(broken.checks).toEqual([]);
    const member = depsOf({ decide: () => ({ kind: "allow" }), isVisitor: () => false });
    expect(await decideArtifactAccess(member, "person", "run_1", false)).toEqual({ kind: "allow", by: "ida_person" });
  });

  it("is unavailable when a verifier cannot answer", async () => {
    const down = depsOf({ verifier: () => Promise.reject(new ConnectError("issuer unreachable", Code.Unavailable)) });
    expect(await decideArtifactAccess(down, "person", "run_1", false)).toMatchObject({ kind: "unavailable" });
  });
});
