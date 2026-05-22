import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ReplayFetchInterceptor,
  writeFixture,
  anthropicResponseBody,
  openaiResponseBody,
} from "../replay-fetch.js";

const originalFetch = globalThis.fetch;

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "replay-fetch-test-"));
}

describe("ReplayFetchInterceptor", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("replay mode", () => {
    it("replays recorded responses in order", async () => {
      writeFixture("test-replay", [
        {
          request: { url: "https://proxy/v1/proxy/llm/anthropic/v1/messages" },
          response: { body: anthropicResponseBody("Hello from turn 1") },
        },
        {
          request: { url: "https://proxy/v1/proxy/llm/anthropic/v1/messages" },
          response: { body: anthropicResponseBody("Hello from turn 2") },
        },
      ], tempDir);

      const interceptor = new ReplayFetchInterceptor("test-replay", { fixturesDir: tempDir });
      interceptor.install();

      const r1 = await fetch("https://proxy/v1/proxy/llm/anthropic/v1/messages", { method: "POST" });
      const b1 = await r1.json() as Record<string, unknown>;
      const content1 = (b1.content as Array<{ text: string }>);
      expect(content1[0].text).toBe("Hello from turn 1");

      const r2 = await fetch("https://proxy/v1/proxy/llm/anthropic/v1/messages", { method: "POST" });
      const b2 = await r2.json() as Record<string, unknown>;
      const content2 = (b2.content as Array<{ text: string }>);
      expect(content2[0].text).toBe("Hello from turn 2");

      expect(interceptor.allConsumed).toBe(true);
      interceptor.uninstall();
    });

    it("throws when fixture file is missing", () => {
      const interceptor = new ReplayFetchInterceptor("nonexistent", { fixturesDir: tempDir });
      expect(() => interceptor.install()).toThrow("fixture not found");
    });

    it("throws when all entries are consumed", async () => {
      writeFixture("one-entry", [
        {
          request: { url: "https://proxy/v1/proxy/llm/anthropic/v1/messages" },
          response: { body: anthropicResponseBody("Only response") },
        },
      ], tempDir);

      const interceptor = new ReplayFetchInterceptor("one-entry", { fixturesDir: tempDir });
      interceptor.install();

      await fetch("https://proxy/v1/proxy/llm/anthropic/v1/messages", { method: "POST" });

      await expect(
        fetch("https://proxy/v1/proxy/llm/anthropic/v1/messages", { method: "POST" }),
      ).rejects.toThrow("no more recorded entries");

      interceptor.uninstall();
    });

    it("passes through non-LLM URLs to original fetch", async () => {
      writeFixture("passthrough", [
        {
          request: { url: "https://proxy/v1/proxy/llm/anthropic/v1/messages" },
          response: { body: anthropicResponseBody("LLM response") },
        },
      ], tempDir);

      const mockOriginal = async () => new Response('{"ok":true}', { status: 200 });
      globalThis.fetch = mockOriginal as typeof globalThis.fetch;

      const interceptor = new ReplayFetchInterceptor("passthrough", { fixturesDir: tempDir });
      interceptor.install();

      const nonLlm = await fetch("https://example.com/api/data");
      const nonLlmBody = await nonLlm.json();
      expect(nonLlmBody).toEqual({ ok: true });

      expect(interceptor.consumedCount).toBe(0);
      interceptor.uninstall();
    });
  });

  describe("writeFixture", () => {
    it("creates fixture file with correct structure", () => {
      const path = writeFixture("structured", [
        {
          request: { method: "POST", url: "https://api/v1/messages" },
          response: { status: 200, body: { test: true } },
        },
      ], tempDir);

      expect(existsSync(path)).toBe(true);
    });
  });

  describe("response builders", () => {
    it("builds Anthropic response with text", () => {
      const body = anthropicResponseBody("test text", { inputTokens: 50, outputTokens: 25 });
      expect(body.content).toEqual([{ type: "text", text: "test text" }]);
      expect((body.usage as Record<string, number>).input_tokens).toBe(50);
      expect(body.stop_reason).toBe("end_turn");
    });

    it("builds Anthropic response with tool use", () => {
      const body = anthropicResponseBody("thinking...", {
        toolUse: [{ id: "tc_1", name: "echo", input: { text: "hello" } }],
      });
      const content = body.content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe("tool_use");
      expect(content[0].name).toBe("echo");
      expect(body.stop_reason).toBe("tool_use");
    });

    it("builds OpenAI response with text", () => {
      const body = openaiResponseBody("hello", { promptTokens: 20, completionTokens: 10 });
      const choices = body.choices as Array<Record<string, unknown>>;
      const msg = choices[0].message as Record<string, unknown>;
      expect(msg.content).toBe("hello");
      expect(choices[0].finish_reason).toBe("stop");
    });

    it("builds OpenAI response with tool calls", () => {
      const body = openaiResponseBody("", {
        toolCalls: [{ id: "call_1", name: "search", arguments: '{"q":"test"}' }],
      });
      const choices = body.choices as Array<Record<string, unknown>>;
      expect(choices[0].finish_reason).toBe("tool_calls");
    });
  });
});
