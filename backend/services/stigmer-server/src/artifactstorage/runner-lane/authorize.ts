/**
 * Who may have a URL for a key under `artifacts/<run id>/`: anyone who may
 * act on that run, decided by one of two paths, in order.
 *
 * 1. A runner credential. A runner presents the credential of the run it is
 *    serving: the run credential every dispatch carries, or a sandbox's own
 *    token, which is bound to the run that last woke the sandbox. When the
 *    composition decides runner credentials itself (`authorizeRunnerForRun`,
 *    an edition whose credential serves a whole session), its answer
 *    admits; a "no" leaves the bearer to the identity path, since that
 *    edition's runners may present identity tokens. Otherwise open source's
 *    execution-scoped credential admits for its own run while that run is
 *    live, and for any run of the same session and organization: a later
 *    turn reconciles a file review an earlier turn of its session wrote, by
 *    that turn's keys. A credential that verifies but names an unrelated
 *    run, or a run that has ended, is refused outright; it is a runner's,
 *    never a person's, so the identity path does not see it.
 * 2. An identity. Any bearer the composed verifier chain claims (a person's
 *    token, an API key, a composition's own runner tokens), admitted when
 *    the composed authorizer allows it to edit the run (an upload) or view
 *    it (a download). That is the check every other read and write of the
 *    run meets, so a URL never reaches someone the run's own API would
 *    refuse. A caller the composed visitor classifier names a visitor (an
 *    edition's shared-agent guest or channel sender) is refused before the
 *    authorizer is asked: a URL on a run's folder is a runner's question,
 *    and a visitor is never a runner, though its own lane account may own
 *    the runs it started. The folder holds what the run's tools returned in
 *    full, which a visitor's conversation never shows it. A classifier that
 *    throws counts as a visitor (extensions/visitor-classifier.ts). A caller
 *    the composed never-runner classifier names is refused the same way,
 *    and for the same reason: an edition's own credential for work the
 *    server starts (a judge run's system account, say) may be permitted on
 *    its runs and is still no runner. That classifier can only refuse, and
 *    one that throws refuses (extensions/never-runner-classifier.ts).
 *
 * The answer separates a missing or unrecognized credential (401) from a
 * refusal (403) and from an authorization or identity backend that could
 * not answer (503, which the runner retries), so an outage never reads as a
 * lockout.
 *
 * Proven by __tests__/authorize.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity, IdentityVerifier } from "../../extensions/identity.js";
import type { NeverRunnerClassifier } from "../../extensions/never-runner-classifier.js";
import type { VisitorClassifier } from "../../extensions/visitor-classifier.js";
import { authenticateBearerToken } from "../../pipeline/interceptors/auth.js";
import {
  loadBoundExecution,
  type BoundExecutionStore,
} from "../../runnerauth/bound-execution.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";

export interface RunnerArtifactAccessDeps {
  readonly logger: Logger;
  readonly runnerAuth: Pick<RunnerCredentialProvider, "authorizeRunnerForRun" | "verify">;
  /** Where a credential's run and the key's run are read, for liveness and session. */
  readonly store: BoundExecutionStore;
  readonly identityVerifiers: ReadonlyArray<IdentityVerifier>;
  readonly authorizer: Authorizer;
  /** Which callers are visitors; absent, nobody is (open source). */
  readonly visitorClassifier?: VisitorClassifier;
  /** Which callers are never runners; absent, no caller is ruled out (open source). */
  readonly neverRunnerClassifier?: NeverRunnerClassifier;
  /** Unix milliseconds; the wall clock when absent. */
  readonly now?: () => number;
}

/** The decision, and for an allow who it was, for the lane's log line. */
export type ArtifactAccess =
  | { readonly kind: "allow"; readonly by: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "deny" }
  | { readonly kind: "unavailable"; readonly cause: string };

/** Whether `token` may have a URL for run `runId`'s keys; `write` for an upload. */
export async function decideArtifactAccess(
  deps: RunnerArtifactAccessDeps,
  token: string,
  runId: string,
  write: boolean,
): Promise<ArtifactAccess> {
  if (token === "") {
    return { kind: "unauthenticated" };
  }
  const asRunner = await runnerCredentialDecision(deps, token, runId);
  if (asRunner !== "not-a-runner-credential") {
    return asRunner;
  }
  return identityDecision(deps, token, runId, write);
}

async function runnerCredentialDecision(
  deps: RunnerArtifactAccessDeps,
  token: string,
  runId: string,
): Promise<ArtifactAccess | "not-a-runner-credential"> {
  const composed = deps.runnerAuth.authorizeRunnerForRun?.bind(deps.runnerAuth);
  if (composed !== undefined) {
    try {
      return (await composed(token, runId))
        ? { kind: "allow", by: "runner" }
        : "not-a-runner-credential";
    } catch (error) {
      deps.logger.warn("Runner credential authorization failed; refusing", {
        error: errorText(error),
      });
      return { kind: "deny" };
    }
  }
  let boundRunId: string;
  try {
    boundRunId = deps.runnerAuth.verify(TOKEN_TYPE_EXECUTION_SCOPED, token);
  } catch {
    return "not-a-runner-credential";
  }
  const now = deps.now?.() ?? Date.now();
  const bound = await loadBoundExecution(deps.store, boundRunId, now);
  if (bound === undefined || !bound.live) {
    deps.logger.warn("An artifact URL was asked for with the credential of a run that has ended; refusing", {
      tokenExecutionId: boundRunId,
      runId,
    });
    return { kind: "deny" };
  }
  if (boundRunId === runId) {
    return { kind: "allow", by: "runner" };
  }
  const named = await loadBoundExecution(deps.store, runId, now);
  if (
    named !== undefined &&
    bound.sessionId !== "" &&
    named.sessionId === bound.sessionId &&
    named.org === bound.org
  ) {
    return { kind: "allow", by: "runner" };
  }
  deps.logger.warn("A runner credential asked for another session's artifacts; refusing", {
    tokenExecutionId: boundRunId,
    runId,
  });
  return { kind: "deny" };
}

async function identityDecision(
  deps: RunnerArtifactAccessDeps,
  token: string,
  runId: string,
  write: boolean,
): Promise<ArtifactAccess> {
  let caller;
  try {
    caller = await authenticateBearerToken(deps.identityVerifiers, token, deps.logger);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
      return { kind: "unauthenticated" };
    }
    return { kind: "unavailable", cause: errorText(error) };
  }
  if (caller === undefined) {
    return { kind: "unauthenticated" };
  }
  if (isVisitor(deps, caller)) {
    deps.logger.warn("A visitor asked for an artifact URL; refusing", {
      identityId: caller.identityId,
      callerClass: caller.callerClass,
      runId,
    });
    return { kind: "deny" };
  }
  if (isNeverRunner(deps, caller)) {
    deps.logger.warn("A caller that is never a runner asked for an artifact URL; refusing", {
      identityId: caller.identityId,
      callerClass: caller.callerClass,
      runId,
    });
    return { kind: "deny" };
  }
  const decision = await deps.authorizer.authorize(caller, {
    permission: write ? IamPermission.can_edit : IamPermission.can_view,
    resourceKind: ApiResourceKind.run,
    resourceId: runId,
  });
  switch (decision.kind) {
    case "allow":
      return { kind: "allow", by: caller.identityId };
    case "deny":
    case "not-found":
      return { kind: "deny" };
    case "unavailable":
      return { kind: "unavailable", cause: decision.cause.message };
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown authorization decision ${String(exhaustive)}`);
    }
  }
}

/** Whether the composed classifier names `caller` a visitor; a throw counts as one. */
function isVisitor(deps: RunnerArtifactAccessDeps, caller: CallerIdentity): boolean {
  if (deps.visitorClassifier === undefined) {
    return false;
  }
  try {
    return deps.visitorClassifier.isVisitor(caller);
  } catch (error) {
    deps.logger.error("Visitor classifier failed; refusing the artifact URL (fail-closed contract)", {
      identityId: caller.identityId,
      error: errorText(error),
    });
    return true;
  }
}

/** Whether the composed classifier names `caller` never a runner; a throw counts as one. */
function isNeverRunner(deps: RunnerArtifactAccessDeps, caller: CallerIdentity): boolean {
  if (deps.neverRunnerClassifier === undefined) {
    return false;
  }
  try {
    return deps.neverRunnerClassifier.isNeverRunner(caller);
  } catch (error) {
    deps.logger.error("Never-runner classifier failed; refusing the artifact URL (fail-closed contract)", {
      identityId: caller.identityId,
      callerClass: caller.callerClass,
      error: errorText(error),
    });
    return true;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
