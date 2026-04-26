"use client";

import { useEffect, useState } from "react";
import { useOrg } from "./OrgProvider";

const PROVISIONING_POLL_MS = 2_000;
const PROVISIONING_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link useOrgGate} by the host application.
 *
 * Both values are computed by the consumer using framework-specific APIs
 * (e.g. `usePathname()` in Next.js, `useLocation()` in react-router) so
 * that the hook itself has zero framework dependencies.
 */
export interface UseOrgGateOptions {
  /** True when the current route should bypass the gate (e.g. `/invite/` links). */
  readonly isBypassed: boolean;
  /** True when the auth mode supports server-side personal org provisioning. */
  readonly isOidcMode: boolean;
}

/**
 * Discriminated union representing the current state of the org gate.
 *
 * Narrow on `status` to access variant-specific data:
 *
 * ```ts
 * if (state.status === "error") {
 *   console.log(state.message); // string — only available on "error"
 * }
 * ```
 */
export type OrgGateState =
  | {
      /** Gate is bypassed for the current route. */
      readonly status: "bypassed";
    }
  | {
      /** Initial organization list fetch is in progress. */
      readonly status: "loading";
    }
  | {
      /** Personal organization provisioning is in progress. */
      readonly status: "provisioning";
    }
  | {
      /** Organization fetch failed and user action is required. */
      readonly status: "error";
      /** Human-readable failure message suitable for UI display. */
      readonly message: string;
    }
  | {
      /** No organizations are available for the current user. */
      readonly status: "no-orgs";
    }
  | {
      /** At least one organization is available and the app can render. */
      readonly status: "ready";
    };

/**
 * Return value of {@link useOrgGate}.
 *
 * `retry` and `refresh` are always available; the consumer invokes them
 * in the appropriate state (`retry` when `status === "error"`, `refresh`
 * when `status === "no-orgs"` after creating an organization).
 */
export interface UseOrgGateReturn {
  /** Current gate state. Discriminated union on `status`. */
  readonly state: OrgGateState;
  /** Re-attempt the organization fetch after a failure. */
  readonly retry: () => void;
  /** Refetch orgs (e.g. after creating one). Optionally auto-select by slug. */
  readonly refresh: (targetSlug?: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless behavior hook that encapsulates the org-gate provisioning
 * state machine.
 *
 * The hook observes the organization context from {@link useOrg} and
 * drives the following lifecycle:
 *
 * 1. **`bypassed`** — `isBypassed` is true; the gate is inactive.
 * 2. **`loading`** — the initial org list fetch is in flight.
 * 3. **`provisioning`** — OIDC mode, zero orgs: the server is creating
 *    the personal org. The hook polls every 2 s and times out after 10 s.
 * 4. **`error`** — the org fetch failed; `message` carries the reason.
 * 5. **`no-orgs`** — no organizations exist (or provisioning timed out);
 *    the consumer should show an onboarding form.
 * 6. **`ready`** — at least one org exists; render the app.
 *
 * The consumer computes `isBypassed` and `isOidcMode` using
 * framework-specific APIs and passes them in, keeping this hook free of
 * routing or auth-framework dependencies (DD-004).
 *
 * @example
 * ```tsx
 * const { state, retry, refresh } = useOrgGate({ isBypassed, isOidcMode });
 *
 * switch (state.status) {
 *   case "bypassed":
 *   case "ready":
 *     return <>{children}</>;
 *   case "loading":
 *     return <Spinner />;
 *   case "provisioning":
 *     return <WelcomeScreen />;
 *   case "error":
 *     return <ErrorScreen message={state.message} onRetry={retry} />;
 *   case "no-orgs":
 *     return <OnboardingForm onCreated={(org) => refresh(org.slug)} />;
 * }
 * ```
 */
export function useOrgGate(options: UseOrgGateOptions): UseOrgGateReturn {
  const { isBypassed, isOidcMode } = options;
  const { orgs, isLoading, error, retry, refresh } = useOrg();

  const [provisioningStarted, setProvisioningStarted] = useState(false);
  const [provisioningTimedOut, setProvisioningTimedOut] = useState(false);

  // React-sanctioned "adjust state during render" pattern: the guard on
  // `!provisioningStarted` prevents infinite re-render loops.
  if (
    !isBypassed &&
    !provisioningStarted &&
    !isLoading &&
    orgs.length === 0 &&
    !error &&
    isOidcMode
  ) {
    setProvisioningStarted(true);
  }

  const isProvisioning =
    provisioningStarted && orgs.length === 0 && !provisioningTimedOut;

  // Poll for the personal org while provisioning is in progress.
  // Errors from refresh() are absorbed — transient failures (identity not
  // yet created) are expected during the provisioning window.
  useEffect(() => {
    if (!isProvisioning) return;

    const interval = setInterval(() => refresh(), PROVISIONING_POLL_MS);
    const timeout = setTimeout(
      () => setProvisioningTimedOut(true),
      PROVISIONING_TIMEOUT_MS,
    );

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isProvisioning, refresh]);

  // Resolve state — order matters: bypass and provisioning take priority.
  let state: OrgGateState;
  if (isBypassed) {
    state = { status: "bypassed" };
  } else if (isProvisioning) {
    state = { status: "provisioning" };
  } else if (isLoading) {
    state = { status: "loading" };
  } else if (error) {
    state = { status: "error", message: error };
  } else if (orgs.length === 0) {
    state = { status: "no-orgs" };
  } else {
    state = { status: "ready" };
  }

  return { state, retry, refresh };
}
