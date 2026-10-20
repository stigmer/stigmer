/**
 * The run stamp: which run last gave the session's LangGraph thread its
 * input, kept in the thread's own state so every save carries it.
 *
 * Why: one thread serves every turn of a session (`thread-<session>`), so the
 * thread's latest save can be another run's. An invocation resumes from the
 * latest save exactly when that save is its own run's: the run was stopped
 * after its engine took the input, whether or not anything reached the
 * session's log. Otherwise its input was never saved (a new message, or a
 * run stopped before the engine took it in), and it hands the engine its
 * message, once (`turn-setup.ts` `composeGraphInput`). Production gives every
 * message its own run, so a run's stamp never meets a new task. The run's own message
 * cannot be the marker: compaction may evict it from a long run's thread.
 *
 * Why state and not the checkpoint's metadata: LangGraph 1.4.18 writes a
 * streamed checkpoint's metadata as its own source, step and parents only;
 * the run config's `metadata` never reaches it (`pregel/loop.js`
 * `_putCheckpoint`). A key in the agent's state is the framework's own way
 * to keep a fact with every save: declared by a middleware's state schema,
 * set by the message turn's input, carried by every later save of the
 * thread. The model never reads it; a sub-agent's graph declares no such
 * key and ignores it. The key is not LangGraph's `run_id`, which changes how
 * LangGraph treats matching input (`pregel/loop.js`).
 */

import { createMiddleware } from "langchain";
import { z } from "zod";

/** The state key the stamp lives under. Thread state: renaming it orphans every saved stamp. */
export const RUN_STAMP_KEY = "stigmerRunId";

/** The middleware that declares the stamp in the agent's state. */
export function createRunStampMiddleware() {
  return createMiddleware({
    name: "StigmerRunStamp",
    stateSchema: z.object({ [RUN_STAMP_KEY]: z.string().optional() }),
  });
}

/** The run the thread's latest save took its input from; `undefined` for a thread no stamped input reached. */
export function stampedRunOf(values: Readonly<Record<string, unknown>>): string | undefined {
  const stamp = values[RUN_STAMP_KEY];
  return typeof stamp === "string" ? stamp : undefined;
}
