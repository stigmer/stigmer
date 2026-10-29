/**
 * A Stigmer-harness model's context window: how many input tokens it takes, which
 * the turn's summarizer compacts the conversation at a fraction of
 * (`middleware/compaction.ts`, deepagents' own fractions).
 *
 * Three sources, in order, the first that states a window wins:
 *
 *  1. The model library's profile (`profile.maxInputTokens`): the built
 *     model's own, read on every call, and when it states none, the
 *     library's profile for the FIRST-PARTY API id the model was resolved
 *     from. LangChain keys its table by the exact id a model is built with,
 *     so a model built under a provider's rewritten id (Vertex's `@` form of
 *     a dated id, Bedrock's `anthropic.` ids, Foundry's deployment names)
 *     misses on its own profile, and deepagents used to fall back to its
 *     fixed 170,000-token trigger for a model that takes a million.
 *  2. The registry row's `contextWindowTokens` (`model-registry.ts`): for a
 *     model the catalog lists before the library does, or an operator's own
 *     endpoint given a row.
 *  3. None: deepagents' own fallback settings apply, as they always did.
 *
 * The turn's model builder records, by the model instance, what the window
 * is resolved from ({@link recordModelWindow}), and the compaction middleware
 * reads it from the request's model ({@link windowOf}), as the span
 * middleware reads `model-facts.ts`: the parent's graph and every
 * sub-agent's each get their own model's window with no per-stack setting.
 * A model the runner did not build (a test double) answers its own profile.
 *
 * The library comes before the catalog because the catalog is synced from
 * the public registry, never edited here, and has stated 200,000 for models
 * the provider serves with a million; the library has been right for every
 * first-party Claude id it lists. One line per model and turn says which
 * source answered and where the summarizer will trigger, and a disagreement
 * between library and catalog is said once per process.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelProfile } from "@langchain/core/language_models/profile";
import { computeSummarizationDefaults } from "deepagents";

import type { LlmProvider } from "./llm-proxy.js";

/** Which source stated a window. */
export type ModelWindowSource = "library" | "catalog" | "fallback";

export interface ModelWindow {
  /** The input tokens the model takes; `undefined` when no source states it. */
  readonly tokens: number | undefined;
  readonly source: ModelWindowSource;
}

/** What a window is resolved from: the model as built, the first-party id it was resolved from, and its registry row's window. */
export interface ModelWindowInput {
  readonly model: Pick<BaseChatModel, "profile">;
  readonly provider: LlmProvider;
  readonly apiModelId: string;
  readonly catalogTokens: number | undefined;
}

/** The library's window for a first-party id, by provider and id; `null` when its table has none. Pure field assignment, memoized. */
const LIBRARY_WINDOWS = new Map<string, number | null>();

/** What each built model's window is resolved from, by the model instance. */
const WINDOW_FACTS = new WeakMap<object, Omit<ModelWindowInput, "model">>();

/** Model names whose library and catalog windows disagree, already said. */
const DISAGREEMENTS_SAID = new Set<string>();

function maxInputTokensOf(profile: ModelProfile | undefined): number | undefined {
  const tokens = profile?.maxInputTokens;
  return typeof tokens === "number" && Number.isInteger(tokens) && tokens > 0 ? tokens : undefined;
}

/**
 * The library's profile for a first-party id, through a throwaway client
 * (no I/O; the key is never used), the way `model-client.ts` probes the
 * library's output ceiling for Bedrock.
 */
function libraryWindowOf(provider: LlmProvider, apiModelId: string): number | undefined {
  const key = `${provider}:${apiModelId}`;
  if (!LIBRARY_WINDOWS.has(key)) {
    const probe = provider === "openai"
      ? new ChatOpenAI({ model: apiModelId, apiKey: "window-probe" })
      : new ChatAnthropic({ model: apiModelId, apiKey: "window-probe" });
    LIBRARY_WINDOWS.set(key, maxInputTokensOf(probe.profile) ?? null);
  }
  return LIBRARY_WINDOWS.get(key) ?? undefined;
}

/** The model's window from the first source that states one (the module header). */
export function resolveModelWindow(input: ModelWindowInput): ModelWindow {
  const library = maxInputTokensOf(input.model.profile) ?? libraryWindowOf(input.provider, input.apiModelId);
  if (library !== undefined) return { tokens: library, source: "library" };
  if (input.catalogTokens !== undefined) return { tokens: input.catalogTokens, source: "catalog" };
  return { tokens: undefined, source: "fallback" };
}

/** Record what `model`'s window is resolved from; the turn's model builder calls it for each model it builds. */
export function recordModelWindow(model: BaseChatModel, facts: Omit<ModelWindowInput, "model">): void {
  WINDOW_FACTS.set(model, facts);
}

/** The window of a request's model: resolved from what was recorded for it, else its own profile; `undefined` when neither states one. */
export function windowOf(model: unknown): number | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const own = model as Pick<BaseChatModel, "profile">;
  const facts = WINDOW_FACTS.get(model);
  return facts === undefined ? maxInputTokensOf(own.profile) : resolveModelWindow({ model: own, ...facts }).tokens;
}

/** Where deepagents' summarizer triggers for a window: its own defaults, read rather than copied (it reads only `profile`). */
export function compactionTrigger(tokens: number | undefined): string {
  const profiled = { profile: tokens === undefined ? {} : { maxInputTokens: tokens } } as Pick<BaseChatModel, "profile">;
  const { trigger } = computeSummarizationDefaults(profiled as BaseChatModel);
  if (trigger.type === "fraction" && tokens !== undefined) return String(Math.floor(tokens * trigger.value));
  return `${trigger.value} ${trigger.type}`;
}

/** The turn's one line for a model's window, and once per process the note that library and catalog disagree. */
export function windowLogLines(modelName: string, input: ModelWindowInput): string[] {
  const window = resolveModelWindow(input);
  const lines = [
    `[compaction] model=${modelName} window=${window.tokens ?? "none"} source=${window.source} trigger=${compactionTrigger(window.tokens)}`,
  ];
  if (window.source === "library" && input.catalogTokens !== undefined && input.catalogTokens !== window.tokens && !DISAGREEMENTS_SAID.has(modelName)) {
    DISAGREEMENTS_SAID.add(modelName);
    lines.push(`[compaction] model=${modelName}: the catalog states a window of ${input.catalogTokens}, the model library ${window.tokens}; the library's is used`);
  }
  return lines;
}
