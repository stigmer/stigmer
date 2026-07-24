// LLM provider selection for `stigmer setup`.
//
// The decision logic is a pure function (`buildLlmForChoice`) shared by the
// non-interactive flag path and the interactive prompt, so both produce
// identical config and the rules are unit-testable in isolation.
//
// Local agent execution is Anthropic-only (the native runner only constructs
// Anthropic clients and the registry's native entries are Anthropic models),
// so the interactive flow is a single API-key prompt rather than a provider
// menu. The model is deliberately NOT asked for: the platform model registry
// owns the execution default, and an explicit override is a power-user flag
// (`stigmer setup --model …`), not a setup question.

import type { Config } from "../../config/config.js";
import { type LlmSettings, setLlm } from "../llm-config.js";
import { promptSecret } from "./prompt.js";

/**
 * The providers `stigmer setup` accepts. This is the single source of truth
 * for the CLI's local-provider surface — `setup --provider` validates against
 * it and a regression test pins it, because every entry here promises an
 * execution path the native runner must actually serve.
 */
export const PROVIDER_CHOICES = ["anthropic", "skip"] as const;

export type ProviderChoice = (typeof PROVIDER_CHOICES)[number];

export interface SelectionInputs {
  apiKey?: string;
  model?: string;
}

/**
 * Resolve a provider choice (plus optional overrides) to the LLM settings to
 * persist. "skip" yields `undefined`, which clears the section. An omitted
 * model is stored as absent — meaning "platform default", resolved from the
 * model registry at execution time.
 */
export function buildLlmForChoice(choice: ProviderChoice, inputs: SelectionInputs = {}): LlmSettings | undefined {
  if (choice === "skip") return undefined;
  const settings: LlmSettings = { provider: choice };
  if (inputs.model) settings.model = inputs.model;
  if (inputs.apiKey) settings.api_key = inputs.apiKey;
  return settings;
}

/** Apply a provider choice to a config, returning the updated copy. */
export function applyChoice(config: Config, choice: ProviderChoice, inputs: SelectionInputs = {}): Config {
  return setLlm(config, buildLlmForChoice(choice, inputs));
}

/**
 * Run the interactive setup against the current terminal: one Anthropic
 * API-key prompt. A key already in the environment is used without prompting
 * (and never persisted — env precedence makes a copy redundant); an empty
 * entry is an explicit skip.
 */
export async function runInteractiveWizard(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  process.stderr.write("\nStigmer runs local agents on Anthropic Claude models.\n");
  process.stderr.write("The model is chosen automatically from the platform model registry.\n\n");

  if (env.ANTHROPIC_API_KEY) {
    process.stderr.write("Using ANTHROPIC_API_KEY from environment\n");
    return applyChoice(config, "anthropic");
  }

  const key = (await promptSecret("Enter your Anthropic API key (press Enter to skip)")).trim();
  if (key === "") {
    process.stderr.write("Skipped. Agents won't execute until a provider is configured (stigmer setup).\n");
    return applyChoice(config, "skip");
  }
  return applyChoice(config, "anthropic", { apiKey: key });
}
