/**
 * The Stigmer harness's thinking mapping, enumerated: every effective mode
 * against every form a Stigmer registry row can declare, including the tri-state
 * `required` flag. The table is the contract the wire and the
 * structured-output strategy both read, so it is pinned whole.
 */

import { describe, expect, it } from "vitest";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import {
  BUDGET_THINKING_TOKENS,
  GOOGLE_DYNAMIC_THINKING_BUDGET,
  thinkingRefusesForcedTool,
  toGoogleThinking,
  graphThinks,
  resolveEffectiveThinkingMode,
  toAnthropicThinking,
  type EffectiveThinkingMode,
} from "../thinking-mode.js";
import type { ThinkingProfile } from "../model-registry.js";

const ADAPTIVE = { type: "adaptive", display: "summarized" } as const;
const BUDGET = { type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS } as const;
const DISABLED = { type: "disabled" } as const;

type Row = readonly [
  label: string,
  mode: EffectiveThinkingMode,
  profile: ThinkingProfile | undefined,
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
  ["enabled, no Stigmer row", ThinkingMode.ENABLED, undefined, undefined, false],
  ["disabled, no Stigmer row", ThinkingMode.DISABLED, undefined, undefined, false],
];

/** Google's budget for each Anthropic form the table names: the same row asks both providers alike. */
function googleOf(wire: ReturnType<typeof toAnthropicThinking>): ReturnType<typeof toGoogleThinking> {
  if (wire === undefined) return undefined;
  switch (wire.type) {
    case "adaptive":
      return { thinkingBudget: GOOGLE_DYNAMIC_THINKING_BUDGET };
    case "enabled":
      return { thinkingBudget: BUDGET_THINKING_TOKENS };
    case "disabled":
      return { thinkingBudget: 0 };
  }
}

describe("toAnthropicThinking, toGoogleThinking and graphThinks", () => {
  it.each(TABLE)("%s", (_label, mode, profile, wire, thinks) => {
    expect(toAnthropicThinking(mode, profile)).toEqual(wire);
    expect(toGoogleThinking(mode, profile)).toEqual(googleOf(wire));
    expect(graphThinks(mode, profile)).toBe(thinks);
  });

  it("a forced tool is refused while thinking on Anthropic, never on Google, and never when the graph does not think", () => {
    const adaptive: ThinkingProfile = { shape: "adaptive", required: undefined };
    expect(thinkingRefusesForcedTool("anthropic", ThinkingMode.ENABLED, adaptive)).toBe(true);
    expect(thinkingRefusesForcedTool("google", ThinkingMode.ENABLED, adaptive)).toBe(false);
    expect(thinkingRefusesForcedTool("anthropic", ThinkingMode.DISABLED, adaptive)).toBe(false);
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
