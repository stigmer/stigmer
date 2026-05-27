import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ReplayFetchInterceptor, type FixtureFile, type RecordedEntry } from "../__test-utils__/replay-fetch.js";
import { callLlmAction } from "../activities/call-llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../test/fixtures/recorded-responses");

function loadFixture(name: string): FixtureFile {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8");
  return JSON.parse(raw) as FixtureFile;
}

function extractToolUseBlocks(entry: RecordedEntry) {
  const body = entry.response.body as Record<string, unknown>;
  const content = body.content as Array<Record<string, unknown>>;
  return content.filter((c) => c.type === "tool_use");
}

function extractTextBlocks(entry: RecordedEntry) {
  const body = entry.response.body as Record<string, unknown>;
  const content = body.content as Array<Record<string, unknown>>;
  return content.filter((c) => c.type === "text");
}

function getUsage(entry: RecordedEntry) {
  const body = entry.response.body as Record<string, unknown>;
  return body.usage as Record<string, number>;
}

const originalEnv = { ...process.env };

describe("deterministic MCP tool-choice fixtures", () => {
  beforeEach(() => {
    process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.stigmer.ai";
    process.env.STIGMER_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.STIGMER_PROXY_ENDPOINT;
    delete process.env.STIGMER_TOKEN;
    Object.assign(process.env, originalEnv);
  });

  describe("agent-mcp-echo", () => {
    const fixture = loadFixture("agent-mcp-echo");

    it("first entry contains a tool_use block for echo", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("echo");
      expect(toolUses[0].input).toEqual({ text: "hello-mcp-test" });
      expect(toolUses[0].id).toBe("toolu_echo_01");
    });

    it("first entry has stop_reason=tool_use", () => {
      const body = fixture.entries[0].response.body as Record<string, unknown>;
      expect(body.stop_reason).toBe("tool_use");
    });

    it("first entry has token counts", () => {
      const usage = getUsage(fixture.entries[0]);
      expect(usage.input_tokens).toBeGreaterThan(0);
      expect(usage.output_tokens).toBeGreaterThan(0);
    });

    it("second entry contains final text summary", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts).toHaveLength(1);
      expect(texts[0].text).toContain("hello-mcp-test");
    });

    it("replays through callLlmAction for post-tool text response", async () => {
      const interceptor = new ReplayFetchInterceptor("agent-mcp-echo", { fixturesDir: FIXTURES_DIR });
      interceptor.install();
      try {
        // First call consumes the tool_use entry — callLlmAction extracts empty text
        const firstResult = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Use the echo tool", max_tokens: 200 },
          {},
          "exec-mcp-echo",
        );
        expect(firstResult.result).toBe("");
        expect(firstResult.input_tokens).toBe(120);
        expect(firstResult.output_tokens).toBe(45);
        expect(firstResult.provider).toBe("anthropic");

        // Second call consumes the final text entry
        const secondResult = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Tool result: hello-mcp-test", max_tokens: 200 },
          {},
          "exec-mcp-echo",
        );
        expect(secondResult.result).toContain("hello-mcp-test");
        expect(secondResult.input_tokens).toBe(180);
        expect(secondResult.output_tokens).toBe(30);

        expect(interceptor.allConsumed).toBe(true);
      } finally {
        interceptor.uninstall();
      }
    });
  });

  describe("agent-mcp-fail", () => {
    const fixture = loadFixture("agent-mcp-fail");

    it("first entry calls the fail tool", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("fail");
      expect(toolUses[0].input).toEqual({ message: "test-error" });
    });

    it("second entry reports the error in text", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts).toHaveLength(1);
      expect(texts[0].text).toContain("test-error");
    });

    it("replays both turns through callLlmAction", async () => {
      const interceptor = new ReplayFetchInterceptor("agent-mcp-fail", { fixturesDir: FIXTURES_DIR });
      interceptor.install();
      try {
        const first = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Use the fail tool", max_tokens: 200 },
          {},
          "exec-mcp-fail",
        );
        expect(first.result).toBe("");
        expect(first.input_tokens).toBe(115);

        const second = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Tool error: test-error", max_tokens: 200 },
          {},
          "exec-mcp-fail",
        );
        expect(second.result).toContain("test-error");
        expect(interceptor.allConsumed).toBe(true);
      } finally {
        interceptor.uninstall();
      }
    });
  });

  describe("agent-mcp-filter", () => {
    const fixture = loadFixture("agent-mcp-filter");

    it("first entry calls echo (the only enabled tool)", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("echo");
      expect(toolUses[0].input).toEqual({ text: "filter-test" });
    });

    it("has correct token counts across both entries", () => {
      const usage0 = getUsage(fixture.entries[0]);
      const usage1 = getUsage(fixture.entries[1]);
      expect(usage0.input_tokens).toBe(130);
      expect(usage0.output_tokens).toBe(42);
      expect(usage1.input_tokens).toBe(185);
      expect(usage1.output_tokens).toBe(32);
    });

    it("second entry references filter-test in response", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts[0].text).toContain("filter-test");
    });
  });

  describe("agent-mcp-env", () => {
    const fixture = loadFixture("agent-mcp-env");

    it("first entry calls echo with env-resolved input", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("echo");
      expect(toolUses[0].input).toEqual({ text: "env-resolved" });
    });

    it("second entry confirms environment resolution", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts[0].text).toContain("env-resolved");
    });

    it("replays through callLlmAction with token counting", async () => {
      const interceptor = new ReplayFetchInterceptor("agent-mcp-env", { fixturesDir: FIXTURES_DIR });
      interceptor.install();
      try {
        const first = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Use echo with env var", max_tokens: 200 },
          {},
          "exec-mcp-env",
        );
        expect(first.input_tokens).toBe(140);
        expect(first.output_tokens).toBe(38);

        const second = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Tool result: env-resolved", max_tokens: 200 },
          {},
          "exec-mcp-env",
        );
        expect(second.result).toContain("env-resolved");
        expect(interceptor.allConsumed).toBe(true);
      } finally {
        interceptor.uninstall();
      }
    });
  });
});

describe("deterministic HITL approval flow fixtures", () => {
  beforeEach(() => {
    process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.stigmer.ai";
    process.env.STIGMER_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.STIGMER_PROXY_ENDPOINT;
    delete process.env.STIGMER_TOKEN;
    Object.assign(process.env, originalEnv);
  });

  describe("agent-hitl-approve", () => {
    const fixture = loadFixture("agent-hitl-approve");

    it("has two entries (pre-approval tool call + post-approval response)", () => {
      expect(fixture.entries).toHaveLength(2);
    });

    it("first entry contains a tool_use requiring approval", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("echo");
      expect(toolUses[0].input).toEqual({ text: "hello-hitl" });
      expect(toolUses[0].id).toBe("toolu_hitl_01");
    });

    it("first entry has stop_reason=tool_use", () => {
      const body = fixture.entries[0].response.body as Record<string, unknown>;
      expect(body.stop_reason).toBe("tool_use");
    });

    it("second entry has the post-approval final text", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts).toHaveLength(1);
      expect(texts[0].text).toContain("approved");
      expect(texts[0].text).toContain("hello-hitl");
    });

    it("second entry has stop_reason=end_turn", () => {
      const body = fixture.entries[1].response.body as Record<string, unknown>;
      expect(body.stop_reason).toBe("end_turn");
    });

    it("replays full approval flow through callLlmAction", async () => {
      const interceptor = new ReplayFetchInterceptor("agent-hitl-approve", { fixturesDir: FIXTURES_DIR });
      interceptor.install();
      try {
        // Turn 1: LLM decides to call a tool (requires approval)
        const preApproval = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Call the echo tool", max_tokens: 200 },
          {},
          "exec-hitl-approve",
        );
        expect(preApproval.result).toBe("");
        expect(preApproval.input_tokens).toBe(150);
        expect(preApproval.output_tokens).toBe(48);

        // Turn 2: after approval + tool execution, LLM produces final text
        const postApproval = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Tool result: hello-hitl", max_tokens: 200 },
          {},
          "exec-hitl-approve",
        );
        expect(postApproval.result).toContain("hello-hitl");
        expect(postApproval.result).toContain("approved");
        expect(postApproval.input_tokens).toBe(210);

        expect(interceptor.allConsumed).toBe(true);
      } finally {
        interceptor.uninstall();
      }
    });
  });

  describe("agent-hitl-auto-approve", () => {
    const fixture = loadFixture("agent-hitl-auto-approve");

    it("first entry contains tool_use for auto-approved tool", () => {
      const toolUses = extractToolUseBlocks(fixture.entries[0]);
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].name).toBe("echo");
      expect(toolUses[0].input).toEqual({ text: "auto-approved" });
    });

    it("second entry confirms auto-approval in text", () => {
      const texts = extractTextBlocks(fixture.entries[1]);
      expect(texts[0].text).toContain("auto-approved");
    });

    it("has shorter gap between entries (no human wait)", () => {
      const t0 = new Date(fixture.entries[0].timestamp).getTime();
      const t1 = new Date(fixture.entries[1].timestamp).getTime();
      expect(t1 - t0).toBeLessThan(2000);
    });

    it("replays through callLlmAction", async () => {
      const interceptor = new ReplayFetchInterceptor("agent-hitl-auto-approve", { fixturesDir: FIXTURES_DIR });
      interceptor.install();
      try {
        const first = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Call the echo tool", max_tokens: 200 },
          {},
          "exec-hitl-auto",
        );
        expect(first.result).toBe("");
        expect(first.provider).toBe("anthropic");

        const second = await callLlmAction(
          { model: "claude-sonnet-4-6", prompt: "Tool result: auto-approved", max_tokens: 200 },
          {},
          "exec-hitl-auto",
        );
        expect(second.result).toContain("auto-approved");
        expect(interceptor.allConsumed).toBe(true);
      } finally {
        interceptor.uninstall();
      }
    });
  });
});

describe("fixture structural integrity", () => {
  const fixtureNames = [
    "agent-mcp-echo",
    "agent-mcp-fail",
    "agent-mcp-filter",
    "agent-mcp-env",
    "agent-hitl-approve",
    "agent-hitl-auto-approve",
  ];

  for (const name of fixtureNames) {
    describe(name, () => {
      const fixture = loadFixture(name);

      it("has valid FixtureFile structure", () => {
        expect(fixture.name).toBe(name);
        expect(fixture.recordedAt).toBeTruthy();
        expect(fixture.entries).toBeInstanceOf(Array);
        expect(fixture.entries.length).toBeGreaterThanOrEqual(2);
      });

      it("all entries have sequential indices", () => {
        fixture.entries.forEach((entry, i) => {
          expect(entry.index).toBe(i);
        });
      });

      it("all entries have 200 status responses", () => {
        for (const entry of fixture.entries) {
          expect(entry.response.status).toBe(200);
          expect(entry.response.headers["content-type"]).toBe("application/json");
        }
      });

      it("all response bodies have Anthropic message structure", () => {
        for (const entry of fixture.entries) {
          const body = entry.response.body as Record<string, unknown>;
          expect(body.type).toBe("message");
          expect(body.role).toBe("assistant");
          expect(body.model).toBeTruthy();
          expect(body.content).toBeInstanceOf(Array);
          expect(body.usage).toBeDefined();
          expect(body.stop_reason).toBeTruthy();
        }
      });

      it("first entry is a tool_use response", () => {
        const body = fixture.entries[0].response.body as Record<string, unknown>;
        expect(body.stop_reason).toBe("tool_use");
        const content = body.content as Array<Record<string, unknown>>;
        const toolUse = content.find((c) => c.type === "tool_use");
        expect(toolUse).toBeDefined();
        expect(toolUse!.id).toBeTruthy();
        expect(toolUse!.name).toBeTruthy();
        expect(toolUse!.input).toBeDefined();
      });

      it("last entry is a text end_turn response", () => {
        const lastEntry = fixture.entries[fixture.entries.length - 1];
        const body = lastEntry.response.body as Record<string, unknown>;
        expect(body.stop_reason).toBe("end_turn");
        const content = body.content as Array<Record<string, unknown>>;
        const text = content.find((c) => c.type === "text");
        expect(text).toBeDefined();
        expect(typeof text!.text).toBe("string");
        expect((text!.text as string).length).toBeGreaterThan(0);
      });
    });
  }
});
