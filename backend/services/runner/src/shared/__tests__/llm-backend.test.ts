import { describe, it, expect } from "vitest";

import {
  toVertexModelId,
  parseAnthropicBackend,
  parseOpenAiBackend,
  resolveAnthropicBackend,
  checkVertexPrerequisites,
  preflightLlmBackends,
} from "../llm-backend.js";

describe("toVertexModelId", () => {
  // Both id shapes below are what the registry actually serves (see
  // stigmer-server registry/data/model-registry.json): pre-4.6 models are
  // dated, 4.6-generation and later are dateless canonical ids.
  it.each([
    // Pre-4.6 snapshot ids: the trailing date separator becomes `@`.
    ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5@20250929"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5@20251001"],
    ["claude-opus-4-5-20251101", "claude-opus-4-5@20251101"],

    // 4.6-generation and later: dateless ids are canonical on Vertex and
    // MUST pass through untouched. Appending a date 404s (the bug Dify
    // langgenius/dify-official-plugins#2905 and Roo-Code #11625 shipped).
    ["claude-sonnet-4-6", "claude-sonnet-4-6"],
    ["claude-opus-4-6", "claude-opus-4-6"],
    ["claude-opus-4-7", "claude-opus-4-7"],
    ["claude-opus-4-8", "claude-opus-4-8"],
    ["claude-sonnet-5", "claude-sonnet-5"],
    ["claude-fable-5", "claude-fable-5"],

    // Already in Vertex form: translating twice is a no-op.
    ["claude-sonnet-4-5@20250929", "claude-sonnet-4-5@20250929"],

    // Bedrock-shaped ids never match the trailing-date pattern.
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "anthropic.claude-sonnet-4-5-20250929-v1:0"],

    // Version segments are not dates; nothing to rewrite.
    ["claude-3-5-sonnet", "claude-3-5-sonnet"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(toVertexModelId(input)).toBe(expected);
  });
});

// Every function takes env as a parameter (defaulting to process.env), so
// these tables pass explicit records instead of stubbing globals.

describe("parseAnthropicBackend", () => {
  it.each([
    // Unset / blank → the public API, the zero-config default.
    [undefined, "public"],
    ["", "public"],
    ["   ", "public"],
    // Explicit values, normalized for casing and whitespace.
    ["public", "public"],
    ["vertex", "vertex"],
    ["Vertex", "vertex"],
    ["  VERTEX  ", "vertex"],
  ])("value %j parses to %s", (value, backend) => {
    const result = parseAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: value });
    expect(result).toEqual({ ok: true, backend });
  });

  it("rejects bedrock as recognized but not implemented, never a silent public fallback", () => {
    const result = parseAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: "bedrock" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("STIGMER_ANTHROPIC_BACKEND");
      expect(result.message).toContain("not implemented in this build");
      expect(result.message).toContain("public, vertex");
    }
  });

  it("rejects an unknown value naming the var, the value, and the supported set", () => {
    const result = parseAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: "verteks" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('STIGMER_ANTHROPIC_BACKEND="verteks"');
      expect(result.message).toContain("Supported: public, vertex");
    }
  });
});

describe("parseOpenAiBackend", () => {
  it.each([[undefined], [""], ["public"], ["PUBLIC"]])(
    "value %j parses to public",
    (value) => {
      const result = parseOpenAiBackend({ STIGMER_OPENAI_BACKEND: value });
      expect(result).toEqual({ ok: true, backend: "public" });
    },
  );

  it("rejects azure as recognized but not implemented", () => {
    const result = parseOpenAiBackend({ STIGMER_OPENAI_BACKEND: "azure" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("STIGMER_OPENAI_BACKEND");
      expect(result.message).toContain("not implemented in this build");
    }
  });

  it("rejects a wrong-provider value (vertex is an Anthropic backend)", () => {
    const result = parseOpenAiBackend({ STIGMER_OPENAI_BACKEND: "vertex" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('STIGMER_OPENAI_BACKEND="vertex"');
      expect(result.message).toContain("Supported: public");
    }
  });
});

describe("resolveAnthropicBackend", () => {
  it("returns the parsed backend for valid values", () => {
    expect(resolveAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: "vertex" })).toBe("vertex");
    expect(resolveAnthropicBackend({})).toBe("public");
  });

  it("throws the parser's exact message on an invalid value", () => {
    expect(() => resolveAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: "verteks" }))
      .toThrow(/STIGMER_ANTHROPIC_BACKEND="verteks" is not a supported backend/);
  });
});

describe("checkVertexPrerequisites", () => {
  it("passes when CLOUD_ML_REGION is set", () => {
    expect(checkVertexPrerequisites({ CLOUD_ML_REGION: "asia-south1" })).toBeNull();
    expect(checkVertexPrerequisites({ CLOUD_ML_REGION: "global" })).toBeNull();
  });

  it.each([[undefined], [""], ["   "]])(
    "fails with an actionable message when region is %j",
    (region) => {
      const message = checkVertexPrerequisites({ CLOUD_ML_REGION: region });
      expect(message).toContain("CLOUD_ML_REGION");
      expect(message).toContain("asia-south1");
    },
  );
});

describe("preflightLlmBackends", () => {
  it("is clean for an unconfigured deployment (today's default)", () => {
    expect(preflightLlmBackends({})).toEqual({ error: null, warnings: [] });
  });

  it("is clean for a fully-configured vertex deployment", () => {
    const result = preflightLlmBackends({
      STIGMER_ANTHROPIC_BACKEND: "vertex",
      CLOUD_ML_REGION: "asia-south1",
    });
    expect(result).toEqual({ error: null, warnings: [] });
  });

  it("fails vertex without a region, naming CLOUD_ML_REGION", () => {
    const result = preflightLlmBackends({ STIGMER_ANTHROPIC_BACKEND: "vertex" });
    expect(result.error).toContain("CLOUD_ML_REGION");
  });

  it("fails on invalid values for either var, reporting all problems at once", () => {
    const result = preflightLlmBackends({
      STIGMER_ANTHROPIC_BACKEND: "verteks",
      STIGMER_OPENAI_BACKEND: "azure",
    });
    expect(result.error).toContain("STIGMER_ANTHROPIC_BACKEND");
    expect(result.error).toContain("STIGMER_OPENAI_BACKEND");
  });

  it("downgrades backend vars to a warning when the proxy is set (proxy owns routing)", () => {
    const result = preflightLlmBackends({
      STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai",
      STIGMER_ANTHROPIC_BACKEND: "vertex",
    });
    expect(result.error).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("STIGMER_ANTHROPIC_BACKEND=vertex is ignored");
  });

  it("does not warn under the proxy for unset or explicit-public backend vars", () => {
    const result = preflightLlmBackends({
      STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai",
      STIGMER_OPENAI_BACKEND: "public",
    });
    expect(result).toEqual({ error: null, warnings: [] });
  });

  it("does not fail an invalid-but-inert value under the proxy, but still surfaces it", () => {
    // A proxied fleet must not crash-loop over a var the proxy makes inert;
    // non-silence is preserved through the warning.
    const result = preflightLlmBackends({
      STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai",
      STIGMER_ANTHROPIC_BACKEND: "verteks",
    });
    expect(result.error).toBeNull();
    expect(result.warnings[0]).toContain("STIGMER_ANTHROPIC_BACKEND=verteks is ignored");
  });
});
