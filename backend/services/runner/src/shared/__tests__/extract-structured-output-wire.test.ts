/**
 * The wire contract of tier-2 structured-output extraction
 * (`../extract-structured-output.ts`): what the economy model receives on
 * each provider when the turn's final text carried no JSON, recorded as a
 * file snapshot.
 *
 * `buildChatModel` is replaced by a real `ChatAnthropic` or `ChatOpenAI`
 * whose transport keeps the request and refuses it
 * (`__test-utils__/captured-llm-request.ts`), so the extractor's own
 * `withStructuredOutput` call and the provider SDK's body are both inside
 * the recording. The refusal makes the extractor throw, which its caller
 * treats as "tier 2 unavailable"; the test reads only the request.
 *
 * Regenerate ONLY after a deliberate change to what the extractor sends:
 *   npx vitest run src/shared/__tests__/extract-structured-output-wire.test.ts -u
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Config } from "../../config.js";
import {
  capturingAnthropic,
  capturingOpenAI,
  wireSchemaPart,
  type CapturedBodies,
} from "../../__test-utils__/captured-llm-request.js";
import { ANSWER_FORM } from "../../__test-utils__/answer-form-fixture.js";

const built: { model: BaseChatModel | null } = { model: null };

vi.mock("../model-registry.js", () => ({
  getEconomyModel: vi.fn(async (primary: string) => primary),
}));

vi.mock("../model-client.js", () => ({
  buildChatModel: vi.fn(async () => ({ model: built.model, provider: "openai", apiModelId: "wire-test" })),
}));

const PROXIED = { proxyEndpoint: "https://proxy.example.invalid", stigmerTokenRef: { current: "t" } } as unknown as Config;

describe("tier-2 extraction on the wire", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    built.model = null;
  });

  it("each provider's economy model receives the recorded answer form", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const { extractStructuredOutput } = await import("../extract-structured-output.js");
    const cases: Array<[string, (sink: CapturedBodies) => BaseChatModel]> = [
      ["anthropic", (s) => capturingAnthropic(s, "claude-haiku-4-5")],
      ["openai", (s) => capturingOpenAI(s, "gpt-4.1-mini")],
    ];

    // ── Act ──────────────────────────────────────────────────────────────────
    const recorded: Record<string, unknown> = {};
    for (const [label, build] of cases) {
      const sink: CapturedBodies = [];
      built.model = build(sink);
      await expect(extractStructuredOutput("A prose review.", ANSWER_FORM, PROXIED, "wire-test", "run_1")).rejects.toThrow();
      expect(sink, `${label}: exactly one request reached the transport`).toHaveLength(1);
      recorded[label] = wireSchemaPart(sink[0]!);
    }

    // ── Assert ───────────────────────────────────────────────────────────────
    await expect(JSON.stringify(recorded, null, 2) + "\n").toMatchFileSnapshot("./goldens/extract-structured-output-wire.json");
  });
});
