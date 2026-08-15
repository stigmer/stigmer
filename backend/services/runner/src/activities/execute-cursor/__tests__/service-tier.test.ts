import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Verifies the variant-attribute → Cursor variant-parameter translation
 * (#357 service tier, #772 thinking mode): the runner must always send an
 * explicit selection whose user-selectable parameters are a deterministic
 * function of the requested attributes — never the catalog's
 * (account-influenced) default variant.
 *
 * Catalog fixtures mirror the real shapes observed 2026-08-06: composer
 * has a `fast` bool (default fast=true), haiku has a `thinking` bool
 * (default thinking=true), grok has `effort` x `fast`, and Auto
 * ("default") has a single variant with no parameters.
 */
const listMock = vi.hoisted(() => vi.fn());

vi.mock("@cursor/sdk", () => ({
  Cursor: { models: { list: listMock } },
}));

import {
  resolveServiceTierParams,
  resetCatalogCacheForTests,
} from "../service-tier.js";
import { resolveEffectiveServiceTier } from "../../../shared/service-tier.js";
import { resolveEffectiveThinkingMode } from "../../../shared/thinking-mode.js";

const CATALOG = [
  {
    id: "composer-2.5",
    displayName: "Composer 2.5",
    aliases: ["composer-latest", "composer"],
    parameters: [
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
    aliases: ["haiku"],
    parameters: [
      { id: "thinking", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
  {
    id: "grok-4.5",
    displayName: "Cursor Grok 4.5",
    parameters: [
      { id: "effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
  {
    id: "claude-opus-4-8",
    displayName: "Opus 4.8",
    parameters: [
      { id: "thinking", values: [{ value: "false" }, { value: "true" }] },
      { id: "effort", values: [{ value: "low" }, { value: "high" }] },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
  },
  {
    id: "default",
    displayName: "Auto",
    aliases: ["auto"],
    variants: [{ params: [], displayName: "Auto", isDefault: true }],
  },
];

function opts(
  modelId: string,
  tier: ServiceTier.STANDARD | ServiceTier.FAST,
  thinking: ThinkingMode.DISABLED | ThinkingMode.ENABLED = ThinkingMode.DISABLED,
) {
  return { apiKey: "key-1", modelId, tier, thinking, executionId: "aex_test" };
}

beforeEach(() => {
  resetCatalogCacheForTests();
  listMock.mockReset();
  listMock.mockResolvedValue(CATALOG);
});

describe("resolveEffectiveServiceTier", () => {
  it("resolves UNSPECIFIED to STANDARD — never the account default", () => {
    expect(resolveEffectiveServiceTier(ServiceTier.UNSPECIFIED)).toBe(ServiceTier.STANDARD);
    expect(resolveEffectiveServiceTier(undefined)).toBe(ServiceTier.STANDARD);
  });

  it("preserves explicit STANDARD and FAST", () => {
    expect(resolveEffectiveServiceTier(ServiceTier.STANDARD)).toBe(ServiceTier.STANDARD);
    expect(resolveEffectiveServiceTier(ServiceTier.FAST)).toBe(ServiceTier.FAST);
  });
});

describe("resolveEffectiveThinkingMode", () => {
  it("resolves UNSPECIFIED to DISABLED — never the account default", () => {
    expect(resolveEffectiveThinkingMode(ThinkingMode.UNSPECIFIED)).toBe(ThinkingMode.DISABLED);
    expect(resolveEffectiveThinkingMode(undefined)).toBe(ThinkingMode.DISABLED);
  });

  it("preserves explicit DISABLED and ENABLED", () => {
    expect(resolveEffectiveThinkingMode(ThinkingMode.DISABLED)).toBe(ThinkingMode.DISABLED);
    expect(resolveEffectiveThinkingMode(ThinkingMode.ENABLED)).toBe(ThinkingMode.ENABLED);
  });
});

describe("resolveServiceTierParams", () => {
  it("STANDARD pins fast=false on a fast-capable model", async () => {
    const params = await resolveServiceTierParams(opts("composer-2.5", ServiceTier.STANDARD));
    expect(params).toEqual([{ id: "fast", value: "false" }]);
  });

  it("FAST pins fast=true on a fast-capable model", async () => {
    const params = await resolveServiceTierParams(opts("composer-2.5", ServiceTier.FAST));
    expect(params).toEqual([{ id: "fast", value: "true" }]);
  });

  it("STANDARD pins thinking=false on a thinking-capable model (the haiku drift)", async () => {
    const params = await resolveServiceTierParams(opts("claude-haiku-4-5", ServiceTier.STANDARD));
    expect(params).toEqual([{ id: "thinking", value: "false" }]);
  });

  it("FAST on a model with no fast parameter fails loudly, never downgrades", async () => {
    await expect(
      resolveServiceTierParams(opts("claude-haiku-4-5", ServiceTier.FAST)),
    ).rejects.toThrow(/no "fast" parameter/);
  });

  it("leaves price-neutral parameters (effort) to the catalog default", async () => {
    const params = await resolveServiceTierParams(opts("grok-4.5", ServiceTier.STANDARD));
    expect(params).toEqual([{ id: "fast", value: "false" }]);
  });

  it("pins every price-bearing parameter, sorted, on multi-dimension models", async () => {
    const params = await resolveServiceTierParams(opts("claude-opus-4-8", ServiceTier.FAST));
    expect(params).toEqual([
      { id: "fast", value: "true" },
      { id: "thinking", value: "false" },
    ]);
  });

  it("ENABLED pins thinking=true on a thinking-capable model (#772)", async () => {
    const params = await resolveServiceTierParams(
      opts("claude-haiku-4-5", ServiceTier.STANDARD, ThinkingMode.ENABLED),
    );
    expect(params).toEqual([{ id: "thinking", value: "true" }]);
  });

  it("ENABLED on a model with no thinking parameter fails loudly, never a silent base variant", async () => {
    await expect(
      resolveServiceTierParams(opts("composer-2.5", ServiceTier.STANDARD, ThinkingMode.ENABLED)),
    ).rejects.toThrow(/no "thinking" parameter/);
  });

  it("thinking combines freely with the fast tier — both pinned true, sorted", async () => {
    const params = await resolveServiceTierParams(
      opts("claude-opus-4-8", ServiceTier.FAST, ThinkingMode.ENABLED),
    );
    expect(params).toEqual([
      { id: "fast", value: "true" },
      { id: "thinking", value: "true" },
    ]);
  });

  it("Auto + ENABLED is a loud failure (no variant dimensions to pin)", async () => {
    await expect(
      resolveServiceTierParams(opts("default", ServiceTier.STANDARD, ThinkingMode.ENABLED)),
    ).rejects.toThrow(/requires a pinned model/);
  });

  it("unknown model + ENABLED fails loudly, never degrades", async () => {
    await expect(
      resolveServiceTierParams(opts("not-a-model", ServiceTier.STANDARD, ThinkingMode.ENABLED)),
    ).rejects.toThrow(/does not list that model/);
  });

  it("catalog fetch failure + ENABLED fails loudly, never degrades", async () => {
    listMock.mockRejectedValue(new Error("proxy down"));
    await expect(
      resolveServiceTierParams(opts("claude-haiku-4-5", ServiceTier.STANDARD, ThinkingMode.ENABLED)),
    ).rejects.toThrow(/catalog fetch failed/);
  });

  it("resolves models referenced by alias", async () => {
    const params = await resolveServiceTierParams(opts("composer", ServiceTier.STANDARD));
    expect(params).toEqual([{ id: "fast", value: "false" }]);
  });

  it("Auto has no tier dimension: STANDARD sends no params", async () => {
    const params = await resolveServiceTierParams(opts("default", ServiceTier.STANDARD));
    expect(params).toEqual([]);
    // No catalog fetch needed for Auto — nothing to look up.
    expect(listMock).not.toHaveBeenCalled();
  });

  it("Auto + FAST is a loud failure (registry/catalog drift, not a silent no-op)", async () => {
    await expect(
      resolveServiceTierParams(opts("default", ServiceTier.FAST)),
    ).rejects.toThrow(/requires a pinned model/);
  });

  it("unknown model: STANDARD degrades to no params, FAST fails loudly", async () => {
    await expect(
      resolveServiceTierParams(opts("not-a-model", ServiceTier.STANDARD)),
    ).resolves.toEqual([]);
    await expect(
      resolveServiceTierParams(opts("not-a-model", ServiceTier.FAST)),
    ).rejects.toThrow(/does not list that model/);
  });

  it("catalog fetch failure: STANDARD degrades, FAST fails loudly", async () => {
    listMock.mockRejectedValue(new Error("proxy down"));
    await expect(
      resolveServiceTierParams(opts("composer-2.5", ServiceTier.STANDARD)),
    ).resolves.toEqual([]);
    resetCatalogCacheForTests();
    listMock.mockRejectedValue(new Error("proxy down"));
    await expect(
      resolveServiceTierParams(opts("composer-2.5", ServiceTier.FAST)),
    ).rejects.toThrow(/catalog fetch failed/);
  });

  it("caches the catalog per worker — one fetch for repeated resolutions", async () => {
    await resolveServiceTierParams(opts("composer-2.5", ServiceTier.STANDARD));
    await resolveServiceTierParams(opts("claude-haiku-4-5", ServiceTier.STANDARD));
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
