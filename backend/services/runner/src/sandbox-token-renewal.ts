/**
 * Self-renewal of a cloud sandbox's control-plane credential (STIGMER_TOKEN).
 *
 * A sandbox token is minted with a fixed TTL, but the sandbox it serves has
 * no fixed lifetime: an active conversation extends a session sandbox
 * indefinitely, and a long workflow run can outlast any TTL chosen at
 * provisioning. Before this module, the only refresh path was the control
 * plane's Secret-rewrite + pod restart — which the 2026-08-05 incident
 * showed both sacrifices the turn that trips it (the old pod picks up the
 * work holding the dead env token) and wipes an ephemeral sandbox's
 * workspace. Renewal decouples credential lifetime from sandbox lifetime:
 * the runner re-mints in-process before expiry via the getRunnerScopedToken
 * `renewal` arm, and the server bounds renewability by the live sandbox
 * record (a reaped sandbox's credential dies with it).
 *
 * Relationship to {@link createRunnerTokenCoordinator}
 * (runner-token-coordinator.ts): the coordinator owns the PROXY credential
 * (x-stigmer-auth) and re-mints it using the control-plane token; this
 * module keeps that control-plane token itself fresh, so the two form one
 * chain with no expiring root. They stay separate modules because their
 * hosts differ — every proxy-mode runner has a coordinator, but only
 * in-cluster sandbox runners (static cloud sandboxes and pool members) hold
 * a renewable credential; the desktop's control-plane token is the user's
 * own Auth0 token, refreshed by the host app.
 *
 * The loop re-reads the CURRENT token every cycle rather than binding to
 * the boot credential, because the credential's class can change under it:
 * a pool member boots with a non-renewable pool_sandbox token and swaps to
 * a renewable session token at claim time (attach-session.ts). A
 * non-renewable token parks the loop on a slow recheck instead of stopping
 * it, so the swap is picked up without any coupling to the claim path.
 */

/**
 * Renew once the token has lived this fraction of its issued lifetime
 * (anchored on iat/exp, the coordinator's 0.8 convention). Anchoring on the
 * ISSUED lifetime matters: a fraction of the *remaining* lifetime re-arms at
 * 80% of an ever-shrinking remainder and never reaches the renewal point.
 */
const RENEW_AT_LIFETIME_FRACTION = 0.8;

/**
 * Fallback safety margin before expiry for a token without an iat claim:
 * renew this early, leaving room for two retry cycles.
 */
const FALLBACK_RENEW_MARGIN_MS = 10 * 60_000;

/** Retry delay after a failed renewal — short enough to recover well before expiry. */
const RETRY_DELAY_MS = 60_000;

/** Recheck cadence while the current token is not a renewable class (pre-claim pool member). */
const RECHECK_DELAY_MS = 60_000;

/** Floor for any scheduled delay so a malformed expiry cannot spin a hot loop. */
const MIN_DELAY_MS = 5_000;

/** The token_type claims the renewal arm accepts (mirrors the server's gate). */
const RENEWABLE_TOKEN_TYPES = new Set(["sandbox", "workflow_sandbox"]);

export interface SandboxTokenRenewalOptions {
  /** Reads the credential currently in effect (re-read every cycle; see module doc). */
  readonly getToken: () => string | null | undefined;
  /**
   * Calls the getRunnerScopedToken `renewal` arm authenticated with
   * {@code currentToken}. Returns undefined when the server minted nothing;
   * the loop retries rather than crashing the runner.
   */
  readonly renew: (currentToken: string) => Promise<
    { token: string; expiresInSeconds?: number } | undefined
  >;
  /** Applies a freshly minted credential to every sink the host wires (ref, env, interceptors). */
  readonly applyToken: (token: string) => void;
  /** Optional structured logger; defaults to console. */
  readonly log?: Pick<typeof console, "log" | "warn">;
}

export interface SandboxTokenRenewal {
  /** Stop the renewal timer. Idempotent. */
  stop(): void;
}

/**
 * Whether a token's decoded claims mark it as renewable through the
 * `renewal` arm. Exported so a static-mode host can decide not to start
 * the loop at all for a credential whose class can never change.
 */
export function isRenewableSandboxToken(token: string | null | undefined): boolean {
  const claims = decodeClaims(token);
  return claims !== null
    && RENEWABLE_TOKEN_TYPES.has(claims.tokenType ?? "")
    && claims.expMs !== null;
}

/**
 * Start the renewal loop. The first cycle runs immediately (it only reads
 * the token and schedules; no network call unless the credential is already
 * past its renewal point).
 */
export function startSandboxTokenRenewal(
  options: SandboxTokenRenewalOptions,
): SandboxTokenRenewal {
  const log = options.log ?? console;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void cycle();
    }, Math.max(MIN_DELAY_MS, delayMs));
    // Never keep the process alive solely for a token renewal.
    timer.unref?.();
  };

  const cycle = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    const token = options.getToken() ?? null;
    const claims = decodeClaims(token);

    if (token === null || claims === null
        || !RENEWABLE_TOKEN_TYPES.has(claims.tokenType ?? "")) {
      // Not (yet) a renewable credential — a pre-claim pool member, or a
      // credential class this loop does not own. Park and look again.
      schedule(RECHECK_DELAY_MS);
      return;
    }

    if (claims.expMs === null) {
      // A renewable-class token without an expiry is a mint-side anomaly;
      // renewing "before expiry" is undefined, so park rather than spin.
      log.warn("[sandbox-token-renewal] Credential carries no exp claim; parking");
      schedule(RECHECK_DELAY_MS);
      return;
    }

    const renewAtMs = claims.iatMs !== null
      ? claims.iatMs + (claims.expMs - claims.iatMs) * RENEW_AT_LIFETIME_FRACTION
      : claims.expMs - FALLBACK_RENEW_MARGIN_MS;
    const delayMs = renewAtMs - Date.now();
    if (delayMs > MIN_DELAY_MS) {
      schedule(delayMs);
      return;
    }

    // At or past the renewal point (possibly past expiry after a long pod
    // pause — the attempt is still correct: the server decides).
    try {
      const renewed = await options.renew(token);
      if (renewed) {
        options.applyToken(renewed.token);
        log.log("[sandbox-token-renewal] Sandbox credential renewed");
        // Recompute from the fresh token (its own exp is authoritative).
        schedule(MIN_DELAY_MS);
      } else {
        log.warn("[sandbox-token-renewal] Server minted no renewal; will retry");
        schedule(RETRY_DELAY_MS);
      }
    } catch (err) {
      log.warn(
        "[sandbox-token-renewal] Renewal failed; will retry: " +
        `${err instanceof Error ? err.message : err}`,
      );
      schedule(RETRY_DELAY_MS);
    }
  };

  void cycle();

  return {
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Decode the claims this module reads (token_type, iat, exp) from an
 * unverified JWT. Decode-only on purpose: this is the runner's OWN
 * credential, minted by the server it will present it back to —
 * verification happens there.
 */
function decodeClaims(
  token: string | null | undefined,
): { tokenType: string | undefined; iatMs: number | null; expMs: number | null } | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as { token_type?: string; iat?: number; exp?: number };
    return {
      tokenType: payload.token_type,
      iatMs: typeof payload.iat === "number" ? payload.iat * 1000 : null,
      expMs: typeof payload.exp === "number" ? payload.exp * 1000 : null,
    };
  } catch {
    return null;
  }
}
