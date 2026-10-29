/**
 * The window a Stigmer-harness model's summarizer is sized by (`model-window.ts`):
 * the model library's profile, on the model as built and then on the
 * first-party id; the registry row's window; else deepagents' fallback.
 *
 * The rows are the OSS bundle's Stigmer-harness Claude rows
 * (`backend/services/stigmer-server/src/modelcatalog/data/model-registry.json`),
 * copied as fixtures: the runner's tests cite the bundle and never read it.
 * Each row's real window was read from Anthropic's Models API
 * (`max_input_tokens`) on 2026-10-23. Two disagreements are pinned on
 * purpose: the bundle states 200,000 for Sonnet 4.6 and Opus 4.6, which take
 * a million, and the library states a million for Sonnet 4.5, which takes
 * 200,000 without the long-context beta the runner does not send. The
 * library wins both (the module header); Sonnet 4.5's overflow is caught by
 * deepagents' emergency summarization at the cost of one refused call.
 */

import { describe, expect, it } from "vitest";

import { compactionTrigger, recordModelWindow, resolveModelWindow, windowLogLines, windowOf, type ModelWindowInput } from "../model-window.js";

/** A model as built: its own profile, which a provider's rewritten id leaves empty. */
function built(maxInputTokens?: number): ModelWindowInput["model"] {
  return { profile: maxInputTokens === undefined ? {} : { maxInputTokens } };
}

/** The bundle's Stigmer-harness Claude rows: API id, the row's window, and the window the library resolves. */
const BUNDLE_ROWS: ReadonlyArray<{ apiModelId: string; catalog: number; library: number }> = [
  { apiModelId: "claude-fable-5", catalog: 1_000_000, library: 1_000_000 },
  { apiModelId: "claude-haiku-4-5-20251001", catalog: 200_000, library: 200_000 },
  { apiModelId: "claude-opus-4-5-20251101", catalog: 200_000, library: 200_000 },
  { apiModelId: "claude-opus-4-6", catalog: 200_000, library: 1_000_000 },
  { apiModelId: "claude-opus-4-7", catalog: 1_000_000, library: 1_000_000 },
  { apiModelId: "claude-opus-4-8", catalog: 1_000_000, library: 1_000_000 },
  { apiModelId: "claude-sonnet-4-5-20250929", catalog: 200_000, library: 1_000_000 },
  { apiModelId: "claude-sonnet-4-6", catalog: 200_000, library: 1_000_000 },
  { apiModelId: "claude-sonnet-5", catalog: 1_000_000, library: 1_000_000 },
];

describe("resolveModelWindow", () => {
  it.each(BUNDLE_ROWS)("resolves $apiModelId from the library on its first-party id", ({ apiModelId, catalog, library }) => {
    expect(resolveModelWindow({ model: built(), provider: "anthropic", apiModelId, catalogTokens: catalog })).toEqual({ tokens: library, source: "library" });
  });

  it("reads the model's own profile first, live, as a test double sizes it", () => {
    const sized = { tokens: 4_000 };
    const model = { get profile() { return { maxInputTokens: sized.tokens }; } };
    const input = { model, provider: "anthropic" as const, apiModelId: "claude-haiku-4.5", catalogTokens: 200_000 };
    expect(resolveModelWindow(input)).toEqual({ tokens: 4_000, source: "library" });
    sized.tokens = 6_000;
    expect(resolveModelWindow(input).tokens).toBe(6_000);
  });

  it("sizes a provider-rewritten id by the first-party id it was resolved from (Vertex's @ form, Bedrock's prefix)", () => {
    // The model as built under `claude-haiku-4-5@20251001` or `anthropic.claude-…-v1:0` has an empty profile.
    expect(resolveModelWindow({ model: built(), provider: "anthropic", apiModelId: "claude-haiku-4-5-20251001", catalogTokens: undefined })).toEqual({ tokens: 200_000, source: "library" });
    expect(resolveModelWindow({ model: built(), provider: "anthropic", apiModelId: "claude-sonnet-4-6", catalogTokens: undefined })).toEqual({ tokens: 1_000_000, source: "library" });
  });

  it("takes the catalog's window for a model the library does not list", () => {
    expect(resolveModelWindow({ model: built(), provider: "anthropic", apiModelId: "claude-next-unlisted", catalogTokens: 500_000 })).toEqual({ tokens: 500_000, source: "catalog" });
  });

  it("says fallback when neither source knows the model", () => {
    expect(resolveModelWindow({ model: built(), provider: "anthropic", apiModelId: "claude-next-unlisted", catalogTokens: undefined })).toEqual({ tokens: undefined, source: "fallback" });
    expect(resolveModelWindow({ model: built(), provider: "openai", apiModelId: "own-endpoint-model", catalogTokens: undefined }).source).toBe("fallback");
  });
});

describe("windowOf, the window a request's model carries", () => {
  it("resolves what was recorded for a built model, answers an unbuilt model's own profile, and nothing for a model named by a string", () => {
    const rewritten = built();
    recordModelWindow(rewritten as never, { provider: "anthropic", apiModelId: "claude-sonnet-4-6", catalogTokens: 200_000 });
    expect(windowOf(rewritten)).toBe(1_000_000);
    expect(windowOf(built(4_000))).toBe(4_000);
    expect(windowOf(built())).toBeUndefined();
    expect(windowOf("claude-haiku-4.5")).toBeUndefined();
  });
});

describe("the turn's window line", () => {
  it("names the window, its source and deepagents' own trigger", () => {
    expect(compactionTrigger(1_000_000)).toBe("850000");
    expect(compactionTrigger(undefined)).toBe("170000 tokens");
    expect(windowLogLines("claude-haiku-4.5", { model: built(), provider: "anthropic", apiModelId: "claude-haiku-4-5-20251001", catalogTokens: 200_000 })).toEqual([
      "[compaction] model=claude-haiku-4.5 window=200000 source=library trigger=170000",
    ]);
  });

  it("says once per process when library and catalog disagree", () => {
    const input = { model: built(), provider: "anthropic" as const, apiModelId: "claude-opus-4-6", catalogTokens: 200_000 };
    const first = windowLogLines("claude-opus-4.6", input);
    expect(first).toHaveLength(2);
    expect(first[1]).toBe("[compaction] model=claude-opus-4.6: the catalog states a window of 200000, the model library 1000000; the library's is used");
    expect(windowLogLines("claude-opus-4.6", input)).toHaveLength(1);
  });
});
