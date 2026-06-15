// LLM provider selection for `stigmer setup`.
//
// The decision logic is a pure function (`buildLlmForChoice`) shared by the
// non-interactive flag path and the interactive menu, so both produce identical
// config and the rules are unit-testable in isolation. The interactive menu
// (`runInteractiveWizard`) is a thin shell around it, mirroring the Go wizard's
// provider list and API-key handling (env var first, then a hidden prompt).

import type { Config } from "../../config/config.js";
import { type LlmSettings, setLlm, withProviderDefaults } from "../llm-config.js";
import { promptLine, promptSecret } from "./prompt.js";

export type ProviderChoice = "anthropic" | "openai" | "ollama" | "skip";

export interface SelectionInputs {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Resolve a provider choice (plus optional overrides) to the LLM settings to
 * persist. "skip" yields `undefined`, which clears the section.
 */
export function buildLlmForChoice(choice: ProviderChoice, inputs: SelectionInputs = {}): LlmSettings | undefined {
  if (choice === "skip") return undefined;
  return withProviderDefaults({
    provider: choice,
    model: inputs.model,
    api_key: inputs.apiKey,
    base_url: inputs.baseUrl,
  });
}

/** Apply a provider choice to a config, returning the updated copy. */
export function applyChoice(config: Config, choice: ProviderChoice, inputs: SelectionInputs = {}): Config {
  return setLlm(config, buildLlmForChoice(choice, inputs));
}

/**
 * Run the interactive provider menu against the current terminal. Returns the
 * updated config, or `null` if the user aborts. For cloud providers, an API key
 * already in the environment is used without prompting (matching the Go wizard).
 */
export async function runInteractiveWizard(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<Config | null> {
  process.stderr.write("\nChoose your LLM provider (required for agent execution):\n\n");
  process.stderr.write("  [1] Anthropic  — Cloud API, best quality (requires API key)\n");
  process.stderr.write("  [2] OpenAI     — Cloud API (requires API key)\n");
  process.stderr.write("  [3] Ollama     — Free, local, offline (lower quality output)\n");
  process.stderr.write("  [4] Skip       — Configure later (agents won't execute)\n\n");

  for (;;) {
    const choice = (await promptLine("Select [1-4]: ")).trim();
    switch (choice) {
      case "1":
        return applyChoice(config, "anthropic", { apiKey: await resolveCloudKey("anthropic", env) });
      case "2":
        return applyChoice(config, "openai", { apiKey: await resolveCloudKey("openai", env) });
      case "3":
        return applyChoice(config, "ollama");
      case "4":
        return applyChoice(config, "skip");
      default:
        process.stderr.write("Invalid choice. Please enter 1, 2, 3, or 4.\n");
    }
  }
}

async function resolveCloudKey(provider: "anthropic" | "openai", env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const envVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const existing = env[envVar];
  if (existing) {
    process.stderr.write(`Using ${envVar} from environment\n`);
    return undefined; // env var takes precedence; do not persist a copy
  }
  const key = (await promptSecret(`Enter your ${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key`)).trim();
  return key === "" ? undefined : key;
}
