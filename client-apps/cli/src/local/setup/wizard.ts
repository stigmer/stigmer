// LLM provider selection for `stigmer setup`.
//
// The decision logic is a pure function (`buildLlmForChoice`) shared by the
// non-interactive flag path and the interactive prompt, so both produce
// identical config and the rules are unit-testable in isolation.
//
// Local agent execution is Anthropic-only (the native runner only constructs
// Anthropic clients and the registry's native entries are Anthropic models),
// so the interactive flow is a single API-key prompt rather than a provider
// menu, followed by the skippable operator-identity prompt (oss#796). There
// is no model concept here at all: the platform model registry owns the
// execution default, and per-run overrides belong to `stigmer run --model`
// (oss#314 removed the dead setup-level pin).

import type { Config } from "../../config/config.js";
import { type LlmSettings, setLlm } from "../llm-config.js";
import {
  type OperatorSettings,
  setOperator,
  validateOperatorIdentity,
} from "../operator-config.js";
import { promptLine, promptSecret } from "./prompt.js";

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
}

/**
 * Resolve a provider choice (plus an optional API key) to the LLM settings to
 * persist. "skip" yields `undefined`, which clears the section — including any
 * stale `model` key from a pre-oss#314 config, since setLlm replaces the
 * section wholesale.
 */
export function buildLlmForChoice(choice: ProviderChoice, inputs: SelectionInputs = {}): LlmSettings | undefined {
  if (choice === "skip") return undefined;
  const settings: LlmSettings = { provider: choice };
  if (inputs.apiKey) settings.api_key = inputs.apiKey;
  return settings;
}

/** Apply a provider choice to a config, returning the updated copy. */
export function applyChoice(config: Config, choice: ProviderChoice, inputs: SelectionInputs = {}): Config {
  return setLlm(config, buildLlmForChoice(choice, inputs));
}

/**
 * Resolve operator-identity inputs to the settings to persist, validating the
 * way the server's boot check will (oss#796) — the pure decision core shared
 * by the flag path and the interactive prompt, like buildLlmForChoice. An
 * empty email with an empty name yields `undefined` (nothing to persist —
 * identity stays whatever it was; the anonymous default is the absence of
 * the section, not an empty one). Throws on inputs the server would refuse
 * at boot, so the failure surfaces at setup time.
 */
export function buildOperatorForInputs(email: string, name: string): OperatorSettings | undefined {
  const error = validateOperatorIdentity(email, name);
  if (error !== undefined) {
    throw new Error(error);
  }
  const trimmedEmail = email.trim();
  if (trimmedEmail === "") return undefined;
  const trimmedName = name.trim();
  return trimmedName === "" ? { email: trimmedEmail } : { email: trimmedEmail, name: trimmedName };
}

/** Apply operator-identity inputs to a config, returning the updated copy. */
export function applyOperatorIdentity(config: Config, email: string, name: string): Config {
  const settings = buildOperatorForInputs(email, name);
  return settings === undefined ? config : setOperator(config, settings);
}

/**
 * Run the interactive setup against the current terminal: one Anthropic
 * API-key prompt, then the (skippable) operator-identity prompt. A key
 * already in the environment is used without prompting (and never persisted —
 * env precedence makes a copy redundant); an empty entry is an explicit skip.
 */
export async function runInteractiveWizard(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  process.stderr.write("\nStigmer runs local agents on Anthropic Claude models.\n");
  process.stderr.write("The model is chosen automatically from the platform model registry.\n\n");

  let updated: Config;
  if (env.ANTHROPIC_API_KEY) {
    process.stderr.write("Using ANTHROPIC_API_KEY from environment\n");
    updated = applyChoice(config, "anthropic");
  } else {
    const key = (await promptSecret("Enter your Anthropic API key (press Enter to skip)")).trim();
    if (key === "") {
      process.stderr.write("Skipped. Agents won't execute until a provider is configured (stigmer setup).\n");
      updated = applyChoice(config, "skip");
    } else {
      updated = applyChoice(config, "anthropic", { apiKey: key });
    }
  }

  return runOperatorIdentityStep(updated, env);
}

/**
 * The operator-identity step (oss#796): opt-in, skippable, and env-aware in
 * the same way the API-key step is — an env-provided identity is used without
 * prompting and never persisted (env precedence makes a copy redundant). An
 * invalid entry is refused and NOT persisted (re-run `stigmer setup`), the
 * same rule the server enforces at boot, just earlier.
 */
async function runOperatorIdentityStep(config: Config, env: NodeJS.ProcessEnv): Promise<Config> {
  process.stderr.write(
    "\nAn operator identity attributes local creates to you and unlocks identity-gated MCP tools.\n",
  );

  if ((env.STIGMER_OPERATOR_EMAIL ?? "").trim() !== "") {
    process.stderr.write("Using STIGMER_OPERATOR_EMAIL from environment\n");
    return config;
  }

  const email = (await promptLine("Operator email (press Enter to skip): ")).trim();
  if (email === "") {
    return config;
  }
  const name = (await promptLine("Operator display name (optional): ")).trim();

  try {
    return applyOperatorIdentity(config, email, name);
  } catch (error) {
    process.stderr.write(
      `Not saved: ${error instanceof Error ? error.message : String(error)} — re-run stigmer setup.\n`,
    );
    return config;
  }
}
