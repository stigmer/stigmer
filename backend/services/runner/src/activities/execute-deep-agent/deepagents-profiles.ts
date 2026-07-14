/**
 * Stigmer-specific deepagents harness profile registrations.
 *
 * deepagents 1.10.x auto-injects a built-in `general-purpose` sub-agent into
 * every `createDeepAgent()` call unless the caller supplies one with that name.
 * The injected sub-agent carries only deepagents' built-in middleware — not our
 * approval gate — so it is an ungated write/edit path today and would be an
 * ungated `execute` path with a shell backend.
 *
 * Registrations merge additively with deepagents' built-in prompt profiles, so
 * disabling auto-injection here does not alter model prompt overlays.
 */

import { registerHarnessProfile } from "deepagents";

const PROVIDERS_WITH_GP_SUPPRESSION = ["anthropic", "openai"] as const;

let registered = false;

/** Idempotent: safe to call from runner boot and from tests. */
export function registerStigmerDeepagentsProfiles(): void {
  if (registered) return;
  registered = true;

  for (const provider of PROVIDERS_WITH_GP_SUPPRESSION) {
    registerHarnessProfile(provider, {
      generalPurposeSubagent: { enabled: false },
    });
  }
}

/** Test-only: reset the once guard so profile registration can be re-exercised. */
export function resetStigmerDeepagentsProfilesForTests(): void {
  registered = false;
}
