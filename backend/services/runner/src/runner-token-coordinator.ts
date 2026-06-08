/**
 * Owns the runner's two-writer token model.
 *
 * The runner authenticates two surfaces with two credentials that may diverge:
 *
 *   - the control-plane token (the host's durable credential, e.g. the desktop's
 *     Auth0 token), used for Authorization on control-plane gRPC; and
 *   - the proxy token (x-stigmer-auth), used for Cursor-proxy traffic.
 *
 * On most hosts these are the same token. On cloud the control plane mints a
 * dedicated iss=stigmer proxy token during bootstrap; from that point the proxy
 * token is a *separate* credential with its own TTL, owned and refreshed here.
 *
 * This coordinator exists because the proxy token's freshness was the subject of
 * two production fixes (stigmer-cloud _changelog 2026-05-26 and 2026-06-01):
 * before them, the proxy token froze at startup and silently 401'd after the
 * host's token refreshed. The lockstep those fixes established — "every token
 * refresh updates the proxy sink too" — is preserved here for hosts that do not
 * mint (see {@link RunnerTokenCoordinator.onControlPlaneTokenChanged}). Once a
 * token is minted, freshness is instead guaranteed by {@link reMint} on a timer,
 * and a control-plane refresh must NOT overwrite the minted token. Keeping that
 * gate in one tested place is the whole point of this module.
 */

import type { RefreshedRunnerToken } from "./bootstrap.js";

/** Fraction of a minted token's lifetime after which the runner re-mints. */
const REFRESH_FRACTION = 0.8;

/** Floor for the refresh delay so a tiny/absent TTL cannot spin a hot loop. */
const MIN_REFRESH_MS = 5_000;

/** Fallback lifetime when the server omits an expiry alongside a minted token. */
const FALLBACK_TTL_SECONDS = 3_600;

/** Retry delay after a failed re-mint, short enough to recover before expiry. */
const RETRY_DELAY_MS = 60_000;

export interface RunnerTokenCoordinatorOptions {
  /** Writes the proxy credential to the x-stigmer-auth interceptors. */
  readonly applyProxyToken: (token: string) => void;
  /**
   * Re-mints the proxy token using the current (always-fresh) control-plane
   * token. Returns undefined on any failure or when no token is minted; the
   * coordinator retries rather than crashing the runner.
   */
  readonly reMint: () => Promise<RefreshedRunnerToken | undefined>;
  /** Optional structured logger; defaults to console. */
  readonly log?: Pick<typeof console, "log" | "warn">;
}

export interface RunnerTokenCoordinator {
  /**
   * Adopt a server-minted proxy token. Applies it immediately and schedules a
   * refresh before expiry. After this, control-plane updates no longer touch the
   * proxy token.
   */
  adoptMintedToken(token: string, expiresInSeconds: number | undefined): void;

  /**
   * Notify the coordinator that the control-plane token changed. While no token
   * has been minted, the proxy token follows it in lockstep (preserving the
   * pre-mint staleness fix); once a token is minted, this is a no-op for the
   * proxy credential.
   */
  onControlPlaneTokenChanged(token: string | null): void;

  /** Whether a server-minted proxy token is currently in effect. */
  isProxyTokenMinted(): boolean;

  /** Stop the refresh timer. Idempotent. */
  stop(): void;
}

export function createRunnerTokenCoordinator(
  options: RunnerTokenCoordinatorOptions,
): RunnerTokenCoordinator {
  const log = options.log ?? console;
  let proxyTokenIsMinted = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  const scheduleRefresh = (expiresInSeconds: number | undefined): void => {
    clearTimer();
    const ttlSeconds =
      expiresInSeconds && expiresInSeconds > 0
        ? expiresInSeconds
        : FALLBACK_TTL_SECONDS;
    const delayMs = Math.max(
      MIN_REFRESH_MS,
      Math.floor(ttlSeconds * REFRESH_FRACTION * 1000),
    );
    refreshTimer = setTimeout(() => {
      void refresh();
    }, delayMs);
    // Do not keep the process alive solely for a token refresh.
    refreshTimer.unref?.();
  };

  const refresh = async (): Promise<void> => {
    const refreshed = await options.reMint();
    if (refreshed) {
      options.applyProxyToken(refreshed.token);
      scheduleRefresh(refreshed.expiresInSeconds);
      log.log("[runner-token] Proxy token refreshed");
    } else {
      // Re-mint failed or yielded no token; retry soon. The host keeps the
      // control-plane token fresh, so a later attempt (e.g. after laptop wake)
      // recovers without a process restart.
      scheduleRefresh(RETRY_DELAY_MS / 1000);
      log.warn("[runner-token] Proxy token refresh failed; will retry");
    }
  };

  return {
    adoptMintedToken(token, expiresInSeconds) {
      proxyTokenIsMinted = true;
      options.applyProxyToken(token);
      scheduleRefresh(expiresInSeconds);
    },
    onControlPlaneTokenChanged(token) {
      if (!proxyTokenIsMinted && token) {
        options.applyProxyToken(token);
      }
    },
    isProxyTokenMinted: () => proxyTokenIsMinted,
    stop: clearTimer,
  };
}
