/**
 * What the agents running on this computer are doing, as one state.
 *
 * The desktop app runs agents in an embedded runner, a process it starts
 * the first time a conversation opens. The person needs to know whether that
 * process is up, and to be told when it has stopped, because a conversation
 * on a stopped runner waits for nothing. {@link runnerStateOf} folds the
 * facts the runner hook keeps into one state; {@link runnerStatusLine} says
 * it in words for the sidebar's row. Both are pure, so every state is tested
 * without a runner.
 */

/** The runner's state, as the sidebar shows it. */
export type RunnerState =
  /** Not started yet: it starts when a conversation opens. */
  | { readonly kind: "idle" }
  /** Starting, or starting again after Restart. */
  | { readonly kind: "starting" }
  /** Up; `conversations` is how many it is holding. */
  | { readonly kind: "ready"; readonly conversations: number }
  /** It was up and is gone, with no stop asked for. */
  | { readonly kind: "stopped" }
  /** The last start failed; `reason` is the host's sentence. */
  | { readonly kind: "failed"; readonly reason: string };

/** The facts the runner hook keeps. */
export interface RunnerFacts {
  readonly isRunning: boolean;
  readonly isStarting: boolean;
  /** True once a status read finds the runner gone that was up. */
  readonly stoppedUnexpectedly: boolean;
  /** The last start's failure, cleared by the next start. */
  readonly error: string | null;
  readonly activeSessions: readonly string[];
}

/**
 * The one state the facts make. A start in progress wins over everything,
 * so Restart shows at once; a failed start wins over an older stop.
 */
export function runnerStateOf(facts: RunnerFacts): RunnerState {
  if (facts.isStarting) return { kind: "starting" };
  if (facts.isRunning) return { kind: "ready", conversations: facts.activeSessions.length };
  if (facts.error !== null) return { kind: "failed", reason: facts.error };
  if (facts.stoppedUnexpectedly) return { kind: "stopped" };
  return { kind: "idle" };
}

/** The sidebar row's words, its tone, and the act it offers. */
export interface RunnerStatusLine {
  /** The state in a few words. */
  readonly label: string;
  /** A second line: why a start failed. */
  readonly detail?: string;
  /** `quiet` before anything runs, `live` while it does, `alert` when it stopped or failed. */
  readonly tone: "quiet" | "live" | "alert";
  /** The button's words, when the person can do something. */
  readonly action?: "Restart" | "Try again";
}

/** The state in the person's words. */
export function runnerStatusLine(state: RunnerState): RunnerStatusLine {
  switch (state.kind) {
    case "idle":
      return { label: "Agents start with a conversation", tone: "quiet" };
    case "starting":
      return { label: "Starting agents…", tone: "quiet" };
    case "ready":
      return {
        label:
          state.conversations === 0
            ? "Agents ready"
            : `Agents working on ${state.conversations} ${state.conversations === 1 ? "conversation" : "conversations"}`,
        tone: "live",
      };
    case "stopped":
      return { label: "Agents stopped", tone: "alert", action: "Restart" };
    case "failed":
      return { label: "Agents couldn't start", detail: state.reason, tone: "alert", action: "Try again" };
  }
}
