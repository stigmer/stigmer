/**
 * A tools listing's connect attempt: the one non-secret row that binds the
 * runner credential a listing mints, from the moment the listing starts
 * until it settles. It records who asked (whom the credential acts as,
 * runnerauth/bound-execution.ts), in which organization, for which
 * plugin's server, and the person whose My vault the listing reads. It
 * holds no value: the runner fetches the listing's values when it starts
 * (domain/vault/values.ts).
 *
 * The row is created for every listing and deleted when it settles (the
 * lane's `finally`), so its presence is the binding's liveness. A crash
 * leaves a row behind; its expiry bounds it, past the listing's budget,
 * and each new listing sweeps the expired rows first.
 *
 * Proven by __tests__/list-tools.test.ts and the store contract suites.
 */
import type { Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";

/** What a listing records when it starts. */
export interface ConnectAttemptStart {
  readonly id: string;
  readonly org: string;
  readonly createdBy: string;
  readonly person: string | undefined;
  readonly pluginId: string;
  readonly server: string;
  /** How long the attempt binds its credential: past its listing's budget and settle buffer. */
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
    pluginId: start.pluginId,
    server: start.server,
    createdAt: nowSeconds,
    expiresAt: nowSeconds + Math.ceil(start.ttlMs / 1000),
  });
}

/** Ends an attempt once its listing settles; a failure is logged, never thrown (the answer is already given). */
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
