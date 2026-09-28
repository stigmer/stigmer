/**
 * The native thinking mapping, enumerated: every effective mode against
 * every form a native registry row can declare, including the tri-state
 * `required` flag. The table is the contract the wire, the `think` tool and
 * the structured-output strategy all read, so it is pinned whole.
 */

import { describe, expect, it } from "vitest";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  BUDGET_THINKING_TOKENS,
  graphThinks,
  resolveEffectiveThinkingMode,
  toAnthropicThinking,
  type EffectiveThinkingMode,
} from "../thinking-mode.js";
import type { NativeThinkingProfile } from "../model-registry.js";

const ADAPTIVE = { type: "adaptive", display: "summarized" } as const;
const BUDGET = { type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS } as const;
const DISABLED = { type: "disabled" } as const;

type Row = readonly [
  label: string,
  mode: EffectiveThinkingMode,
  profile: NativeThinkingProfile | undefined,
  wire: ReturnType<typeof toAnthropicThinking>,
  thinks: boolean,
];

const TABLE: readonly Row[] = [
  ["enabled, adaptive row", ThinkingMode.ENABLED, { shape: "adaptive", required: false }, ADAPTIVE, true],
  ["enabled, budget row", ThinkingMode.ENABLED, { shape: "budget", required: false }, BUDGET, true],
  ["enabled, row with no form", ThinkingMode.ENABLED, { shape: "none", required: undefined }, undefined, false],
  ["enabled, adaptive row never assessed for required", ThinkingMode.ENABLED, { shape: "adaptive", required: undefined }, ADAPTIVE, true],
  ["disabled, adaptive row stating required false", ThinkingMode.DISABLED, { shape: "adaptive", required: false }, DISABLED, false],
  ["disabled, budget row stating required false", ThinkingMode.DISABLED, { shape: "budget", required: false }, DISABLED, false],
  ["disabled, row never assessed for required", ThinkingMode.DISABLED, { shape: "adaptive", required: undefined }, undefined, false],
  ["disabled, row that requires thinking", ThinkingMode.DISABLED, { shape: "adaptive", required: true }, ADAPTIVE, true],
  ["enabled, row that requires thinking", ThinkingMode.ENABLED, { shape: "adaptive", required: true }, ADAPTIVE, true],
  ["disabled, budget row that requires thinking", ThinkingMode.DISABLED, { shape: "budget", required: true }, BUDGET, true],
  ["disabled, row with no form stating required false: no parameter to pin", ThinkingMode.DISABLED, { shape: "none", required: false }, undefined, false],
  ["enabled, no native row", ThinkingMode.ENABLED, undefined, undefined, false],
  ["disabled, no native row", ThinkingMode.DISABLED, undefined, undefined, false],
];

describe("toAnthropicThinking and graphThinks", () => {
  it.each(TABLE)("%s", (_label, mode, profile, wire, thinks) => {
    expect(toAnthropicThinking(mode, profile)).toEqual(wire);
    expect(graphThinks(mode, profile)).toBe(thinks);
  });

  it("keeps the budget inside the provider's bounds on every budget row the registry carries", () => {
    // The provider requires at least 1,024 and less than max_tokens; the
    // smallest budget-row ceiling in the bundled registry is 64,000.
    expect(BUDGET_THINKING_TOKENS).toBeGreaterThanOrEqual(1024);
    expect(BUDGET_THINKING_TOKENS).toBeLessThan(64_000);
  });
});

describe("resolveEffectiveThinkingMode", () => {
  it("resolves UNSPECIFIED and DISABLED to DISABLED, and keeps ENABLED", () => {
    expect(resolveEffectiveThinkingMode(undefined)).toBe(ThinkingMode.DISABLED);
    expect(resolveEffectiveThinkingMode(ThinkingMode.UNSPECIFIED)).toBe(ThinkingMode.DISABLED);
    expect(resolveEffectiveThinkingMode(ThinkingMode.DISABLED)).toBe(ThinkingMode.DISABLED);
    expect(resolveEffectiveThinkingMode(ThinkingMode.ENABLED)).toBe(ThinkingMode.ENABLED);
  });
});
