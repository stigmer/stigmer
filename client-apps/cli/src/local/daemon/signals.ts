// The local stack's stop request: SIGTERM or SIGINT, turned into an
// AbortSignal the moment it is armed (the idiom of `runs logs` and
// `mcp-server`).
//
// It lives apart from the daemon body so `internal-daemon` can arm it as its
// first act, before it imports anything heavy: a SIGTERM that arrives before
// the handlers exist meets Node's default handler, which exits at once and
// orphans every child already started (stigmer#1175). It installs `once`
// handlers, so a second signal during the teardown still ends the process,
// the conventional "press Ctrl-C again to force".

/** Arm the stop request: aborted on the first SIGTERM or SIGINT from now on. */
export function shutdownOnSignals(): AbortSignal {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return controller.signal;
}
