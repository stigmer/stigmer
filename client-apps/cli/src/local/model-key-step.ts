// The model key step `stigmer up` and `stigmer setup` share: which key the
// local runner will send to Anthropic and where, whether Anthropic takes it,
// and, on a terminal, asking for one when there is none or the saved one is
// refused. It says why first, the same words the console's key step says
// (sdk/react's provider-presentation.ts), so a person meets one explanation on
// every face.
//
// Only a key Stigmer can judge is checked: the key the runner sends on the
// "key" route, or to a gateway that was handed one. A gateway with no key, a
// cloud backend (Vertex, Bedrock, Foundry) or the proxy authenticates some
// other way, and stays as before. The key checked is the one the runner gets:
// an exported ANTHROPIC_API_KEY wins over the saved one (llm-config.ts), so
// an exported key Anthropic refuses is never prompted over (a pasted key
// would not reach the runner); one line says what to do instead.
//
// Nothing is asked off a terminal or under `--json` and `--quiet` (CLI-05):
// there the check still runs, and the card says what it found.

import type { Config } from "../config/config.js";
import { resolveApiKey, setLlm } from "./llm-config.js";
import { type KeyCheck, checkAnthropicKey } from "./key-check.js";
import { providerReach, type ReachEnv } from "./provider-reach.js";

/** Where a person gets an Anthropic key (the console's link says the same). */
export const ANTHROPIC_KEYS_URL = "https://console.anthropic.com/settings/keys";

/** Why Stigmer asks for the key, then where to get one: the prompt's first lines. */
export const KEY_REASON_LINES = [
  "Your agents think with a model. Stigmer uses your own Anthropic key,",
  `so you pay Anthropic directly. Get one at ${ANTHROPIC_KEYS_URL}`,
] as const;

/** The prompt's own question. */
export const KEY_QUESTION = "Anthropic API key (Enter to skip)";

/** Cloud's sentence for a refused key, with what to do. */
export const KEY_REJECTED = "Anthropic rejected this key. Check that it is a valid, active API key";

/** Said on a terminal while a key already set is checked, which can take up to the check's timeout. */
export const KEY_CHECKING_SAVED = "Checking the Anthropic key with Anthropic…\n";

/** Said when Anthropic did not answer the check: the key is kept anyway. */
export const KEY_UNCHECKED = "Anthropic didn't answer, so the key is saved but not checked.";

/** Said once for an exported key Anthropic refuses, which no prompt can replace. */
export const ENV_KEY_REJECTED =
  "Anthropic rejected the key in ANTHROPIC_API_KEY. Export a working key, or unset it and run stigmer setup.";

/** Where the runner sends an Anthropic key: the base its check dials, `""` for Anthropic's own API. */
export interface KeyTarget {
  readonly baseUrl: string;
}

/**
 * Where the runner with environment `env` sends its Anthropic key, or null
 * when it sends none Stigmer can judge (no key, a cloud backend, the proxy,
 * or a gateway with no key).
 */
export function anthropicKeyTarget(env: ReachEnv): KeyTarget | null {
  const anthropic = providerReach(env).find((entry) => entry.provider === "anthropic");
  if (anthropic === undefined) return null;
  const key = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (key === "") return null;
  if (anthropic.via === "key") return { baseUrl: "" };
  if (anthropic.via === "gateway") return { baseUrl: env.ANTHROPIC_BASE_URL?.trim() ?? "" };
  return null;
}

/** What the step needs from the outside world; the commands pass the real ones, tests their own. */
export interface KeyStepDeps {
  /** The environment the runner inherits (the shell's). */
  readonly env: NodeJS.ProcessEnv;
  /** Whether a person is at a terminal to ask (both stdin and stderr a TTY, human output). */
  readonly interactive: boolean;
  readonly loadConfig: () => Config;
  readonly saveConfig: (config: Config) => void;
  readonly promptSecret: (question: string) => Promise<string>;
  /** Where the step speaks: stderr, so stdout stays the card's. */
  readonly write: (text: string) => void;
  readonly check: (key: string, baseUrl: string) => Promise<KeyCheck>;
}

/** What the step found, for the card: the check's answer and whose key it was. */
export interface KeyStepOutcome {
  readonly check: KeyCheck;
  /** True when the key came from an exported ANTHROPIC_API_KEY, which the card's hint names. */
  readonly fromEnvironment: boolean;
}

/** The environment the runner will get once `key` is the resolved Anthropic key. */
function withKey(env: NodeJS.ProcessEnv, key: string): ReachEnv {
  return { ...env, ANTHROPIC_API_KEY: key };
}

/**
 * Ask for a key until Anthropic takes it, does not answer, or the person
 * presses Enter. Prints the reason and the link first, then one line per
 * answer. Returns the key and its check, or undefined for a skip.
 */
export async function askForKey(
  deps: Pick<KeyStepDeps, "env" | "promptSecret" | "write" | "check">,
): Promise<{ readonly key: string; readonly check: KeyCheck } | undefined> {
  deps.write(`\n${KEY_REASON_LINES.join("\n")}\n\n`);
  for (;;) {
    const key = (await deps.promptSecret(KEY_QUESTION)).trim();
    if (key === "") return undefined;
    // The base a pasted key goes to is the one the shell already set.
    const target = anthropicKeyTarget(withKey(deps.env, key));
    if (target === null) return { key, check: "unchecked" };
    deps.write("Checking with Anthropic… ");
    const check = await deps.check(key, target.baseUrl);
    if (check === "accepted") {
      deps.write("✓ accepted\n");
      return { key, check };
    }
    if (check === "unchecked") {
      deps.write(`\n${KEY_UNCHECKED}\n`);
      return { key, check };
    }
    deps.write(`\n✗ ${KEY_REJECTED}, then paste it again, or press Enter to skip.\n`);
  }
}

/**
 * `stigmer up`'s step, run before the daemon starts on a terminal (so a key
 * entered here reaches the runner in this start) and beside the start off
 * one. Returns the check's outcome, or undefined when no key Stigmer can
 * judge is set (the card then says what it says today).
 */
export async function modelKeyStep(deps: KeyStepDeps): Promise<KeyStepOutcome | undefined> {
  const config = deps.loadConfig();
  const key = resolveApiKey(config, deps.env);
  const fromEnvironment = key !== "" && key === deps.env.ANTHROPIC_API_KEY;
  const target = anthropicKeyTarget(withKey(deps.env, key));

  let saved: KeyStepOutcome | undefined;
  if (target !== null) {
    // The check can take up to its timeout: a terminal says what it waits on.
    if (deps.interactive) deps.write(KEY_CHECKING_SAVED);
    const check = await deps.check(key, target.baseUrl);
    saved = { check, fromEnvironment };
    if (check !== "rejected") return saved;
    if (fromEnvironment) {
      if (deps.interactive) deps.write(`${ENV_KEY_REJECTED}\n`);
      return saved;
    }
    if (!deps.interactive) return saved;
    deps.write("\nAnthropic rejected the saved key.");
  } else {
    // Ask only where a key would make Anthropic reachable and nothing reaches
    // it yet: not over a keyless gateway, a cloud backend or the proxy, not
    // over an exported key, and never off a terminal.
    const reached = providerReach(withKey(deps.env, key)).some((entry) => entry.provider === "anthropic");
    const keyWouldServe = !reached && anthropicKeyTarget(withKey(deps.env, "sk-ant-probe")) !== null;
    if (!deps.interactive || key !== "" || !keyWouldServe) return undefined;
  }

  const answer = await askForKey(deps);
  if (answer === undefined) return saved;
  // The same section `stigmer setup` writes, read by the launch that follows.
  deps.saveConfig(setLlm(deps.loadConfig(), { provider: "anthropic", api_key: answer.key }));
  deps.write("Saved for this computer's agents.\n\n");
  return { check: answer.check, fromEnvironment: false };
}
