// How each model provider is presented: its name, the shape of its keys,
// where a person gets one, whether it can be served from an endpoint of the
// organization's own, and how a person gives their own machine's runner its
// key. Keyed by the server's provider name: the server decides which
// providers exist and in what order, and a name this table does not know is
// presented plainly by `presentationOf`, so a provider added on the server
// shows up before any client knows it.

/** How one provider is presented. */
export interface ProviderPresentation {
  readonly name: string;
  /** The key field's placeholder, in the shape of the provider's keys. */
  readonly placeholder: string;
  /** Where a person creates a key; `null` for a provider this build does not know. */
  readonly keysUrl: string | null;
  /** The keys page's address as shown, without the scheme. */
  readonly keysUrlLabel: string | null;
  /**
   * An example own endpoint, as the provider's SDK takes it, for a provider
   * that can be served from an endpoint of the organization's; `null` for
   * one served only from its own hosts, which gets no base-URL field.
   */
  readonly baseUrlExample: string | null;
  /**
   * How a person gives their own machine's runner this provider's key: the
   * sentence before the commands, and the commands, run in order. Matches
   * the server's refusal for a runner without the key. `null` for a
   * provider this build does not know.
   */
  readonly runnerSetup: RunnerSetup | null;
}

/** A piece of a sentence: plain words, or a command or variable set as code. */
export type SentencePart = string | { readonly code: string };

/** How a person gives their own machine's runner one provider's key. */
export interface RunnerSetup {
  /** The sentence before the commands, ending in a colon. */
  readonly lead: string;
  /** The commands, run in order. */
  readonly commands: readonly string[];
  /** The same in one sentence, for a line with no room for a command block. */
  readonly inline: readonly SentencePart[];
}

/** The restart that makes a laptop's runner read a new key. */
const RESTART = "stigmer down && stigmer up";

const PRESENTATIONS: Readonly<Record<string, ProviderPresentation>> = {
  anthropic: {
    name: "Anthropic",
    placeholder: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
    keysUrlLabel: "console.anthropic.com",
    baseUrlExample: "https://gateway.example.com",
    runnerSetup: {
      lead: "Run stigmer setup in a terminal on this machine, then restart Stigmer:",
      commands: ["stigmer setup", RESTART],
      inline: ["Run ", { code: "stigmer setup" }, ", then ", { code: RESTART }, "."],
    },
  },
  openai: {
    name: "OpenAI",
    placeholder: "sk-…",
    keysUrl: "https://platform.openai.com/api-keys",
    keysUrlLabel: "platform.openai.com",
    baseUrlExample: "https://gateway.example.com/v1",
    runnerSetup: {
      lead: "Set OPENAI_API_KEY in the shell you start Stigmer from, then restart Stigmer:",
      commands: ["export OPENAI_API_KEY=<your key>", RESTART],
      inline: ["Set ", { code: "OPENAI_API_KEY" }, " in the shell you start Stigmer from, then run ", { code: RESTART }, "."],
    },
  },
};

/** How `provider` is presented; a provider this table does not know gets its own name and no links. */
export function presentationOf(provider: string): ProviderPresentation {
  return (
    PRESENTATIONS[provider] ?? {
      name: provider.charAt(0).toUpperCase() + provider.slice(1),
      placeholder: "",
      keysUrl: null,
      keysUrlLabel: null,
      baseUrlExample: null,
      runnerSetup: null,
    }
  );
}

/** "an Anthropic key", "an OpenAI key", "a Mistral key". */
export function keyPhrase(provider: string): string {
  const name = presentationOf(provider).name;
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name} key`;
}

/** The mark a not-ready model carries: "Needs an Anthropic key". */
export function needsKeyLabel(provider: string): string {
  return `Needs ${keyPhrase(provider)}`;
}
