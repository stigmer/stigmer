/**
 * The compaction middleware (`middleware/compaction.ts`) around deepagents'
 * own summarizer, driven call by call with a recording model and handler:
 *
 *  - it replaces deepagents' summarizer by name and carries its state;
 *  - the summary call runs on the request's own model, tagged `nostream`,
 *    and the call deepagents makes next runs on that model untagged;
 *  - each summary is said on the custom stream once, before that call, with
 *    the summary's usage; a call that summarizes nothing says nothing;
 *  - deepagents' re-summary after an overflow is a second summary, said
 *    twice in all;
 *  - the summarizer's profile is the model's window: what was recorded for
 *    it (`shared/model-window.ts`), else its own profile, else nothing, so
 *    deepagents sizes its trigger against it and otherwise takes its own
 *    fallback.
 *
 * The full graph, its stream and the transcript are the contract kit's
 * (`__test-utils__/harness-contract/runtime-contract.ts`, the three
 * compactions arm, on the native subject).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { ContextOverflowError } from "@langchain/core/errors";
import type { RunnableConfig } from "@langchain/core/runnables";
import { FilesystemBackend } from "deepagents";

import { CONTEXT_COMPACTED_EVENT, createCompactionMiddleware, type ContextCompactedPayload } from "../compaction.js";
import { recordModelWindow } from "../../shared/model-window.js";

type CompactionMiddleware = ReturnType<typeof createCompactionMiddleware>;
type WrapModelCall = NonNullable<CompactionMiddleware["wrapModelCall"]>;
type ModelRequest = Parameters<WrapModelCall>[0];
type Handler = Parameters<WrapModelCall>[1];

const SUMMARY_USAGE = { input_tokens: 500, output_tokens: 20, total_tokens: 520 };

/** The agent's model: answers deepagents' summary prompt, records how each call was tagged. */
class RecordingModel {
  readonly calls: Array<{ readonly summary: boolean; readonly tags: readonly string[] }> = [];

  constructor(readonly profile: { maxInputTokens?: number } = {}) {}

  async invoke(input: BaseMessage[], options?: Partial<RunnableConfig>): Promise<AIMessage> {
    const summary = input.length === 1 && HumanMessage.isInstance(input[0]) && input[0].text.startsWith("You are a conversation summarizer.");
    this.calls.push({ summary, tags: options?.tags ?? [] });
    return new AIMessage({ content: summary ? "the conversation, condensed" : "a reply", usage_metadata: SUMMARY_USAGE });
  }
}

/** A conversation of about 1,500 tokens whose last message is short: past 0.85 of a 1,000-token window, with a tail inside 0.1 of it. */
function longConversation(): BaseMessage[] {
  return [new HumanMessage("a".repeat(3_000)), new AIMessage("b".repeat(3_000)), new HumanMessage("and now?")];
}

describe("createCompactionMiddleware", () => {
  let dir: string;
  let written: ContextCompactedPayload[];
  let handled: Array<{ readonly model: unknown; readonly messages: readonly BaseMessage[] }>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "compaction-"));
    written = [];
    handled = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function middleware(): CompactionMiddleware {
    return createCompactionMiddleware({ backend: new FilesystemBackend({ rootDir: dir, virtualMode: true }) });
  }

  function request(model: RecordingModel, messages: BaseMessage[]): ModelRequest {
    return {
      model,
      messages,
      systemMessage: new SystemMessage("You are the agent."),
      tools: [],
      state: { messages },
      runtime: { writer: (chunk: ContextCompactedPayload) => written.push(chunk) },
    } as unknown as ModelRequest;
  }

  /** The real handler's stand-in: records what reaches the model and answers, or throws `fail` first. */
  function handler(fail: Error[] = []): Handler {
    return (async (req: ModelRequest) => {
      handled.push({ model: req.model, messages: req.messages });
      const error = fail.shift();
      if (error) throw error;
      return new AIMessage("a reply");
    }) as unknown as Handler;
  }

  it("replaces deepagents' summarizer by its name and keeps its state", () => {
    const mw = middleware();
    expect(mw.name).toBe("SummarizationMiddleware");
    expect(mw.stateSchema).toBeDefined();
  });

  it("summarizes on the request's own model off the stream, then calls that model untagged, telling the stream once with the summary's usage", async () => {
    const model = new RecordingModel({ maxInputTokens: 1_000 });
    await middleware().wrapModelCall!(request(model, longConversation()), handler());

    expect(model.calls, "one summary call, tagged nostream").toEqual([{ summary: true, tags: ["nostream"] }]);
    expect(handled).toHaveLength(1);
    expect(handled[0]!.model, "the call after it runs on the agent's model").toBe(model);
    expect(written).toEqual([{ name: CONTEXT_COMPACTED_EVENT, usage: SUMMARY_USAGE }]);
  });

  it("says nothing on a call that summarizes nothing", async () => {
    const model = new RecordingModel({ maxInputTokens: 1_000_000 });
    await middleware().wrapModelCall!(request(model, longConversation()), handler());

    expect(model.calls).toEqual([]);
    expect(handled).toHaveLength(1);
    expect(handled[0]!.model).toBe(model);
    expect(written).toEqual([]);
  });

  it("says a re-summary after an overflow as a second summary, each before the call that reads it", async () => {
    const model = new RecordingModel({ maxInputTokens: 1_000 });
    const writtenAtCall: number[] = [];
    const counting: Handler = (async (req: ModelRequest) => {
      writtenAtCall.push(written.length);
      return handler(writtenAtCall.length === 1 ? [new ContextOverflowError("prompt is too long")] : [])(req);
    }) as unknown as Handler;
    await middleware().wrapModelCall!(request(model, longConversation()), counting);

    expect(model.calls.filter((c) => c.summary)).toHaveLength(2);
    expect(written).toHaveLength(2);
    expect(writtenAtCall, "each summary is said before the call that reads it").toEqual([1, 2]);
    for (const call of handled) expect(call.model).toBe(model);
  });

  it("sizes deepagents' trigger by the model's window: the one recorded for it, else its own profile, else deepagents' fallback", async () => {
    // Recorded: a model built under a provider's rewritten id has an empty profile; the window comes from its first-party id.
    const rewritten = new RecordingModel({});
    recordModelWindow(rewritten as never, { provider: "anthropic", apiModelId: "claude-haiku-4-5-20251001", catalogTokens: undefined });
    const nearHaikusWindow = [new HumanMessage("a".repeat(400_000)), new AIMessage("b".repeat(300_000)), new HumanMessage("and now?")];
    await middleware().wrapModelCall!(request(rewritten, nearHaikusWindow), handler());
    expect(rewritten.calls.filter((c) => c.summary), "about 175,000 tokens is past 0.85 of 200,000").toHaveLength(1);

    // Unrecorded and unsized: deepagents' own fallback (170,000 tokens), which the long conversation is far below.
    const unsized = new RecordingModel({});
    await middleware().wrapModelCall!(request(unsized, longConversation()), handler());
    expect(unsized.calls).toEqual([]);
  });
});
