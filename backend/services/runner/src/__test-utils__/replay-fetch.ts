/**
 * ReplayFetchInterceptor — record and replay HTTP request/response pairs
 * for deterministic offline testing of LLM-dependent code paths.
 *
 * Two modes:
 * - RECORD: wraps globalThis.fetch, forwards requests to real endpoints,
 *   captures request/response pairs, and writes them to a fixture file.
 * - REPLAY (default): replaces globalThis.fetch with a sequentially-ordered
 *   matcher that returns recorded responses without network access.
 *
 * Fixture format: ordered JSON array of {request, response} entries.
 * Responses are returned in order — matching the sequential nature of
 * LLM conversations (turn 1 → tool call → tool result → turn 2).
 *
 * Usage:
 *   const interceptor = new ReplayFetchInterceptor("my-test");
 *   interceptor.install();
 *   // ... run code that calls fetch() ...
 *   interceptor.uninstall();
 *
 * Record mode (env): RECORD_FIXTURES=1 npm test
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = join(__dirname, "../../test/fixtures/recorded-responses");

// ─── Types ───────────────────────────────────────────────────────────────

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface RecordedEntry {
  index: number;
  timestamp: string;
  request: RecordedRequest;
  response: RecordedResponse;
  durationMs: number;
}

export interface FixtureFile {
  name: string;
  recordedAt: string;
  entries: RecordedEntry[];
}

// ─── URL Filter ──────────────────────────────────────────────────────────

/**
 * Determines whether a URL should be intercepted.
 * Only LLM proxy/API calls are captured — not MCP stdio or other traffic.
 */
function isLlmApiUrl(url: string): boolean {
  const llmPatterns = [
    "/v1/proxy/llm/",
    "/chat/completions",
    "/v1/messages",
    "/v1/completions",
  ];
  return llmPatterns.some((p) => url.includes(p));
}

// ─── Streaming (SSE) Synthesis ─────────────────────────────────────────────
//
// The runner's `call-llm` activity invokes LangChain's `model.stream()` for
// plain (non-structured) completions so the proxy's SSE usage extractors can
// meter the request. A streaming request expects a `text/event-stream`
// response, not a single JSON body. Recorded fixtures store the *logical*
// (non-streaming) provider response; when the captured request was a streaming
// one we re-emit that body as the equivalent SSE event sequence so the
// LangChain client parses content and token usage exactly as it would against
// a live provider. Structured-output requests use `invoke()` (non-streaming)
// and keep the JSON body unchanged.

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function requestIsStreaming(init?: RequestInit): boolean {
  if (!init?.body) return false;
  try {
    const raw = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.stream === true;
  } catch {
    return false;
  }
}

function toAnthropicSSE(body: Record<string, unknown>): string {
  const usage = (body.usage as Record<string, number> | undefined) ?? {};
  const content = Array.isArray(body.content) ? (body.content as Array<Record<string, unknown>>) : [];
  const parts: string[] = [];

  parts.push(sseEvent("message_start", {
    type: "message_start",
    message: {
      id: body.id ?? "msg_replay",
      type: "message",
      role: "assistant",
      model: body.model ?? "claude-sonnet-4-6",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: 0 },
    },
  }));

  content.forEach((block, index) => {
    if (block.type === "text") {
      parts.push(sseEvent("content_block_start", {
        type: "content_block_start", index, content_block: { type: "text", text: "" },
      }));
      parts.push(sseEvent("content_block_delta", {
        type: "content_block_delta", index, delta: { type: "text_delta", text: String(block.text ?? "") },
      }));
      parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
    } else if (block.type === "tool_use") {
      parts.push(sseEvent("content_block_start", {
        type: "content_block_start", index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      }));
      parts.push(sseEvent("content_block_delta", {
        type: "content_block_delta", index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      }));
      parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
    }
  });

  parts.push(sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: body.stop_reason ?? "end_turn", stop_sequence: null },
    usage: { output_tokens: usage.output_tokens ?? 0 },
  }));
  parts.push(sseEvent("message_stop", { type: "message_stop" }));

  return parts.join("");
}

function toOpenAISSE(body: Record<string, unknown>): string {
  const choices = Array.isArray(body.choices) ? (body.choices as Array<Record<string, unknown>>) : [];
  const choice = choices[0] ?? {};
  const message = (choice.message as Record<string, unknown> | undefined) ?? {};
  const text = typeof message.content === "string" ? message.content : "";
  const parts: string[] = [];

  parts.push(`data: ${JSON.stringify({
    id: body.id ?? "chatcmpl-replay",
    object: "chat.completion.chunk",
    model: body.model ?? "gpt-4o",
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  })}\n\n`);
  parts.push(`data: ${JSON.stringify({
    id: body.id ?? "chatcmpl-replay",
    object: "chat.completion.chunk",
    model: body.model ?? "gpt-4o",
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }],
    usage: body.usage ?? null,
  })}\n\n`);
  parts.push("data: [DONE]\n\n");

  return parts.join("");
}

function synthesizeStreamingResponse(
  responseBody: unknown,
  responseInit: { status: number; statusText: string; headers: Record<string, string> },
): Response | null {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as Record<string, unknown>;

  let sse: string | null = null;
  if (body.type === "message" || Array.isArray(body.content)) {
    sse = toAnthropicSSE(body);
  } else if (body.object === "chat.completion" || Array.isArray(body.choices)) {
    sse = toOpenAISSE(body);
  }
  if (sse === null) return null;

  return new Response(sse, {
    status: responseInit.status,
    statusText: responseInit.statusText,
    headers: new Headers({ ...responseInit.headers, "content-type": "text/event-stream" }),
  });
}

// ─── Interceptor ─────────────────────────────────────────────────────────

export class ReplayFetchInterceptor {
  private originalFetch: typeof globalThis.fetch;
  private entries: RecordedEntry[] = [];
  private replayIndex = 0;
  private readonly fixturePath: string;
  private readonly isRecordMode: boolean;
  private installed = false;

  constructor(
    fixtureName: string,
    options?: {
      fixturesDir?: string;
      forceRecord?: boolean;
    },
  ) {
    const dir = options?.fixturesDir ?? DEFAULT_FIXTURES_DIR;
    this.fixturePath = join(dir, `${fixtureName}.json`);
    this.isRecordMode = options?.forceRecord ?? process.env.RECORD_FIXTURES === "1";
    this.originalFetch = globalThis.fetch;
  }

  /**
   * Install the interceptor, replacing globalThis.fetch.
   * In record mode, loads existing fixtures to append to.
   * In replay mode, loads the fixture file for sequential playback.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.originalFetch = globalThis.fetch;

    if (this.isRecordMode) {
      this.entries = [];
      globalThis.fetch = this.recordingFetch.bind(this) as typeof globalThis.fetch;
    } else {
      this.loadFixture();
      this.replayIndex = 0;
      globalThis.fetch = this.replayingFetch.bind(this) as typeof globalThis.fetch;
    }
  }

  /**
   * Uninstall the interceptor and restore the original fetch.
   * In record mode, writes captured entries to the fixture file.
   */
  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    globalThis.fetch = this.originalFetch;

    if (this.isRecordMode && this.entries.length > 0) {
      this.saveFixture();
    }
  }

  /** Number of entries recorded or available for replay. */
  get entryCount(): number {
    return this.entries.length;
  }

  /** How many replay entries have been consumed. */
  get consumedCount(): number {
    return this.replayIndex;
  }

  /** Whether all recorded entries have been consumed during replay. */
  get allConsumed(): boolean {
    return this.replayIndex >= this.entries.length;
  }

  // ─── Recording ─────────────────────────────────────────────────────

  private async recordingFetch(
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (!isLlmApiUrl(url)) {
      return this.originalFetch(input, init);
    }

    let requestBody: unknown = null;
    if (init?.body) {
      try {
        requestBody = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer));
      } catch {
        requestBody = String(init.body);
      }
    }

    const requestHeaders: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers as Record<string, string>);
      h.forEach((v, k) => {
        if (k.toLowerCase() !== "authorization" && k.toLowerCase() !== "x-api-key") {
          requestHeaders[k] = v;
        } else {
          requestHeaders[k] = "[REDACTED]";
        }
      });
    }

    const recorded: RecordedRequest = {
      method: init?.method ?? "POST",
      url,
      headers: requestHeaders,
      body: requestBody,
    };

    const start = Date.now();
    const response = await this.originalFetch(input, init);
    const durationMs = Date.now() - start;

    const responseBody = await response.clone().json().catch(() => response.clone().text());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    this.entries.push({
      index: this.entries.length,
      timestamp: new Date().toISOString(),
      request: recorded,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
      },
      durationMs,
    });

    return response;
  }

  // ─── Replay ────────────────────────────────────────────────────────

  private async replayingFetch(
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (!isLlmApiUrl(url)) {
      return this.originalFetch(input, init);
    }

    if (this.replayIndex >= this.entries.length) {
      throw new Error(
        `ReplayFetchInterceptor: no more recorded entries (consumed ${this.replayIndex}/${this.entries.length}). ` +
        `URL: ${url}. Re-record fixtures with RECORD_FIXTURES=1.`,
      );
    }

    const entry = this.entries[this.replayIndex++];
    const { response } = entry;

    if (response.status === 200 && requestIsStreaming(init)) {
      const streamed = synthesizeStreamingResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      if (streamed) return streamed;
    }

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }

  // ─── Fixture I/O ───────────────────────────────────────────────────

  private loadFixture(): void {
    if (!existsSync(this.fixturePath)) {
      throw new Error(
        `ReplayFetchInterceptor: fixture not found at ${this.fixturePath}. ` +
        `Record fixtures first with RECORD_FIXTURES=1.`,
      );
    }

    const raw = readFileSync(this.fixturePath, "utf-8");
    const fixture: FixtureFile = JSON.parse(raw);
    this.entries = fixture.entries;
  }

  private saveFixture(): void {
    const dir = dirname(this.fixturePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const fixture: FixtureFile = {
      name: this.fixturePath.split("/").pop()?.replace(".json", "") ?? "unknown",
      recordedAt: new Date().toISOString(),
      entries: this.entries,
    };

    writeFileSync(this.fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
  }
}

// ─── Convenience helpers ─────────────────────────────────────────────────

/**
 * Create a fixture file programmatically from handcrafted entries.
 * Useful when you don't want to record from a live provider but
 * instead construct the expected LLM responses manually.
 */
export function writeFixture(
  fixtureName: string,
  entries: Array<{ request: Partial<RecordedRequest>; response: Partial<RecordedResponse> }>,
  fixturesDir = DEFAULT_FIXTURES_DIR,
): string {
  const path = join(fixturesDir, `${fixtureName}.json`);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fixture: FixtureFile = {
    name: fixtureName,
    recordedAt: new Date().toISOString(),
    entries: entries.map((e, i) => ({
      index: i,
      timestamp: new Date().toISOString(),
      request: {
        method: "POST",
        url: "",
        headers: {},
        body: null,
        ...e.request,
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: null,
        ...e.response,
      },
      durationMs: 0,
    })),
  };

  writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
  return path;
}

/**
 * Build an Anthropic-style chat completion response body for use
 * in handcrafted fixtures.
 */
export function anthropicResponseBody(
  text: string,
  options?: {
    inputTokens?: number;
    outputTokens?: number;
    toolUse?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    stopReason?: string;
  },
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];

  if (options?.toolUse) {
    for (const tool of options.toolUse) {
      content.push({ type: "tool_use", id: tool.id, name: tool.name, input: tool.input });
    }
  }

  if (text) {
    content.push({ type: "text", text });
  }

  return {
    id: `msg_test_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content,
    stop_reason: options?.stopReason ?? (options?.toolUse ? "tool_use" : "end_turn"),
    usage: {
      input_tokens: options?.inputTokens ?? 100,
      output_tokens: options?.outputTokens ?? 50,
    },
  };
}

/**
 * Build an OpenAI-style chat completion response body for use
 * in handcrafted fixtures.
 */
export function openaiResponseBody(
  text: string,
  options?: {
    promptTokens?: number;
    completionTokens?: number;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  },
): Record<string, unknown> {
  const message: Record<string, unknown> = { role: "assistant", content: text };

  if (options?.toolCalls) {
    message.tool_calls = options.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }

  return {
    id: `chatcmpl-test-${Date.now()}`,
    object: "chat.completion",
    model: "gpt-4o",
    choices: [{ index: 0, message, finish_reason: options?.toolCalls ? "tool_calls" : "stop" }],
    usage: {
      prompt_tokens: options?.promptTokens ?? 100,
      completion_tokens: options?.completionTokens ?? 50,
      total_tokens: (options?.promptTokens ?? 100) + (options?.completionTokens ?? 50),
    },
  };
}
