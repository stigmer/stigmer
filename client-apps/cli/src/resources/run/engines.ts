// The engines the CLI names by word (`--harness`, an eval run's
// `<engine>/<model>`, the account's `default_harness`), in one table every
// reader shares: the flag check, an agent's engine as a flag, the create's
// engine, the eval target parser, the account's default model and the run
// header. Typed over the proto's engines, so an engine the proto adds is a
// compile error here until it has a word, a name and a default-model field.

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { IdentityAccountPreferences } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";

/** One engine: its proto member, its name as a person reads it, and the account preference holding its default model. */
interface EngineEntry {
  readonly harness: Exclude<Harness, Harness.UNSPECIFIED>;
  readonly label: string;
  readonly accountModel: keyof IdentityAccountPreferences;
}

/** Every engine by the word the CLI takes, in proto order. */
export const ENGINES = {
  native: { harness: Harness.NATIVE, label: "Stigmer", accountModel: "defaultNativeModel" },
  claude: { harness: Harness.CLAUDE, label: "Claude", accountModel: "defaultClaudeModel" },
} as const satisfies Record<string, EngineEntry>;

/** An engine's word: `native` or `claude`. */
export type EngineWord = keyof typeof ENGINES;

/** The engine words, in proto order. */
export const ENGINE_WORDS = Object.keys(ENGINES) as EngineWord[];

/** The words, quoted and joined for a refusal: `"native" or "claude"`. */
export const ENGINE_WORD_LIST = `${ENGINE_WORDS.slice(0, -1).map((word) => `"${word}"`).join(", ")} or "${ENGINE_WORDS.at(-1)!}"`;

const WORD_BY_HARNESS: Readonly<Record<Exclude<Harness, Harness.UNSPECIFIED>, EngineWord>> = {
  [Harness.NATIVE]: "native",
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
