/**
 * Stigmer-specific deepagents harness profile registrations.
 *
 * Two defaults of deepagents' `createDeepAgent()` are turned off for every
 * provider the runner builds a model for:
 *
 * - The auto-injected `general-purpose` sub-agent. It carries only
 *   deepagents' built-in middleware — not our approval gate — so it would be
 *   an ungated write/edit path, and an ungated `execute` path with a shell
 *   backend. The runner compiles its own gated `general-purpose` instead
 *   (`subagent-transformer.ts`).
 * - The built-in `delete` tool (deepagents 1.13+), a recursive delete through
 *   the backend. The CAS capture backends observe `write` and `edit` only, so
 *   a directory delete would lose the before-bytes file review needs for the
 *   gitignored files beneath it. Deleting stays where it has always been on
 *   this harness: `rm` through the approval-gated shell. Excluding the tool
 *   here means the filesystem middleware never builds it, on the parent and
 *   on every sub-agent (1.14 resolves the profile per sub-agent model); the
 *   capture backends refuse a backend delete as well, for a graph whose model
 *   no profile resolves (`cas-capture-backend.ts`).
 *
 * Registrations merge additively with deepagents' built-in model profiles, so
 * neither exclusion alters the model prompt overlays.
 */

import { registerHarnessProfile } from "deepagents";

/**
 * deepagents places a graph's profile by its model's class, from a table of
 * three names (`ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI`) at
 * deepagents 1.14.1, and otherwise by the model's `provider:model` name. A
 * Gemini graph's model is LangChain's current Google client (`ChatGoogle`),
 * which the table does not hold, so the runner's Google model states that
 * name (`google:<id>`, `shared/model-client.ts`) and `google` is registered
 * here. Pinned by `__tests__/gemini-graph-profile.test.ts`.
 */
const PROVIDERS_WITH_STIGMER_PROFILE = ["anthropic", "openai", "google"] as const;

/** Built-in tools the Stigmer harness never exposes; see the header. */
export const EXCLUDED_BUILTIN_TOOLS: readonly string[] = ["delete"];

let registered = false;

/** Idempotent: safe to call from runner boot and from tests. */
export function registerStigmerDeepagentsProfiles(): void {
  if (registered) return;
  registered = true;

  for (const provider of PROVIDERS_WITH_STIGMER_PROFILE) {
    registerHarnessProfile(provider, {
      generalPurposeSubagent: { enabled: false },
      excludedTools: [...EXCLUDED_BUILTIN_TOOLS],
    });
  }
}

/** Test-only: reset the once guard so profile registration can be re-exercised. */
export function resetStigmerDeepagentsProfilesForTests(): void {
  registered = false;
}
