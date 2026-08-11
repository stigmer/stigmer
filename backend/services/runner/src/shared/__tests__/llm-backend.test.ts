import { describe, it, expect } from "vitest";

import { toVertexModelId } from "../llm-backend.js";

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
