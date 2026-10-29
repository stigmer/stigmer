/**
 * Model-registry store unit tests, pinning the Go semantics
 * (model_registry_store.go): the sanity gate (parse + ≥1 INDEXED model —
 * id and harness both present, the applyDocument rule; an upstream document
 * must also give the default harness, stigmer, a section), keep-current-on-
 * failure, warn-then-debug failure logging with reset on success, the size
 * cap, the fail-loud bundled-snapshot guard, and the catalog indexes the
 * validators query (harness/variant/capability, canonical
 * suggestion pools, api-id acceptance).
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import {
  FAST_VARIANT_KEY,
  MODEL_REGISTRY_MAX_BYTES,
  ModelRegistryStore,
  THINKING_CAPABILITY_KEY,
} from "../model-registry-store.js";

const VALID_BUNDLE = JSON.stringify({
  models: [{ id: "anthropic/claude", harness: "stigmer" }],
});
const UPGRADED = JSON.stringify({
  models: [
    { id: "anthropic/claude", harness: "stigmer" },
    { id: "openai/gpt", harness: "stigmer" },
  ],
});

function capturingLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  return {
    lines,
    logger: createLogger({
      level: "debug",
      pretty: false,
      write: (line) =>
        lines.push(JSON.parse(line) as { level: string; message: string }),
    }),
  };
}

function store(
  fetchImpl: typeof fetch,
  logger = capturingLogger().logger,
): ModelRegistryStore {
  return new ModelRegistryStore({
    bundledDocument: VALID_BUNDLE,
    upstreamOrigin: "http://upstream.test",
    refreshEnabled: true,
    logger,
    fetchImpl,
  });
}

describe("ModelRegistryStore", () => {
  it("refuses to construct on an invalid bundled snapshot (build defect, fail loud)", () => {
    expect(
      () =>
        new ModelRegistryStore({
          bundledDocument: JSON.stringify({ models: [] }),
          upstreamOrigin: "http://upstream.test",
          refreshEnabled: true,
          logger: capturingLogger().logger,
        }),
    ).toThrow(/no models/);
  });

  it("applies an upstream document that passes the sanity gate", async () => {
    const subject = store(async () => new Response(UPGRADED, { status: 200 }));

    await subject.refreshOnce();

    expect(subject.document()).toBe(UPGRADED);
  });

  it.each([
    ["non-JSON body", "not json at all"],
    ["empty models array", JSON.stringify({ models: [] })],
    ["missing models key", JSON.stringify({ descriptors: [] })],
    // $comment section dividers carry no id/harness and index nothing — a
    // divider-only document is as unusable as an empty one (Go applyDocument
    // gates on the INDEX, not the raw array length).
    [
      "divider-only entries",
      JSON.stringify({ models: [{ $comment: "── Anthropic ──" }] }),
    ],
    // A hosted registry still filing the default harness's rows under its
    // former word: accepting it would empty the stigmer section.
    [
      "rows under a word this build does not read",
      JSON.stringify({
        models: [
          { id: "anthropic/claude", harness: "native" },
          { id: "anthropic/claude", harness: "claude" },
        ],
      }),
    ],
  ])(
    "keeps the current document when the upstream serves %s",
    async (_case, body) => {
      const subject = store(async () => new Response(body, { status: 200 }));

      await subject.refreshOnce();

      expect(subject.document()).toBe(VALID_BUNDLE);
    },
  );

  it("keeps the current document on upstream errors and oversized bodies", async () => {
    const failing = store(async () => new Response("nope", { status: 503 }));
    await failing.refreshOnce();
    expect(failing.document()).toBe(VALID_BUNDLE);

    const oversized = store(
      async () =>
        new Response(
          `{"models":[{"pad":"${"x".repeat(MODEL_REGISTRY_MAX_BYTES)}"}]}`,
          {
            status: 200,
          },
        ),
    );
    await oversized.refreshOnce();
    expect(oversized.document()).toBe(VALID_BUNDLE);
  });

  it("logs the first consecutive failure at warn, repeats at debug, resets on success", async () => {
    const { lines, logger } = capturingLogger();
    let mode: "fail" | "ok" = "fail";
    const subject = store(async () => {
      if (mode === "fail") {
        return new Response("down", { status: 500 });
      }
      return new Response(UPGRADED, { status: 200 });
    }, logger);

    await subject.refreshOnce();
    await subject.refreshOnce();
    expect(lines.map((line) => line.level)).toEqual(["warn", "debug"]);

    mode = "ok";
    await subject.refreshOnce();
    expect(subject.document()).toBe(UPGRADED);

    // The flag reset: the NEXT failure is "first" again → warn.
    mode = "fail";
    await subject.refreshOnce();
    expect(lines.map((line) => line.level)).toEqual(["warn", "debug", "warn"]);
  });
});

/**
 * The catalog indexes (Go applyDocument :302-412 + the query methods) — the
 * surface the run-config checks consume. Fixture shape mirrors real
 * registry entries: canonical id + provider api id, harness sections,
 * pricingVariants key set, tri-state capabilities.
 */
describe("ModelRegistryStore catalog indexes", () => {
  const CATALOG = JSON.stringify({
    models: [
      { $comment: "── section divider (indexes nothing) ──" },
      {
        id: "anthropic/claude-4",
        apiModelId: "claude-4-20260101",
        harness: "stigmer",
        pricingVariants: { fast: { input: 1 } },
      },
      {
        id: "anthropic/claude-4",
        apiModelId: "claude-4-sdk",
        harness: "claude",
        capabilities: { thinking: true },
      },
      {
        id: "anthropic/claude-5",
        harness: "claude",
        // false and non-boolean shapes index nothing (tri-state rule).
        capabilities: { thinking: false, vision: "yes" },
      },
      { id: "zeta/z-1", harness: "stigmer" },
    ],
  });

  function catalogStore(): ModelRegistryStore {
    return new ModelRegistryStore({
      bundledDocument: CATALOG,
      upstreamOrigin: "http://upstream.test",
      refreshEnabled: false,
      logger: capturingLogger().logger,
    });
  }

  it("validates canonical ids AND provider api ids per harness (oss#240)", () => {
    const s = catalogStore();
    expect(s.isValidModel("stigmer", "anthropic/claude-4")).toBe(true);
    expect(s.isValidModel("stigmer", "claude-4-20260101")).toBe(true);
    expect(s.isValidModel("stigmer", "claude-4-sdk")).toBe(false);
    expect(s.isValidModel("claude", "claude-4-sdk")).toBe(true);
    expect(s.isValidModel("stigmer", "anthropic/claude-5")).toBe(false);
    expect(s.hasHarness("stigmer")).toBe(true);
    expect(s.hasHarness("cli")).toBe(false);
    expect(s.hasAnyModels()).toBe(true);
  });

  it("answers the any-harness existence check and its merged suggestion pool", () => {
    const s = catalogStore();
    expect(s.isValidModelOnAnyHarness("anthropic/claude-5")).toBe(true);
    expect(s.isValidModelOnAnyHarness("nope/never")).toBe(false);
    // Sorted, deduplicated canonical ids (claude-4 appears in two sections).
    expect(s.canonicalModelsAcrossHarnesses()).toEqual([
      "anthropic/claude-4",
      "anthropic/claude-5",
      "zeta/z-1",
    ]);
    expect(s.canonicalModels("stigmer")).toEqual([
      "anthropic/claude-4",
      "zeta/z-1",
    ]);
  });

  it("indexes pricing variants by key presence, harness-scoped and unioned", () => {
    const s = catalogStore();
    expect(
      s.hasPricingVariantForHarness("stigmer", "anthropic/claude-4", FAST_VARIANT_KEY),
    ).toBe(true);
    // Priced under stigmer only — the claude section must not validate it
    // (the #357 silent-no-op class).
    expect(
      s.hasPricingVariantForHarness("claude", "anthropic/claude-4", FAST_VARIANT_KEY),
    ).toBe(false);
    expect(s.hasPricingVariant("anthropic/claude-4", FAST_VARIANT_KEY)).toBe(true);
    expect(s.hasPricingVariant("zeta/z-1", FAST_VARIANT_KEY)).toBe(false);
    expect(s.canonicalModelsWithVariant(FAST_VARIANT_KEY)).toEqual([
      "anthropic/claude-4",
    ]);
    expect(
      s.canonicalModelsWithVariantForHarness("stigmer", FAST_VARIANT_KEY),
    ).toEqual(["anthropic/claude-4"]);
    expect(
      s.canonicalModelsWithVariantForHarness("claude", FAST_VARIANT_KEY),
    ).toEqual([]);
  });

  it("indexes only literal-true capabilities, harness-scoped (oss#772)", () => {
    const s = catalogStore();
    expect(
      s.hasCapabilityForHarness("claude", "anthropic/claude-4", THINKING_CAPABILITY_KEY),
    ).toBe(true);
    expect(
      s.hasCapabilityForHarness("claude", "claude-4-sdk", THINKING_CAPABILITY_KEY),
    ).toBe(true);
    // Declared under claude only.
    expect(
      s.hasCapabilityForHarness("stigmer", "anthropic/claude-4", THINKING_CAPABILITY_KEY),
    ).toBe(false);
    // false / non-boolean shapes never index (tri-state).
    expect(
      s.hasCapabilityForHarness("claude", "anthropic/claude-5", THINKING_CAPABILITY_KEY),
    ).toBe(false);
    expect(s.hasCapabilityForHarness("claude", "anthropic/claude-5", "vision")).toBe(false);
    expect(
      s.canonicalModelsWithCapabilityForHarness("claude", THINKING_CAPABILITY_KEY),
    ).toEqual(["anthropic/claude-4"]);
  });

  it("swaps document and indexes together on refresh", async () => {
    const upgraded = JSON.stringify({
      models: [{ id: "new/model", harness: "stigmer" }],
    });
    const s = new ModelRegistryStore({
      bundledDocument: CATALOG,
      upstreamOrigin: "http://upstream.test",
      refreshEnabled: true,
      logger: capturingLogger().logger,
      fetchImpl: async () => new Response(upgraded, { status: 200 }),
    });

    await s.refreshOnce();

    expect(s.document()).toBe(upgraded);
    expect(s.isValidModel("stigmer", "new/model")).toBe(true);
    expect(s.isValidModel("stigmer", "anthropic/claude-4")).toBe(false);
  });
});

describe("ModelRegistryStore provider and default model", () => {
  it("delegates providerOf and defaultModel to the current document", () => {
    const s = new ModelRegistryStore({
      bundledDocument: JSON.stringify({
        models: [
          { id: "claude-a", provider: "anthropic", harness: "stigmer", costTier: "standard", featured: true },
        ],
      }),
      upstreamOrigin: "http://upstream.test",
      refreshEnabled: false,
      logger: capturingLogger().logger,
    });
    expect(s.providerOf("stigmer", "claude-a")).toBe("anthropic");
    expect(s.providerOf("stigmer", "openai:own")).toBe("openai");
    expect(s.defaultModel("stigmer")).toBe("claude-a");
  });
});
