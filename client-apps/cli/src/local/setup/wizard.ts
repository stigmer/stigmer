// LLM provider selection for `stigmer setup`.
//
// The decision logic is a pure function (`buildLlmForChoice`) shared by the
// non-interactive flag path and the interactive prompt, so both produce
// identical config and the rules are unit-testable in isolation.
//
// Setup saves the one key the Stigmer and Claude engines run the catalog's
// models on, Anthropic's, so the interactive flow is a single API-key prompt
// rather than a provider menu, followed by the skippable operator-identity
// prompt (oss#796). The key prompt is `stigmer up`'s (local/model-key-step.ts):
// it says why, checks the key with Anthropic, and asks again when Anthropic
// refuses it; an exported key is checked and its answer said. The runner reaches the other providers (OpenAI, and
// Anthropic through Vertex, Bedrock, Foundry or a gateway) by settings
// exported in the shell; local/provider-reach.ts says which it reaches. There
// is no model concept here at all: the platform model registry owns the
// execution default, and per-run overrides belong to `stigmer run --model`
// (oss#314 removed the dead setup-level pin).

import type { Config } from "../../config/config.js";
import { type LlmSettings, setLlm } from "../llm-config.js";
import { type KeyCheck, checkAnthropicKey } from "../key-check.js";
import { anthropicKeyTarget, askForKey, ENV_KEY_REJECTED, type KeyStepDeps } from "../model-key-step.js";
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
 * execution path the Stigmer harness must actually serve.
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
  const updated = await runKeyStep(config, {
    env,
    promptSecret,
    write: (text) => process.stderr.write(text),
    check: (key, baseUrl) => checkAnthropicKey(key, baseUrl),
  });
  return runOperatorIdentityStep(updated, env);
}

/** What the interactive key step needs: the terminal and the check, which tests replace. */
export type WizardKeyDeps = Pick<KeyStepDeps, "env" | "promptSecret" | "write" | "check">;

/**
 * The interactive key step: an exported key is used without prompting (and
 * never persisted, env precedence makes a copy redundant), checked, and its
 * answer said; otherwise the shared prompt asks until Anthropic takes a key,
 * does not answer, or the person presses Enter, which skips.
 */
export async function runKeyStep(config: Config, deps: WizardKeyDeps): Promise<Config> {
  deps.write("\nThe model is chosen automatically from the platform model registry.\n");
  const exported = deps.env.ANTHROPIC_API_KEY ?? "";
  if (exported !== "") {
    const target = anthropicKeyTarget(deps.env);
    const check: KeyCheck | undefined = target === null ? undefined : await deps.check(exported, target.baseUrl);
    deps.write(`Using ANTHROPIC_API_KEY from environment${check === undefined ? "" : ENV_CHECK_WORDS[check]}\n`);
    if (check === "rejected") deps.write(`${ENV_KEY_REJECTED}\n`);
    return applyChoice(config, "anthropic");
  }
  const answer = await askForKey(deps);
  if (answer === undefined) {
    deps.write("Skipped. Agents won't execute until a provider is configured (stigmer setup).\n");
    return applyChoice(config, "skip");
  }
  return applyChoice(config, "anthropic", { apiKey: answer.key });
}

/** What an exported key's check adds to its "Using" line. */
const ENV_CHECK_WORDS: Readonly<Record<KeyCheck, string>> = {
  accepted: " (checked with Anthropic just now)",
  rejected: " (rejected by Anthropic)",
  unchecked: " (not checked: Anthropic didn't answer)",
};

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
