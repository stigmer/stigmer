/**
 * Live: the workflow `llm_call` task's activity (`callLlmAction`) against
 * Anthropic on Claude Haiku, once for text and once with a response schema.
 *
 * What `call-llm.test.ts` cannot show, and this does: the direct-mode path a
 * self-hosted workflow takes (no proxy; the provider's own key), from the
 * registry's real provider id through the provider's streamed response to the
 * collected result and its token counts, and a structured answer that parses
 * against the schema the task declared. Assertions read structure, never the
 * model's words.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `ANTHROPIC_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`). Each call is capped by `max_tokens`
 * (the activity has no cost cap of its own: a workflow budget lives in the
 * engine), and the control plane's real registry is served so the provider id
 * is the one users' workflows send.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { liveSecret, recordLiveSpend, useProviderDirectly } from "../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../__test-utils__/real-model-registry.js";
import { _resetPricingCache } from "../../shared/model-pricing-data.js";
import { _resetRegistryCache } from "../../shared/model-registry.js";
import { callLlmAction } from "../call-llm.js";

const LIVE_MODEL = "claude-haiku-4.5";
/** One short answer each; the bound on what a call can spend. */
const MAX_TOKENS = 200;

/**
 * The activity's own estimate, in dollars: `callLlmAction` stamps
 * `__stigmer_cost_micros` from the price table the served registry loaded, so
 * a positive figure also proves the table knows the real model.
 */
function estimatedCostUsd(result: object): number {
  const micros = (result as { __stigmer_cost_micros?: unknown }).__stigmer_cost_micros;
  return typeof micros === "number" ? micros / 1_000_000 : 0;
}

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("callLlmAction live — Claude Haiku, direct mode", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;
  let restoreEnv: () => void;

  beforeAll(() => {
    // Direct mode is the self-hosted path: no proxy, no gateway, no cloud backend, the provider's own key.
    restoreEnv = useProviderDirectly();
    registry = stubRegistryFetch({ live: true, document: realModelRegistry() });
  });

  beforeEach(() => {
    _resetRegistryCache();
    _resetPricingCache();
  });

  afterAll(() => {
    registry.restore();
    restoreEnv();
  });

  it("returns text with its token counts", async () => {
    const result = await callLlmAction(
      { model: LIVE_MODEL, prompt: "Reply with one short sentence.", max_tokens: MAX_TOKENS },
      {},
      "live-call-llm-text",
    );
    recordLiveSpend("workflow llm_call text (claude-haiku-4.5)", estimatedCostUsd(result));

    expect(result.provider).toBe("anthropic");
    expect(estimatedCostUsd(result), "the price table knows the real model").toBeGreaterThan(0);
    expect(typeof result.result === "string" && result.result.trim().length > 0, JSON.stringify(result.result)).toBe(true);
    expect(result.input_tokens).toBeGreaterThan(0);
    expect(result.output_tokens).toBeGreaterThan(0);
  });

  it("returns an object that satisfies the declared response schema", async () => {
    const result = await callLlmAction(
      {
        model: LIVE_MODEL,
        prompt: 'Return a JSON object with "status" set to "ok" and "count" set to 3.',
        max_tokens: MAX_TOKENS,
        response_schema: {
          type: "object",
          properties: { status: { type: "string" }, count: { type: "integer" } },
          required: ["status", "count"],
        },
      },
      {},
      "live-call-llm-schema",
    );
    recordLiveSpend("workflow llm_call schema (claude-haiku-4.5)", estimatedCostUsd(result));

    // With no `on_invalid`, an answer that misses the schema throws (LLM_SCHEMA_VALIDATION),
    // so reaching here means it validated; the fields are read to show what came back.
    const value = result.result as { status?: unknown; count?: unknown };
    expect(typeof value.status).toBe("string");
    expect(Number.isInteger(value.count)).toBe(true);
  });
});
