/**
 * "Is this bearer the runner acting for run R?" — the one decision the
 * runner's per-run doors share: the session event log's append
 * (domain/session/events/append.ts), the input claim and the File mount
 * (domain/file/mount.ts).
 *
 * A permission cannot answer it: a runner acts as the person who owns the
 * run, so `can_edit` on the run would admit that person, and every editor,
 * as if they were the runner. The composed `authorizeRunnerForRun`
 * capability owns the decision when present (an edition whose runner
 * credential serves a whole session admits it for every run of that
 * session); otherwise the open-source one holds: an execution-scoped
 * credential bound to exactly this run. A capability that throws is a
 * composition fault, logged and refused. Each door then checks for itself
 * that the run exists and is not finished.
 *
 * Proven by the doors' own tests (events/__tests__/append.test.ts, the
 * harness binding's, domain/file/__tests__/mount.test.ts).
 */
import type { Logger } from "../boot/logger.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "./runnerauth.js";
import type { RunnerCredentialProvider } from "./runner-credential-provider.js";

export interface RunnerForRunDeps {
  readonly logger: Logger;
  readonly runnerAuth: Pick<RunnerCredentialProvider, "authorizeRunnerForRun" | "verify">;
}

/** Whether `token` is the runner credential acting for run `runId` (module header). */
export async function isRunnerForRun(deps: RunnerForRunDeps, token: string, runId: string): Promise<boolean> {
  const authorize = deps.runnerAuth.authorizeRunnerForRun?.bind(deps.runnerAuth);
  if (authorize !== undefined) {
    try {
      return await authorize(token, runId);
    } catch (error) {
      deps.logger.warn("Runner credential authorization failed; refusing", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  let bound: string;
  try {
    bound = deps.runnerAuth.verify(TOKEN_TYPE_EXECUTION_SCOPED, token);
  } catch {
    return false;
  }
  if (bound !== runId) {
    deps.logger.warn("A runner credential named another run; refusing", {
      tokenExecutionId: bound,
      runId,
    });
    return false;
  }
  return true;
}
