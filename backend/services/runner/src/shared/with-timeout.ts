/**
 * Bounded await for external calls that provide no timeout of their own.
 *
 * Exists because a hang is strictly worse than a failure: an unbounded await
 * inside a Temporal activity emits no heartbeats and no diagnostics, so it
 * surfaces minutes later as an opaque "Activity task timed out" instead of an
 * actionable error. Born from the Cursor BiDi proxy incident where a
 * silently-dead upstream connection left `Agent.create()` waiting forever
 * (see activities/execute-cursor/index.ts, agent-resolution phase).
 *
 * Scope: this bounds the WAIT, not the work — `fn`'s promise is not cancelled
 * on expiry (the Cursor SDK and most clients expose no abort for these calls).
 * The orphaned promise settles into the void; activity teardown and process
 * lifecycle own any residual cleanup. Callers that can abort should prefer
 * `AbortSignal.timeout` and pass the signal to the callee instead.
 */

export async function withTimeout<T>(
  ms: number,
  timeoutMessage: string | (() => string),
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const message = typeof timeoutMessage === "function" ? timeoutMessage() : timeoutMessage;
      reject(new Error(message));
    }, ms);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
