// The engines the CLI names by word (`--harness`, an eval run's
// `<engine>/<model>`, the account's `default_harness`), in one table every
// reader shares: the flag check, an agent's engine as a flag, the create's
// engine, the eval target parser, the account's default model and the run
// header. Typed over the proto's engines, so an engine the proto adds is a
// compile error here until it has a word, a name and a default-model field.

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { IdentityAccountPreferences } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";

/** One engine: its proto member, its harness label as a person reads it (docs/vocabulary.md, "Harness"), and the account preference holding its default model. */
interface EngineEntry {
  readonly harness: Exclude<Harness, Harness.UNSPECIFIED>;
  readonly label: string;
  readonly accountModel: keyof IdentityAccountPreferences;
}

/** Every engine by the word the CLI takes, in proto order. */
export const ENGINES = {
  stigmer: { harness: Harness.STIGMER, label: "Stigmer", accountModel: "defaultStigmerModel" },
  claude: { harness: Harness.CLAUDE, label: "Claude Agent", accountModel: "defaultClaudeModel" },
} as const satisfies Record<string, EngineEntry>;

/** An engine's word: `stigmer` or `claude`. */
export type EngineWord = keyof typeof ENGINES;

/** The engine words, in proto order. */
export const ENGINE_WORDS = Object.keys(ENGINES) as EngineWord[];

/**
 * A word as help and refusals show it, beside its label only where the two
 * differ: `"stigmer"`, `"claude" (Claude Agent)`. A word is the first word of
 * its label, in lower case (docs/vocabulary.md, "Harness"), so the two differ
 * where the label says more.
 */
export function engineChoice(word: EngineWord): string {
  const label = ENGINES[word].label;
  return label.toLowerCase() === word ? `"${word}"` : `"${word}" (${label})`;
}

/** The words with their labels, joined for help and refusals: `"stigmer" or "claude" (Claude Agent)`. */
export const ENGINE_WORD_LIST = `${ENGINE_WORDS.slice(0, -1).map(engineChoice).join(", ")} or ${engineChoice(ENGINE_WORDS.at(-1)!)}`;

const WORD_BY_HARNESS: Readonly<Record<Exclude<Harness, Harness.UNSPECIFIED>, EngineWord>> = {
  [Harness.STIGMER]: "stigmer",
  [Harness.CLAUDE]: "claude",
};

/** Whether `word` names an engine. */
export function isEngineWord(word: string): word is EngineWord {
  return Object.hasOwn(ENGINES, word);
}

/** The word of a proto engine, "" for unspecified or a number this build does not name. */
export function engineWordOf(harness: Harness | undefined): EngineWord | "" {
  return harness === undefined ? "" : ((WORD_BY_HARNESS as Partial<Record<Harness, EngineWord>>)[harness] ?? "");
}
