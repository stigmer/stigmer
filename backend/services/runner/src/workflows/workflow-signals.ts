/**
 * Shared pause/resume signal definitions and handler setup for
 * workflow execution. Used by both the hydration wrapper
 * ("stigmer/workflow/execute-from-execution") and the direct
 * invocation path ("stigmer/workflow/execute").
 *
 * The Java/Go orchestrators forward pause and resume signals to
 * the child workflow. The engine checks a `checkPause` callback
 * at yield points between tasks; when paused, the workflow blocks
 * on `condition(() => !paused)` — alive but idle.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. Only @temporalio/workflow APIs and pure TS logic.
 */

import { defineSignal, setHandler, condition, log } from "@temporalio/workflow";

export const pauseSignal = defineSignal<[string]>("pause");
export const resumeSignal = defineSignal("resume");

export interface PauseResumeHandlers {
  readonly checkPause: () => Promise<void>;
}

/**
 * Registers pause and resume signal handlers on the current workflow
 * and returns a `checkPause` callback suitable for threading into the
 * engine's `TaskExecutionContext`.
 *
 * Must be called at workflow start, before any async work. Temporal
 * requires signal handlers to be registered synchronously at the top
 * of the workflow function.
 */
export function setupPauseResumeHandlers(): PauseResumeHandlers {
  let paused = false;

  setHandler(pauseSignal, (reason: string) => {
    log.info("Pause signal received", { reason });
    paused = true;
  });

  setHandler(resumeSignal, () => {
    log.info("Resume signal received");
    paused = false;
  });

  const checkPause = async (): Promise<void> => {
    if (!paused) return;
    log.info("Engine paused at task boundary, waiting for resume signal");
    await condition(() => !paused);
    log.info("Engine resumed, continuing execution");
  };

  return { checkPause };
}
