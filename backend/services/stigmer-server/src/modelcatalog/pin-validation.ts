/**
 * Model-pin existence validation and did-you-mean machinery — ports the Go
 * server's pin_validation.go. Lives beside the store it queries (the
 * registry is the shared validation authority): the agent, schedule and
 * channel pin-existence checks, and
 * agentexecution's thinking-mode validator consume the same functions, so
 * every pin error suggests identically.
 *
 * One deliberate signature delta from Go: Go's UnknownModelPinRefusal reads
 * the process-global registry.Store(); this edition has no singletons (the
 * composition root owns the store), so the store is the first parameter.
 */
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { explicitProvider } from "./document-catalog.js";
import type { ModelCatalogProvider } from "./model-catalog-provider.js";

/**
 * Each harness's one word: the first word of its label, in lower case
 * (docs/vocabulary.md, Harness). The word is what the registry document names a harness's
 * section, what usage reports and the account default store, and what
 * people type; this table is the server's one statement of it, read by
 * every consumer here and exported to the editions so none re-declares
 * string literals. Typed over every harness the proto names, so a harness
 * the proto adds is a compile error here until it has its word.
 */
export const HARNESS_WORDS = {
  [Harness.STIGMER]: "stigmer",
  [Harness.CLAUDE]: "claude",
} as const satisfies Readonly<Record<Exclude<Harness, Harness.UNSPECIFIED>, string>>;

/** A harness's word. */
export type HarnessWord = (typeof HARNESS_WORDS)[keyof typeof HARNESS_WORDS];

/** Every harness's word, in the proto's order. */
export const HARNESS_WORD_LIST: readonly HarnessWord[] = Object.values(HARNESS_WORDS);

const MAX_MODEL_SUGGESTIONS = 3;
const MAX_MODEL_EDIT_DISTANCE = 5;

/**
 * Maps the session harness enum to its word, the registry section name.
 * Unset resolves to stigmer — this edition's platform default harness (the
 * edition-honest posture: each edition judges pins against the harness ITS
 * runs would actually use; the cloud edition resolves its own configured
 * default).
 *
 * Every engine has its own section, so a pin is never judged against
 * another engine's catalog. A registry that lacks an engine's section
 * judges every pin on it unverifiable (the no-section posture below). A
 * number no engine owns is its own word, so it matches no section either,
 * and the offered-engine rule names it (domain/session/harness.ts).
 */
export function harnessName(h: Harness): string {
  switch (h) {
    case Harness.CLAUDE:
    case Harness.STIGMER:
      return HARNESS_WORDS[h];
    case Harness.UNSPECIFIED:
      return HARNESS_WORDS[Harness.STIGMER];
    default: {
      const unknown: never = h;
      return `harness-${String(unknown)}`;
    }
  }
}

/**
 * The harness a word names, or undefined for a string that names none (a
 * typo, or a word this build does not know). The inverse of
 * {@link HARNESS_WORDS}; unspecified has no word, so it is never returned.
 */
export function harnessOfWord(word: string): Exclude<Harness, Harness.UNSPECIFIED> | undefined {
  return HARNESS_OF_WORD.get(word);
}

// Object keys are strings; each is a key of HARNESS_WORDS, so the number is a
// harness the table names.
const HARNESS_OF_WORD: ReadonlyMap<string, Exclude<Harness, Harness.UNSPECIFIED>> = new Map(
  Object.entries(HARNESS_WORDS).map(([harness, word]) => [
    word,
    Number(harness) as Exclude<Harness, Harness.UNSPECIFIED>,
  ]),
);

/**
 * This edition's one statement of the write-time model-pin EXISTENCE rule
 * (oss#774): a pinned model_name that is not in the model registry is
 * refused at apply/update, with a did-you-mean. Before this rule,
 * model_name was the one profile knob that failed OPEN — a typo'd pin
 * passed every write boundary and silently ran on a model nobody chose.
 *
 * `harness` names the registry section the pin's runs would use
 * (harnessName of the surface's effective harness). Pass "" for surfaces
 * with NO serving harness in this edition (Slack and WhatsApp channels — this edition
 * stores their spec without a serving runtime): the pin then validates
 * against EVERY harness section and is refused only when no section knows
 * it, which catches the typo class without falsely refusing a model that
 * is valid where the spec will actually serve.
 *
 * Deliberately WRITE-TIME ONLY — unlike the pin-PRESENCE rule, this is NOT
 * evaluated at the run starter's fire-time backstop: upstream registry
 * drift must never break a previously-valid schedule at its 3 AM fire.
 *
 * An explicit `openai:<name>` or `anthropic:<name>` reference passes on the
 * native harness (and on "", any harness) without a registry entry: it names
 * a model the organization serves on its own endpoint, which the runner
 * routes by the prefix and no catalog lists. The Claude harness runs only
 * catalog models, so the form is judged like any other name there.
 *
 * Degrades to a no-op ("") when the registry is empty or lacks the harness
 * section — a build without a usable registry must not refuse every write
 * (the hasAnyModels posture).
 *
 * Returns the refusal copy, or "" when the pin is valid (or unverifiable).
 */
export function unknownModelPinRefusal(
  store: ModelCatalogProvider,
  fieldPath: string,
  harness: string,
  model: string,
): string {
  model = model.trim();
  if (model === "") {
    return "";
  }

  if (
    (harness === "" || harness === HARNESS_WORDS[Harness.STIGMER]) &&
    explicitProvider(model) !== undefined
  ) {
    return "";
  }

  if (!store.hasAnyModels()) {
    return "";
  }

  let candidates: string[];
  if (harness === "") {
    if (store.isValidModelOnAnyHarness(model)) {
      return "";
    }
    candidates = store.canonicalModelsAcrossHarnesses();
  } else {
    if (!store.hasHarness(harness)) {
      return "";
    }
    if (store.isValidModel(harness, model)) {
      return "";
    }
    candidates = store.canonicalModels(harness);
  }

  const scope = harness === "" ? "any harness" : `${harness} harness`;
  let msg = `${fieldPath}: model '${model}' is not in the model registry (${scope})`;

  const suggestions = suggestSimilarModels(model, candidates);
  if (suggestions.length > 0) {
    const quoted = suggestions.map((s) => `'${s}'`);
    msg += `; did you mean ${quoted.join(", ")}?`;
  }

  return msg;
}

/**
 * Returns up to three model ids from the candidate list sorted by
 * Levenshtein distance to the target, closest first (name-ascending on
 * ties). Only candidates within the edit-distance cap are included — a
 * far-off typo gets no misleading suggestion. Shared by every
 * pin-existence check so every did-you-mean behaves identically.
 */
export function suggestSimilarModels(
  target: string,
  candidates: string[],
): string[] {
  const targetLower = target.toLowerCase();
  const matches: Array<{ name: string; dist: number }> = [];

  for (const name of candidates) {
    const d = suggestionEditDistance(targetLower, name.toLowerCase());
    if (d <= MAX_MODEL_EDIT_DISTANCE) {
      matches.push({ name, dist: d });
    }
  }

  matches.sort((a, b) => {
    if (a.dist !== b.dist) {
      return a.dist - b.dist;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return matches.slice(0, MAX_MODEL_SUGGESTIONS).map((m) => m.name);
}

/**
 * The standard two-row Levenshtein distance. Go compares bytes; this
 * compares UTF-16 code units — identical for the ASCII model ids the
 * registry carries.
 */
function suggestionEditDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let prev: number[] = new Array<number>(b.length + 1);
  let curr: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}
