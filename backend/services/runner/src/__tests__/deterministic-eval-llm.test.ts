import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReplayFetchInterceptor } from "../__test-utils__/replay-fetch.js";
import { callEvalAction, type EvalConfig } from "../activities/call-eval.js";
import { callLlmAction, type LlmCallConfig } from "../activities/call-llm.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.STIGMER_PROXY_ENDPOINT = "https://proxy";
  process.env.STIGMER_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.STIGMER_PROXY_ENDPOINT;
  delete process.env.STIGMER_TOKEN;
  Object.keys(process.env).forEach((k) => {
    if (!(k in originalEnv)) delete process.env[k];
  });
  Object.assign(process.env, originalEnv);
});

// ─── Eval Tests ──────────────────────────────────────────────────────────────

describe("callEvalAction — deterministic replay", () => {
  describe("EVAL_PASS_FAIL mode", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-eval-passfail");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("returns pass=true with reasoning for a correct statement", async () => {
      const config: EvalConfig = {
        model: "claude-sonnet-4-20250514",
        subject: "The Earth orbits the Sun in approximately 365.25 days.",
        rubric: "Evaluate whether the statement is factually correct.",
        scoring_mode: "EVAL_PASS_FAIL",
      };

      const result = await callEvalAction(config, {}, "exec-eval-pf-1");

      expect(result.pass).toBe(true);
      expect(result.reasoning).toContain("factually correct");
      expect(result.model_used).toBe("claude-sonnet-4-20250514");
      expect(result.subject).toBe(config.subject);
      expect(interceptor.allConsumed).toBe(true);
    });
  });

  describe("EVAL_NUMERIC_SCORE mode", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-eval-numeric");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("returns numeric score and applies threshold (score >= 0.5 passes)", async () => {
      const config: EvalConfig = {
        model: "claude-sonnet-4-20250514",
        subject: "Machine learning is a subset of AI that enables systems to learn from data.",
        rubric: "Rate the accuracy and clarity of this definition.",
        scoring_mode: "EVAL_NUMERIC_SCORE",
        threshold: 0.5,
      };

      const result = await callEvalAction(config, {}, "exec-eval-num-1");

      expect(result.pass).toBe(true);
      expect(result.score).toBe(0.85);
      expect(result.reasoning).toContain("clear and accurate");
      expect(result.model_used).toBe("claude-sonnet-4-20250514");
      expect(interceptor.allConsumed).toBe(true);
    });

    it("fails when score is below a high threshold", async () => {
      interceptor.uninstall();
      interceptor = new ReplayFetchInterceptor("workflow-eval-numeric");
      interceptor.install();

      const config: EvalConfig = {
        model: "claude-sonnet-4-20250514",
        subject: "Machine learning is a subset of AI that enables systems to learn from data.",
        rubric: "Rate the accuracy and clarity of this definition.",
        scoring_mode: "EVAL_NUMERIC_SCORE",
        threshold: 0.9,
      };

      const result = await callEvalAction(config, {}, "exec-eval-num-2");

      expect(result.pass).toBe(false);
      expect(result.score).toBe(0.85);
    });
  });

  describe("EVAL_FAIL_WARN policy", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-eval-warn");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("allows workflow to continue when on_fail=EVAL_FAIL_WARN", async () => {
      const config: EvalConfig = {
        model: "claude-sonnet-4-20250514",
        subject: "asdf jkl; random gibberish xyz",
        rubric: "Evaluate whether this is a coherent technical explanation.",
        scoring_mode: "EVAL_NUMERIC_SCORE",
        threshold: 0.5,
        on_fail: "EVAL_FAIL_WARN",
      };

      const result = await callEvalAction(config, {}, "exec-eval-warn-1");

      expect(result.pass).toBe(false);
      expect(result.score).toBe(0.15);
      expect(result.reasoning).toContain("nonsensical");
      expect(result.__stigmer_branch_override).toBeUndefined();
      expect(interceptor.allConsumed).toBe(true);
    });

    it("raises ApplicationFailure when on_fail=EVAL_FAIL_RAISE", async () => {
      interceptor.uninstall();
      interceptor = new ReplayFetchInterceptor("workflow-eval-warn");
      interceptor.install();

      const config: EvalConfig = {
        model: "claude-sonnet-4-20250514",
        subject: "asdf jkl; random gibberish xyz",
        rubric: "Evaluate whether this is a coherent technical explanation.",
        scoring_mode: "EVAL_NUMERIC_SCORE",
        threshold: 0.5,
        on_fail: "EVAL_FAIL_RAISE",
      };

      await expect(
        callEvalAction(config, {}, "exec-eval-warn-2"),
      ).rejects.toThrow("Eval failed");
    });
  });
});

// ─── LLM Call Tests ──────────────────────────────────────────────────────────

describe("callLlmAction — deterministic replay", () => {
  describe("Anthropic structured output", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-llm-structured");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("parses JSON response when response_schema is provided", async () => {
      const config: LlmCallConfig = {
        model: "claude-sonnet-4-20250514",
        prompt: "Analyze the sentiment of: 'I love this product!'",
        response_schema: { type: "object" },
      };

      const result = await callLlmAction(config, {}, "exec-llm-struct-1");

      expect(result.result).toEqual({ sentiment: "positive", confidence: 0.95 });
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.input_tokens).toBe(120);
      expect(result.output_tokens).toBe(30);
      expect(result.parse_error).toBeUndefined();
      expect(interceptor.allConsumed).toBe(true);
    });
  });

  describe("Anthropic simple text response", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-llm-simple");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("returns plain text when no response_schema is set", async () => {
      const config: LlmCallConfig = {
        model: "claude-sonnet-4-20250514",
        prompt: "Say HELLO",
      };

      const result = await callLlmAction(config, {}, "exec-llm-simple-1");

      expect(result.result).toBe("HELLO");
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.input_tokens).toBe(50);
      expect(result.output_tokens).toBe(5);
      expect(result.parse_error).toBeUndefined();
      expect(interceptor.allConsumed).toBe(true);
    });
  });

  describe("OpenAI structured output", () => {
    let interceptor: ReplayFetchInterceptor;

    beforeEach(() => {
      interceptor = new ReplayFetchInterceptor("workflow-llm-openai");
      interceptor.install();
    });

    afterEach(() => {
      interceptor.uninstall();
    });

    it("parses JSON response from OpenAI provider", async () => {
      const config: LlmCallConfig = {
        model: "gpt-4o",
        prompt: "Analyze the sentiment of: 'This is wonderful!'",
        response_schema: { type: "object" },
      };

      const result = await callLlmAction(config, {}, "exec-llm-openai-1");

      expect(result.result).toEqual({ sentiment: "positive", confidence: 0.92 });
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
      expect(result.input_tokens).toBe(150);
      expect(result.output_tokens).toBe(40);
      expect(result.parse_error).toBeUndefined();
      expect(interceptor.allConsumed).toBe(true);
    });

    it("extracts token usage correctly", async () => {
      interceptor.uninstall();
      interceptor = new ReplayFetchInterceptor("workflow-llm-openai");
      interceptor.install();

      const config: LlmCallConfig = {
        model: "gpt-4o",
        prompt: "Analyze the sentiment of: 'This is wonderful!'",
        response_schema: { type: "object" },
      };

      const result = await callLlmAction(config, {}, "exec-llm-openai-2");

      expect(result.input_tokens).toBeGreaterThan(0);
      expect(result.output_tokens).toBeGreaterThan(0);
      expect(result.input_tokens + result.output_tokens).toBe(190);
    });
  });
});
