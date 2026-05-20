/**
 * Concurrency limiter for sub-agent execution.
 *
 * Wraps sub-agent runnables with a Promise-based semaphore that
 * limits the number of concurrent sub-agent invocations. When the
 * limit is reached, new invocations are rejected immediately with
 * an error-shaped message (non-blocking) rather than queuing.
 *
 * This matches the Python `SubAgentGate` behavior: protect the
 * parent agent's resources by hard-capping concurrency, and let
 * the LLM adapt when a sub-agent cannot be started.
 */

import { RunnableLambda, type RunnableConfig } from "@langchain/core/runnables";

const DEFAULT_MAX_CONCURRENT = 3;

export interface SubAgentGateOptions {
  readonly maxConcurrent?: number;
}

export class SubAgentGate {
  private readonly max: number;
  private active = 0;

  constructor(options: SubAgentGateOptions = {}) {
    this.max = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (this.max <= 0) {
      throw new Error(`maxConcurrent must be positive, got ${this.max}`);
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get maxConcurrent(): number {
    return this.max;
  }

  get hasCapacity(): boolean {
    return this.active < this.max;
  }

  /**
   * Wrap a sub-agent's invoke function with concurrency gating.
   *
   * Returns a new function that checks capacity before invoking.
   * If no capacity, returns an error-shaped response immediately.
   */
  wrap<TInput, TOutput>(
    invoke: (input: TInput, config?: Record<string, unknown>) => Promise<TOutput>,
    name: string,
  ): (input: TInput, config?: Record<string, unknown>) => Promise<TOutput> {
    return async (input: TInput, config?: Record<string, unknown>): Promise<TOutput> => {
      if (!this.hasCapacity) {
        console.warn(
          `[SubAgentGate] Rejected '${name}': ${this.active}/${this.max} slots occupied`,
        );
        return {
          messages: [{
            role: "assistant",
            content:
              `Sub-agent '${name}' was NOT started — the maximum of ` +
              `${this.max} concurrent sub-agents are already running. ` +
              `Wait for an active sub-agent to complete before starting another, ` +
              `or proceed without this sub-agent.`,
          }],
        } as TOutput;
      }

      this.active++;
      try {
        return await invoke(input, config);
      } finally {
        this.active--;
      }
    };
  }

  /**
   * Wrap a sub-agent Runnable for use as `CompiledSubAgent.runnable`.
   *
   * Returns a `RunnableLambda` that checks capacity before delegating
   * to the underlying runnable. When at capacity, returns an error-shaped
   * response that deepagents surfaces to the parent agent as the task result.
   */
  wrapRunnable<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(
    runnable: { invoke: (input: TInput, config?: RunnableConfig) => Promise<TOutput> },
    name: string,
  ): RunnableLambda<TInput, TOutput> {
    return RunnableLambda.from(async (input: TInput, config?: RunnableConfig): Promise<TOutput> => {
      if (!this.hasCapacity) {
        console.warn(
          `[SubAgentGate] Rejected '${name}': ${this.active}/${this.max} slots occupied`,
        );
        return {
          messages: [{
            role: "assistant",
            content:
              `Sub-agent '${name}' was NOT started — the maximum of ` +
              `${this.max} concurrent sub-agents are already running. ` +
              `Wait for an active sub-agent to complete before starting another, ` +
              `or proceed without this sub-agent.`,
          }],
        } as TOutput;
      }

      this.active++;
      try {
        return await runnable.invoke(input, config);
      } finally {
        this.active--;
      }
    });
  }
}
