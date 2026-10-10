/**
 * A tool connect's attempt: the one non-secret row that binds the runner
 * credential a connect mints, from the moment the connect starts until it
 * settles. It records who started the connect (whom the credential acts
 * as, runnerauth/bound-execution.ts), in which organization, for which
 * tool, the connecting person whose My vault the connect reads, and, for
 * the runner's backfill of a run's tool, which run's planned values it
 * uses. It holds no value: the runner fetches the connect's values when
 * discovery starts (domain/vault/values.ts).
 *
 * The row is created for every connect that starts a workflow of its own
 * and deleted when that connect settles, on every lane (the blocking
 * connect's `finally`, the async lane's settle and release arms, the
 * best-effort connect's `finally`), so its presence is the binding's
 * liveness. A crash leaves a row behind; its expiry bounds it, past every
 * connect budget, and each new connect sweeps the expired rows first.
 *
 * Proven by __tests__/connect.test.ts and the store contract suites.
 */
import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";

/** What a connect records when it starts. */
export interface ConnectAttemptStart {
  readonly id: string;
  readonly org: string;
  readonly createdBy: string;
  readonly person: string | undefined;
  readonly mcpServerId: string;
  readonly runId: string;
  /** How long the attempt binds its credential: past its connect's budget and settle buffer. */
  readonly ttlMs: number;
}

/** Sweeps expired attempts, then records this one. */
export async function recordConnectAttempt(
  store: Pick<Store, "connectAttempts">,
  logger: Logger,
  start: ConnectAttemptStart,
  now: number = Date.now(),
): Promise<void> {
  const nowSeconds = Math.floor(now / 1000);
  const swept = await store.connectAttempts.deleteExpired(nowSeconds);
  if (swept > 0) {
    logger.info("Swept expired connect attempts", { count: swept });
  }
  await store.connectAttempts.create({
    id: start.id,
    org: start.org,
    createdBy: start.createdBy,
    person: start.person ?? "",
    mcpServerId: start.mcpServerId,
    runId: start.runId,
    createdAt: nowSeconds,
    expiresAt: nowSeconds + Math.ceil(start.ttlMs / 1000),
  });
}

/** Ends an attempt once its connect settles; a failure is logged, never thrown (the result is already stored). */
export async function endConnectAttempt(
  store: Pick<Store, "connectAttempts">,
  logger: Logger,
  id: string,
): Promise<void> {
  try {
    await store.connectAttempts.delete(id);
  } catch (error) {
    logger.warn("Failed to end a connect attempt (non-fatal; it expires)", {
      execution_id: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
