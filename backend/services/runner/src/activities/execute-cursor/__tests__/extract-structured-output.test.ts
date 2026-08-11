import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../../../config.js";

vi.mock("../../../shared/model-registry.js", () => ({
  getEconomyModel: vi.fn().mockResolvedValue("gpt-4o-mini"),
}));

const mockInvoke = vi.fn();
const mockWithStructuredOutput = vi.fn().mockReturnValue({ invoke: mockInvoke });

vi.mock("../../../shared/model-client.js", () => ({
  buildChatModel: vi.fn().mockResolvedValue({
    model: { withStructuredOutput: (...args: unknown[]) => mockWithStructuredOutput(...args) },
    provider: "openai",
    apiModelId: "gpt-4o-mini",
  }),
}));

// llm-backend.js and llm-proxy.js stay real: the pre-check behavior under
// test IS their composition, and both are pure modules.

const SCHEMA = { type: "object", properties: { answer: { type: "string" } } };

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    proxyEndpoint: null,
    stigmerToken: null,
    ...overrides,
  } as Config;
}

describe("extractStructuredOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Deterministic regardless of the developer's shell: blank reads as
    // missing, and backend vars must not leak in from outside.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "");
    vi.stubEnv("STIGMER_OPENAI_BACKEND", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("direct mode with a key builds a direct-mode model (no endpoint threaded)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-direct");
    const { buildChatModel } = await import("../../../shared/model-client.js");
    const { extractStructuredOutput } = await import("../extract-structured-output.js");
    mockInvoke.mockResolvedValueOnce({ answer: "42" });

    const result = await extractStructuredOutput("the answer is 42", SCHEMA, makeConfig(), "gpt-4.1");

    expect(result).toEqual({ answer: "42" });
    // The regression pin: the gRPC control-plane endpoint must never
    // reappear here as a stand-in LLM proxy.
    expect(buildChatModel).toHaveBeenCalledWith(
      expect.objectContaining({ proxyEndpoint: undefined }),
    );
  });

  it("throws the credential message before any construction when no path exists", async () => {
    const { buildChatModel } = await import("../../../shared/model-client.js");
    const { extractStructuredOutput } = await import("../extract-structured-output.js");

    await expect(
      extractStructuredOutput("text", SCHEMA, makeConfig(), "gpt-4.1"),
    ).rejects.toThrow(/'gpt-4o-mini'.*OPENAI_API_KEY/s);
    expect(buildChatModel).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("proxy mode threads the proxy endpoint and token, consulting no keys", async () => {
    const { buildChatModel } = await import("../../../shared/model-client.js");
    const { extractStructuredOutput } = await import("../extract-structured-output.js");
    mockInvoke.mockResolvedValueOnce({ answer: "ok" });

    const result = await extractStructuredOutput(
      "text", SCHEMA,
      makeConfig({ proxyEndpoint: "https://api.stigmer.ai", stigmerToken: "tok" }),
      "gpt-4.1",
    );

    expect(result).toEqual({ answer: "ok" });
    expect(buildChatModel).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyEndpoint: "https://api.stigmer.ai",
        stigmerToken: "tok",
      }),
    );
  });

  it("defers an un-inferable extraction model to buildChatModel's own error", async () => {
    // The registry-empty fallback returns the primary model verbatim; when
    // its provider can't be inferred the pre-check must not guess — the
    // construction path owns the precise message.
    const { getEconomyModel } = await import("../../../shared/model-registry.js");
    vi.mocked(getEconomyModel).mockResolvedValueOnce("mystery-model");
    const { buildChatModel } = await import("../../../shared/model-client.js");
    const { extractStructuredOutput } = await import("../extract-structured-output.js");
    mockInvoke.mockResolvedValueOnce({ answer: "ok" });

    await extractStructuredOutput("text", SCHEMA, makeConfig(), "mystery-model");

    expect(buildChatModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: "mystery-model" }),
    );
  });

  it("normalizes an empty extraction result to null", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-direct");
    const { extractStructuredOutput } = await import("../extract-structured-output.js");
    mockInvoke.mockResolvedValueOnce(undefined);

    const result = await extractStructuredOutput("text", SCHEMA, makeConfig(), "gpt-4.1");

    expect(result).toBeNull();
  });
});
