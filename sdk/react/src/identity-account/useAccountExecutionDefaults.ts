"use client";

import { useMemo } from "react";
import type { IdentityAccountPreferences } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { isHarnessOption, type HarnessOption } from "../models/harness.js";

/**
 * The current user's account-level execution defaults, shaped for the
 * session launcher's `accountDefaults` prop.
 */
export interface AccountExecutionDefaults {
  /** Preferred harness for new sessions, when declared. */
  readonly harness?: HarnessOption;
  /** Preferred model for native-harness sessions, when declared. */
  readonly nativeModel?: string;
  /** Preferred model for claude-harness sessions, when declared. */
  readonly claudeModel?: string;
  /**
   * Start sessions with "auto-approve tool calls" armed
   * (`default_auto_approve`, stigmer/stigmer#816). A seed like every other
   * field here: an explicit in-session flip beats it for that conversation,
   * and it is never applied to guest/observer surfaces.
   */
  readonly autoApprove?: boolean;
}

/**
 * Each engine's default model, by where it lives: its field on
 * {@link AccountExecutionDefaults}, its field on the account's preferences,
 * and the path an update names it by. One table for every reader and the
 * editor (`AccountPreferencesPanel`), so an engine added to
 * {@link HarnessOption} is a compile error here until it has all three.
 */
export const ACCOUNT_DEFAULT_MODELS = {
  native: { defaults: "nativeModel", preference: "defaultNativeModel", path: "spec.preferences.default_native_model" },
  claude: { defaults: "claudeModel", preference: "defaultClaudeModel", path: "spec.preferences.default_claude_model" },
} as const satisfies Record<
  HarnessOption,
  { readonly defaults: keyof AccountExecutionDefaults; readonly preference: keyof IdentityAccountPreferences; readonly path: string }
>;

/** The account's default model for `harness`, when declared. */
export function accountDefaultModel(defaults: AccountExecutionDefaults | undefined, harness: HarnessOption): string | undefined {
  return defaults?.[ACCOUNT_DEFAULT_MODELS[harness].defaults];
}

/**
 * Data hook that reads the current user's execution defaults
 * (`IdentityAccountSpec.preferences.default_*`) for seeding new-session
 * composers.
 *
 * Returns `undefined` while loading, on error (including a server that
 * cannot answer `whoAmI`), and when no default is declared — every one of
 * those cases degrades to the platform's existing defaults, so consumers
 * wire the result straight through. Served in every edition: a
 * trusted-local server answers with the operator account it creates at
 * boot, so a laptop's saved defaults seed the composer too.
 *
 * @example
 * ```tsx
 * <NewSessionViewer org={org} accountDefaults={useAccountExecutionDefaults()} />
 * ```
 *
 * The defaults are a SEED, not an override: an explicit device-local pick
 * outranks them (the layered precedence in `useNewSessionFlow`), and the
 * chosen values ride the run spec explicitly. Rides
 * `useMyIdentityAccount`'s cross-mount cache, so the seed is available
 * synchronously on every visit after the first.
 */
export function useAccountExecutionDefaults(): AccountExecutionDefaults | undefined {
  const { account } = useMyIdentityAccount();

  return useMemo(() => {
    const prefs = account?.spec?.preferences;
    if (!prefs) return undefined;

    // The proto validates default_harness to the shipped set, but a client
    // must not trust persisted data it did not write — unknown values are
    // treated as undeclared.
    const harness = isHarnessOption(prefs.defaultHarness) ? prefs.defaultHarness : undefined;
    const models = Object.fromEntries(
      Object.values(ACCOUNT_DEFAULT_MODELS).flatMap(({ defaults, preference }) => (prefs[preference] ? [[defaults, prefs[preference]]] : [])),
    ) as Pick<AccountExecutionDefaults, "nativeModel" | "claudeModel">;
    // Only a declared `true` travels — an unset bool is "no preference",
    // matching the empty-string convention of the fields above.
    const autoApprove = prefs.defaultAutoApprove || undefined;

    if (!harness && Object.keys(models).length === 0 && !autoApprove) return undefined;
    return { harness, ...models, autoApprove };
  }, [account]);
}
