"use client";

import { useOrg } from "./OrgProvider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link useOrgGate} by the host application.
 *
 * `isBypassed` is computed by the consumer using framework-specific APIs
 * (e.g. `usePathname()` in Next.js, `useLocation()` in react-router) so
 * that the hook itself has zero framework dependencies.
 */
export interface UseOrgGateOptions {
  /** True when the current route should bypass the gate (e.g. `/invite/` links). */
  readonly isBypassed: boolean;
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
 * Headless behavior hook that derives the org-gate state from
 * {@link useOrg}.
 *
 * 1. **`bypassed`** — `isBypassed` is true; the gate is inactive.
 * 2. **`loading`** — the initial org list fetch is in flight.
 * 3. **`error`** — the org fetch failed; `message` carries the reason.
 * 4. **`no-orgs`** — no organizations exist; the consumer should show an
 *    onboarding form.
 * 5. **`ready`** — at least one org exists; render the app.
 *
 * A pure derivation, deliberately: the organization list is final by the
 * time this hook runs. Where a server creates a personal organization on
 * first sign-in (Stigmer Cloud), it does so inside `provisionMyAccount`,
 * before the identity gate ahead of this one reports ready — so there is
 * nothing to wait for, and an empty list means the person creates their
 * first organization now. (The hook once polled for that organization for
 * ten seconds, a relic of an earlier asynchronous provisioner; on a server
 * that never provisions one, every first sign-in paid the full wait.)
 *
 * The consumer computes `isBypassed` using framework-specific APIs and
 * passes it in, keeping this hook free of routing dependencies (DD-004).
 *
 * @example
 * ```tsx
 * const { state, retry, refresh } = useOrgGate({ isBypassed });
 *
 * switch (state.status) {
 *   case "bypassed":
 *   case "ready":
 *     return <>{children}</>;
 *   case "loading":
 *     return <Spinner />;
 *   case "error":
 *     return <ErrorScreen message={state.message} onRetry={retry} />;
 *   case "no-orgs":
 *     return <OnboardingForm onCreated={(org) => refresh(org.slug)} />;
 * }
 * ```
 */
export function useOrgGate(options: UseOrgGateOptions): UseOrgGateReturn {
  const { isBypassed } = options;
  const { orgs, isLoading, error, retry, refresh } = useOrg();

  let state: OrgGateState;
  if (isBypassed) {
    state = { status: "bypassed" };
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
