"use client";

import { useMemo } from "react";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import type { HarnessOption } from "../models/harness.js";

/**
 * The current user's account-level execution defaults, shaped for the
 * session launcher's `accountDefaults` prop.
 */
export interface AccountExecutionDefaults {
  /** Preferred harness for new sessions, when declared. */
  readonly harness?: HarnessOption;
  /** Preferred model for native-harness sessions, when declared. */
  readonly nativeModel?: string;
  /** Preferred model for cursor-harness sessions, when declared. */
  readonly cursorModel?: string;
}

/**
 * Data hook that reads the current user's execution defaults
 * (`IdentityAccountSpec.preferences.default_*`) for seeding new-session
 * composers.
 *
 * Returns `undefined` in local mode (no IdentityAccount), while loading,
 * on error, and when no default is declared — every one of those cases
 * degrades to the platform's existing defaults, so consumers wire the
 * result straight through:
 *
 * @example
 * ```tsx
 * <NewSessionViewer org={org} accountDefaults={useAccountExecutionDefaults()} />
 * ```
 *
 * The defaults are a SEED, not an override: an explicit device-local pick
 * outranks them (the layered precedence in `useNewSessionFlow`), and the
 * chosen values ride the execution spec explicitly. Rides
 * `useMyIdentityAccount`'s cross-mount cache, so the seed is available
 * synchronously on every visit after the first.
 */
export function useAccountExecutionDefaults(): AccountExecutionDefaults | undefined {
  const available = useResourceAvailable(ApiResourceKind.identity_account);
  const { account } = useMyIdentityAccount({ enabled: available });

  return useMemo(() => {
    const prefs = account?.spec?.preferences;
    if (!prefs) return undefined;

    // The proto validates default_harness to the shipped set, but a client
    // must not trust persisted data it did not write — unknown values are
    // treated as undeclared.
    const harness =
      prefs.defaultHarness === "native" || prefs.defaultHarness === "cursor"
        ? (prefs.defaultHarness satisfies HarnessOption)
        : undefined;
    const nativeModel = prefs.defaultNativeModel || undefined;
    const cursorModel = prefs.defaultCursorModel || undefined;

    if (!harness && !nativeModel && !cursorModel) return undefined;
    return { harness, nativeModel, cursorModel };
  }, [account]);
}
