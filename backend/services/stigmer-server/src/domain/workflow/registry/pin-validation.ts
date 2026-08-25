/**
 * Model-pin existence validation and did-you-mean machinery — ports
 * pkg/domain/workflow/registry/pin_validation.go. Lives beside the store it
 * queries (the registry is the shared validation authority): workflow model
 * validation consumes it now; the schedule (#22) and agentchannel (#12)
 * pin-existence checks and agentexecution's tier/thinking validators (#17)
 * consume the same functions later, so every pin error suggests
 * identically.
 *
 * One deliberate signature delta from Go: Go's UnknownModelPinRefusal reads
 * the process-global registry.Store(); this edition has no singletons (the
 * composition root owns the store), so the store is the first parameter.
 */
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { ModelRegistryStore } from "./model-registry-store.js";

/**
 * Harness section names as the registry document spells them. Exported so
 * every consumer (workflow validation, schedule/channel pin validation)
 * shares one vocabulary instead of re-declaring string literals.
 */
export const HARNESS_NAME_CURSOR = "cursor";
export const HARNESS_NAME_NATIVE = "native";

const MAX_MODEL_SUGGESTIONS = 3;
const MAX_MODEL_EDIT_DISTANCE = 5;

/**
 * Maps the session harness enum to its registry section name. Unset
 * resolves to native — this edition's platform default harness (the DD-015
 * edition-honest posture: each edition judges pins against the harness ITS
 * runs would actually use; the cloud edition resolves its own configured
 * default).
 */
export function harnessName(h: Harness): string {
  if (h === Harness.CURSOR) {
    return HARNESS_NAME_CURSOR;
  }
  return HARNESS_NAME_NATIVE;
}

/**
 * This edition's one statement of the write-time model-pin EXISTENCE rule
 * (oss#774): a pinned model_name that is not in the model registry is
 * refused at apply/update, with a did-you-mean. Before this rule,
 * model_name was the one profile knob that failed OPEN — a typo'd pin
 * passed every write boundary and the cursor runner silently fell back to
 * "default" (Auto), billing at Auto rates.
 *
 * `harness` names the registry section the pin's runs would use
 * (harnessName of the surface's effective harness). Pass "" for surfaces
 * with NO serving harness in this edition (agent channels — this edition
 * stores their spec without a serving runtime): the pin then validates
 * against EVERY harness section and is refused only when no section knows
 * it, which catches the typo class without falsely refusing a model that
 * is valid where the spec will actually serve.
 *
 * Deliberately WRITE-TIME ONLY — unlike the pin-PRESENCE rule, this is NOT
 * evaluated at the run starter's fire-time backstop: upstream registry
 * drift must never break a previously-valid schedule at its 3 AM fire.
 *
 * Degrades to a no-op ("") when the registry is empty or lacks the harness
 * section — a build without a usable registry must not refuse every write
 * (the hasAnyModels posture workflow validation established).
 *
 * Returns the refusal copy, or "" when the pin is valid (or unverifiable).
 */
export function unknownModelPinRefusal(
  store: ModelRegistryStore,
  fieldPath: string,
  harness: string,
  model: string,
): string {
  model = model.trim();
  if (model === "") {
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
 * far-off typo gets no misleading suggestion. Shared by workflow model
 * validation and the pin-existence rule so every did-you-mean behaves
 * identically.
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
