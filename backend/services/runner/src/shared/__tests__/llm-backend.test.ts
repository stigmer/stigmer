import { describe, it, expect } from "vitest";

import {
  toVertexModelId,
  toBedrockModelId,
  parseAnthropicBackend,
  parseOpenAiBackend,
  parseBedrockModelMap,
  resolveAnthropicBackend,
  checkVertexPrerequisites,
  checkBedrockPrerequisites,
  checkDirectCredentials,
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
    ["bedrock", "bedrock"],
    ["  Bedrock ", "bedrock"],
  ])("value %j parses to %s", (value, backend) => {
    const result = parseAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: value });
    expect(result).toEqual({ ok: true, backend });
  });

  it("rejects an unknown value naming the var, the value, and the supported set", () => {
    const result = parseAnthropicBackend({ STIGMER_ANTHROPIC_BACKEND: "verteks" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('STIGMER_ANTHROPIC_BACKEND="verteks"');
      expect(result.message).toContain("Supported: public, vertex, bedrock");
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

describe("checkBedrockPrerequisites", () => {
  it("passes with an explicit AWS_REGION", () => {
    expect(checkBedrockPrerequisites({ AWS_REGION: "ap-south-1" })).toBeNull();
  });

  it.each([[undefined], [""], ["   "]])(
    "fails when region is %j — the SDK's us-east-1 default must never apply silently",
    (region) => {
      const message = checkBedrockPrerequisites({ AWS_REGION: region });
      expect(message).toContain("AWS_REGION");
      expect(message).toContain("us-east-1");
      expect(message).toContain("docs.stigmer.ai");
    },
  );

  it("fails on a malformed model map at boot, not at the first model call", () => {
    const message = checkBedrockPrerequisites({
      AWS_REGION: "ap-south-1",
      STIGMER_BEDROCK_MODEL_MAP: "claude-sonnet-4-6",
    });
    expect(message).toContain("STIGMER_BEDROCK_MODEL_MAP");
    expect(message).toContain("canonical=bedrockId");
  });

  it("accepts a well-formed model map", () => {
    expect(
      checkBedrockPrerequisites({
        AWS_REGION: "eu-central-1",
        STIGMER_BEDROCK_MODEL_MAP:
          "claude-sonnet-4-6=eu.anthropic.claude-sonnet-4-6-v1:0, claude-fable-5=eu.anthropic.claude-fable-5-v1:0",
      }),
    ).toBeNull();
  });
});

describe("parseBedrockModelMap", () => {
  it("parses unset / blank to an empty map", () => {
    for (const value of [undefined, "", "   "]) {
      const result = parseBedrockModelMap({ STIGMER_BEDROCK_MODEL_MAP: value });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.map.size).toBe(0);
    }
  });

  it("parses comma-separated pairs, trimming whitespace and skipping empty entries", () => {
    const result = parseBedrockModelMap({
      STIGMER_BEDROCK_MODEL_MAP:
        " claude-sonnet-4-6 = us.anthropic.claude-sonnet-4-6-v1:0 ,, claude-fable-5=global.anthropic.claude-fable-5-v1:0 ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map.get("claude-sonnet-4-6")).toBe("us.anthropic.claude-sonnet-4-6-v1:0");
      expect(result.map.get("claude-fable-5")).toBe("global.anthropic.claude-fable-5-v1:0");
    }
  });

  it.each([["no-equals-sign"], ["=missing-canonical"], ["missing-id="]])(
    "rejects malformed entry %j naming the entry and the expected form",
    (entry) => {
      const result = parseBedrockModelMap({ STIGMER_BEDROCK_MODEL_MAP: entry });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain(entry);
        expect(result.message).toContain("canonical=bedrockId");
      }
    },
  );
});

describe("toBedrockModelId", () => {
  // Layer 3 alone: the deterministic rule, verified against AWS's model
  // catalog for the registry's dated ids (the model card lists
  // anthropic.claude-sonnet-4-5-20250929-v1:0 for claude-sonnet-4-5).
  it.each([
    ["claude-sonnet-4-5-20250929", "anthropic.claude-sonnet-4-5-20250929-v1:0"],
    ["claude-haiku-4-5-20251001", "anthropic.claude-haiku-4-5-20251001-v1:0"],
    ["claude-opus-4-5-20251101", "anthropic.claude-opus-4-5-20251101-v1:0"],
    ["claude-sonnet-4-6", "anthropic.claude-sonnet-4-6-v1:0"],
    ["claude-fable-5", "anthropic.claude-fable-5-v1:0"],
  ])("derives %s -> %s with no prefix or map", (canonical, bedrockId) => {
    expect(toBedrockModelId(canonical, {})).toBe(bedrockId);
  });

  // Layer 2: the geography prefix is a deployment decision — never
  // defaulted (a missing prefix yields the bare id; AWS's inference-profile
  // rejection is classified with the remedy in model-error.ts).
  it.each([
    ["us", "us.anthropic.claude-sonnet-4-6-v1:0"],
    ["eu", "eu.anthropic.claude-sonnet-4-6-v1:0"],
    ["global", "global.anthropic.claude-sonnet-4-6-v1:0"],
    // Lenient on a trailing dot — "us." and "us" both read as intent.
    ["us.", "us.anthropic.claude-sonnet-4-6-v1:0"],
    ["  jp  ", "jp.anthropic.claude-sonnet-4-6-v1:0"],
  ])("applies inference prefix %j", (prefix, expected) => {
    expect(
      toBedrockModelId("claude-sonnet-4-6", { STIGMER_BEDROCK_INFERENCE_PREFIX: prefix }),
    ).toBe(expected);
  });

  it("consults the operator map FIRST, bypassing both prefix and rule", () => {
    expect(
      toBedrockModelId("claude-sonnet-4-6", {
        STIGMER_BEDROCK_MODEL_MAP: "claude-sonnet-4-6=arn:aws:bedrock:eu-central-1:123:inference-profile/custom",
        STIGMER_BEDROCK_INFERENCE_PREFIX: "us",
      }),
    ).toBe("arn:aws:bedrock:eu-central-1:123:inference-profile/custom");
  });

  it("applies prefix and rule to models the map does not cover", () => {
    expect(
      toBedrockModelId("claude-fable-5", {
        STIGMER_BEDROCK_MODEL_MAP: "claude-sonnet-4-6=us.anthropic.claude-sonnet-4-6-v1:0",
        STIGMER_BEDROCK_INFERENCE_PREFIX: "us",
      }),
    ).toBe("us.anthropic.claude-fable-5-v1:0");
  });

  it("throws the catalog message on a malformed map (defense in depth)", () => {
    expect(() => toBedrockModelId("claude-sonnet-4-6", { STIGMER_BEDROCK_MODEL_MAP: "broken" }))
      .toThrow(/STIGMER_BEDROCK_MODEL_MAP entry "broken"/);
  });
});

describe("checkDirectCredentials", () => {
  describe("anthropic", () => {
    it("is satisfied by a non-blank ANTHROPIC_API_KEY", () => {
      expect(checkDirectCredentials("anthropic", { ANTHROPIC_API_KEY: "sk-ant-x" })).toBeNull();
    });

    it.each([[undefined], [""], ["   "]])(
      "treats key %j as missing on the public backend",
      (key) => {
        const message = checkDirectCredentials("anthropic", { ANTHROPIC_API_KEY: key });
        expect(message).toContain("ANTHROPIC_API_KEY");
        expect(message).toContain("STIGMER_ANTHROPIC_BACKEND=vertex");
        expect(message).toContain("docs.stigmer.ai");
      },
    );

    it("is satisfied by the vertex backend with no key (ADC authenticates)", () => {
      // The finding-4 pin: a correctly-configured Vertex deployment holds no
      // Anthropic API key, and must not be reported as credential-less.
      expect(
        checkDirectCredentials("anthropic", { STIGMER_ANTHROPIC_BACKEND: "vertex" }),
      ).toBeNull();
    });

    it("is satisfied by the bedrock backend with no key (AWS chain authenticates)", () => {
      // Covered by the same non-public test that covered vertex — pinned
      // separately so the bedrock adapter's credential story stays locked.
      expect(
        checkDirectCredentials("anthropic", { STIGMER_ANTHROPIC_BACKEND: "bedrock" }),
      ).toBeNull();
    });

    it("names both shipped backends in the missing-key remedy", () => {
      const message = checkDirectCredentials("anthropic", {});
      expect(message).toContain("vertex or bedrock");
    });

    it("defers an invalid backend value to construction (one message per condition)", () => {
      // resolveAnthropicBackend owns the catalog message for invalid values;
      // reporting "missing credentials" here would mask it.
      expect(
        checkDirectCredentials("anthropic", { STIGMER_ANTHROPIC_BACKEND: "verteks" }),
      ).toBeNull();
    });
  });

  describe("openai", () => {
    it("is satisfied by a non-blank OPENAI_API_KEY", () => {
      expect(checkDirectCredentials("openai", { OPENAI_API_KEY: "sk-x" })).toBeNull();
    });

    it.each([[undefined], [""], ["   "]])(
      "treats key %j as missing",
      (key) => {
        const message = checkDirectCredentials("openai", { OPENAI_API_KEY: key });
        expect(message).toContain("OPENAI_API_KEY");
        expect(message).toContain("docs.stigmer.ai");
      },
    );

    it("offers no backend remedy while azure is unshipped", () => {
      // STIGMER_OPENAI_BACKEND=azure would fail with "not implemented in
      // this build" — an error message must not suggest a broken remedy.
      const message = checkDirectCredentials("openai", {});
      expect(message).not.toContain("STIGMER_OPENAI_BACKEND");
    });

    it("ignores the anthropic key and backend when checking openai", () => {
      const message = checkDirectCredentials("openai", {
        ANTHROPIC_API_KEY: "sk-ant-x",
        STIGMER_ANTHROPIC_BACKEND: "vertex",
      });
      expect(message).toContain("OPENAI_API_KEY");
    });
  });
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

  it("is clean for a fully-configured bedrock deployment", () => {
    const result = preflightLlmBackends({
      STIGMER_ANTHROPIC_BACKEND: "bedrock",
      AWS_REGION: "ap-south-1",
    });
    expect(result).toEqual({ error: null, warnings: [] });
  });

  it("fails bedrock without a region, naming AWS_REGION", () => {
    const result = preflightLlmBackends({ STIGMER_ANTHROPIC_BACKEND: "bedrock" });
    expect(result.error).toContain("AWS_REGION");
  });

  it("fails bedrock with a malformed model map at boot", () => {
    const result = preflightLlmBackends({
      STIGMER_ANTHROPIC_BACKEND: "bedrock",
      AWS_REGION: "ap-south-1",
      STIGMER_BEDROCK_MODEL_MAP: "not-a-pair",
    });
    expect(result.error).toContain("STIGMER_BEDROCK_MODEL_MAP");
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
