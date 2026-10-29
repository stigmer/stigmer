/**
 * Compaction middleware — the Stigmer harness's summarizer, deepagents' own
 * (`createSummarizationMiddleware`, 1.14.1) with three things it never did:
 * the person is told, the summary never speaks as the agent, and the summary
 * is a checkpoint that carries the goal.
 *
 * Why a wrapper and not a new engine: deepagents decides when to compact,
 * what to keep, where the history goes and how to recover from an overflow,
 * and every graph already carries it (the parent's stack, every sub-agent's,
 * the general-purpose one). This middleware is named like it
 * (`SummarizationMiddleware`), so `createDeepAgent` swaps it in place in each
 * stack it is handed to (`mergeMiddlewareStack`), and it hands the real
 * middleware every call. Its numbers stay deepagents'.
 *
 * What the summarizer is asked is the runner's: deepagents' default prompt
 * asked for a recap ("the main topics discussed"), and after the first
 * compaction the person's opening message lives only in the summary, so a
 * recap that drops the remaining steps or the closing instruction loses the
 * goal for the rest of the turn (stigmer#2539). The middleware passes the
 * checkpoint prompt (`compaction-prompt.ts`, which says why its words and
 * their order are what they are) as deepagents' own `summaryPrompt` option.
 *
 * What it changes in each call, all inside one `wrapModelCall`:
 *
 *  - The model the summarizer sees is a summarizer runnable over the
 *    request's own model. Its summary call carries LangGraph's `nostream`
 *    tag, so the graph's messages stream never registers it
 *    (`@langchain/langgraph` `pregel/messages-v2.js`). Before, the stream
 *    emitted the summary's final message and the Stigmer harness's translator wrote it
 *    as an `agent.message`: in long runs the turn's "reply" was the
 *    summarizer's text. The handler deepagents calls next is handed the
 *    request's model back, so only the summary runs untagged from the stream.
 *  - The runnable states the model's window as its `profile`
 *    (`shared/model-window.ts` `windowOf`, recorded for the model by the
 *    turn's model builder), read on every call, so deepagents sizes its
 *    trigger and what it keeps against the model's real window, never the
 *    profile of the id the model was built with, which falls back to a fixed
 *    170,000 tokens for a provider's rewritten id. With no window, the
 *    profile is empty and deepagents' own fallback applies.
 *  - Each summary the runnable answered is said on the graph's custom
 *    stream ({@link CONTEXT_COMPACTED_EVENT}, through the runtime's writer)
 *    just before deepagents' next call to the model, so the marker lands
 *    ahead of the first reply that read the summary. It carries the
 *    summary's token usage: the stream does not show the call, and the
 *    Stigmer harness's loop's one usage writer reads it from this event instead
 *    (`execute-deep-agent/translator.ts` `usageOf`). One event per summary
 *    call: deepagents' re-summary after an overflow is a second one.
 *
 * A marker means "the summarizer ran and was billed". deepagents records a
 * compaction in the graph's state only when the call after it returns, so a
 * stop or drain landing in that one call leaves the compaction unrecorded,
 * and the continued turn summarizes again and shows a second marker, which
 * is what happened.
 */

import { isAIMessage, type UsageMetadata } from "@langchain/core/messages";
import type { BaseLanguageModelInput, LanguageModelOutput } from "@langchain/core/language_models/base";
import type { ModelProfile } from "@langchain/core/language_models/profile";
import { Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { createSummarizationMiddleware, type AnyBackendProtocol } from "deepagents";

import { windowOf } from "../shared/model-window.js";
import { SUMMARY_PROMPT } from "./compaction-prompt.js";
import { customStreamWriterOf } from "./tool-scope.js";

/** The custom-stream event of one summary: the Stigmer harness's translator folds it into a compaction row, the loop prices its usage. */
export const CONTEXT_COMPACTED_EVENT = "stigmer.context_compacted";

/** What {@link CONTEXT_COMPACTED_EVENT} carries: the summary call's usage, when the model reported one. */
export interface ContextCompactedPayload {
  readonly name: typeof CONTEXT_COMPACTED_EVENT;
  readonly usage?: UsageMetadata;
}

/** LangGraph's tag for a model run its messages stream does not show. */
const NOSTREAM_TAG = "nostream";

export interface CompactionConfig {
  /** The graph's backend, where deepagents offloads the summarized history (`platform-route.ts` routes it out of the workspace). */
  readonly backend: AnyBackendProtocol;
}

type SummarizationMiddleware = ReturnType<typeof createSummarizationMiddleware>;
type WrapModelCall = NonNullable<SummarizationMiddleware["wrapModelCall"]>;
type AgentModel = Parameters<WrapModelCall>[0]["model"];

/** The request's own model, as deepagents' summarizer sees it: summary calls kept off the stream, the window as its profile. */
class Summarizer extends Runnable<BaseLanguageModelInput, LanguageModelOutput> {
  lc_namespace = ["stigmer", "middleware", "compaction"];

  constructor(
    private readonly model: AgentModel,
    private readonly onSummary: (usage: UsageMetadata | undefined) => void,
  ) {
    super();
  }

  /** What deepagents reads to size its trigger: the model's window, or nothing (its fallback). */
  get profile(): ModelProfile {
    const tokens = windowOf(this.model);
    return tokens === undefined ? {} : { maxInputTokens: tokens };
  }

  async invoke(input: BaseLanguageModelInput, options?: Partial<RunnableConfig>): Promise<LanguageModelOutput> {
    const reply = await this.model.invoke(input, { ...options, tags: [...(options?.tags ?? []), NOSTREAM_TAG] });
    this.onSummary(typeof reply !== "string" && isAIMessage(reply) ? reply.usage_metadata : undefined);
    return reply;
  }
}

/** deepagents' summarizer under its own name, asking for the runner's checkpoint, telling the stream of each summary and keeping the summary off it (the header). */
export function createCompactionMiddleware(config: CompactionConfig): SummarizationMiddleware {
  const summarization = createSummarizationMiddleware({ backend: config.backend, summaryPrompt: SUMMARY_PROMPT });
  // deepagents' summarizer is a `wrapModelCall` middleware and nothing else.
  const summarize = summarization.wrapModelCall!;
  const wrapModelCall: WrapModelCall = (request, handler) => {
    const model = request.model;
    const summaries: Array<UsageMetadata | undefined> = [];
    const write = customStreamWriterOf<ContextCompactedPayload>(request.runtime);
    const summarizer = new Summarizer(model, (usage) => summaries.push(usage));
    return summarize({ ...request, model: summarizer }, (next) => {
      for (const usage of summaries.splice(0)) write?.({ name: CONTEXT_COMPACTED_EVENT, ...(usage ? { usage } : {}) });
      return handler({ ...next, model });
    });
  };
  return { ...summarization, wrapModelCall };
}
