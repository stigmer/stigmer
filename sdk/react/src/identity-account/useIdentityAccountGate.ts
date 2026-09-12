"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ensureMyIdentityAccount } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing the current state of the identity
 * account gate.
 *
 * Narrow on `status` to access variant-specific data:
 *
 * ```ts
 * if (state.status === "ready") {
 *   console.log(state.account.metadata?.id);
 * }
 * ```
 */
export type IdentityAccountGateState =
  | {
      /** Resolving the caller's identity account via whoAmI. */
      readonly status: "checking";
    }
  | {
      /** whoAmI returned NOT_FOUND; provisionMyAccount is in flight. */
      readonly status: "provisioning";
    }
  | {
      /** Identity account is resolved and available. */
      readonly status: "ready";
      /** The resolved identity account. */
      readonly account: IdentityAccount;
    }
  | {
      /** A non-recoverable error occurred. */
      readonly status: "error";
      /** Human-readable failure message suitable for UI display. */
      readonly message: string;
    };

/**
 * Return value of {@link useIdentityAccountGate}.
 *
 * `retry` is always available; the consumer invokes it when
 * `status === "error"`.
 */
export interface UseIdentityAccountGateReturn {
  /** Current gate state. Discriminated union on `status`. */
  readonly state: IdentityAccountGateState;
  /** Re-attempt the identity resolution from scratch. */
  readonly retry: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless behavior hook that ensures the authenticated caller has an
 * identity account before the application renders.
 *
 * The flow itself is `@stigmer/sdk`'s {@link ensureMyIdentityAccount} — the
 * same one the `stigmer` CLI runs on `auth login` and `auth whoami`, and the
 * one a platform builder without React calls directly. This hook adds the
 * React lifecycle around it: a state machine, a `retry`, and the discipline
 * that a retry issued mid-flight discards the earlier attempt's outcome.
 *
 * The hook drives the following lifecycle:
 *
 * 1. **`checking`** — `whoAmI()` looks up the caller's account.
 * 2. **`provisioning`** — `whoAmI` returned NOT_FOUND (first login after
 *    signup); `provisionMyAccount()` creates the account (and, on Stigmer
 *    Cloud, the personal organization).
 * 3. **`ready`** — an identity account is available (either pre-existing
 *    or freshly provisioned).
 * 4. **`error`** — a non-recoverable failure occurred; `message` carries
 *    the reason. Call `retry()` to restart from step 1.
 *
 * The hook is a no-op when `isEnabled` is false — it immediately reports
 * `ready` with a `null`-account shortcut so that disabled-auth deployments
 * skip the gate entirely.
 *
 * @example
 * ```tsx
 * const { state, retry } = useIdentityAccountGate({ isEnabled: true });
 *
 * switch (state.status) {
 *   case "checking":
 *   case "provisioning":
 *     return <Spinner />;
 *   case "ready":
 *     return <>{children}</>;
 *   case "error":
 *     return <ErrorScreen message={state.message} onRetry={retry} />;
 * }
 * ```
 */
export function useIdentityAccountGate(options: {
  /** Set to `true` when OIDC auth is active. When `false`, the gate is bypassed. */
  readonly isEnabled: boolean;
}): UseIdentityAccountGateReturn {
  const { isEnabled } = options;
  const stigmer = useStigmer();

  const [state, setState] = useState<IdentityAccountGateState>(
    isEnabled ? { status: "checking" } : BYPASSED_STATE,
  );

  const attemptRef = useRef(0);

  const resolve = useCallback(async () => {
    // Every setState below is guarded by `attempt`: a retry() issued while
    // this attempt is in flight bumps the counter, and this attempt's
    // outcome — whichever RPC it was waiting on — is discarded.
    const attempt = ++attemptRef.current;
    setState({ status: "checking" });

    try {
      const { account } = await ensureMyIdentityAccount(stigmer, {
        onProvisioning: () => {
          if (attempt === attemptRef.current)
            setState({ status: "provisioning" });
        },
      });
      if (attempt !== attemptRef.current) return;
      setState({ status: "ready", account });
    } catch (err: unknown) {
      if (attempt !== attemptRef.current) return;
      setState({ status: "error", message: toError(err).message });
    }
  }, [stigmer]);

  useEffect(() => {
    if (!isEnabled) {
      setState(BYPASSED_STATE);
      return;
    }
    resolve();
  }, [isEnabled, resolve]);

  const retry = useCallback(() => {
    if (isEnabled) resolve();
  }, [isEnabled, resolve]);

  return { state, retry };
}

/**
 * Sentinel state used when the gate is disabled. The consumer must treat
 * `status === "ready"` without accessing `account` when auth is disabled
 * (there is no real identity in that mode).
 */
const BYPASSED_STATE: IdentityAccountGateState = Object.freeze({
  status: "ready",
  account: null as unknown as IdentityAccount,
});
