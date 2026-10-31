// Run an agent turn in the terminal and get control back: the call a host
// CLI makes to add agent execution in a few lines. It starts the turn
// (@stigmer/client's startTurn, the same start sendAndWait makes), renders the
// kit's SessionView on the turn's session, and resolves when that turn ends,
// with the turn's outcome and the exit code the `stigmer` CLI would use.
//
// Trade-offs:
//   - One stream. The view's own conversation tells the run when its turn
//     ended (TurnWatchContext), so a run never opens a second follow beside
//     the view's.
//   - The process is the host's. The library installs no signal handler:
//     on a terminal, Ctrl+C is the view's key (a draft is cleared first; on an
//     empty composer the view says the agent keeps working and how to come
//     back, and a second press within two seconds leaves), and a host stops
//     the wait with `signal`. Either way control returns with the turn's phase
//     at that moment and exit code 130, and the run goes on on the server.
//     Esc stops the turn, which then ends cancelled.
//   - Shift+Enter starts a new line where the terminal reports it: Ink asks
//     for the kitty keyboard protocol and goes on without it when the terminal
//     does not answer.
//   - Off a terminal (terminalMode) Ink writes the final frame once at exit,
//     prompts are inert, asks are settled by `approveDefault`, and `until:
//     "exit"` returns at the turn's end, since no one can type a follow-up.
//   - A turn that cannot start (no server, a refused key) has no frame to
//     show: the failure is written to stderr as a person reads it and the
//     promise rejects with a TerminalRunError carrying the exit code.
//   - The terminal's background is asked for only when the host's theme is a
//     function of it (terminal-background.ts), so Stigmer's default pays
//     nothing at start.
//
// Proven by __tests__/run-in-terminal.test.tsx.

import React, { useMemo } from "react";
import { render, useApp } from "ink";
import {
  startTurn,
  turnOutcomeOf,
  type SendAndWaitInput,
  type Stigmer,
  type Turn,
  type TurnOutcome,
} from "@stigmer/client";
import { exitCodeOf, type ExitCode } from "@stigmer/client/node";
import { InkStigmerProvider } from "../provider.js";
import { SessionView, type InteractionMode } from "../app/SessionView.js";
import { TurnWatchContext, type TurnWatch } from "../app/turn-watch.js";
import { describeConnectionFailure, failureExitCode } from "../errors.js";
import { terminalMode } from "../terminal-mode.js";
import { detectBackground } from "../terminal-background.js";
import type { InkThemeInput } from "../theme.js";
import type { ComposerExtensions } from "../input/extensions.js";

/** Options for {@link runInTerminal}. */
export interface RunInTerminalOptions {
  /**
   * When control returns: `"turn"` (the default) when this turn ends;
   * `"exit"` when the person leaves (Ctrl+C twice on an empty composer),
   * keeping the conversation open for follow-ups as `stigmer run` does. Off a
   * terminal both return at the turn's end.
   */
  readonly until?: "turn" | "exit";
  /** How an ask is settled off a terminal, where no one can answer: denied unless `"approve"`. */
  readonly approveDefault?: "approve" | "deny";
  /** The setting that approves asks, as the view names it when it settles one (`SessionView`'s `approveSetting`). */
  readonly approveSetting?: string;
  /** Interaction mode for follow-ups typed in the view. */
  readonly mode?: InteractionMode;
  /**
   * The host's colours by role (see `InkTheme`), or a function of the
   * terminal's background, which is then detected before the view draws.
   */
  readonly theme?: InkThemeInput;
  /** The host's slash commands, completions and prompt history for the composer. */
  readonly composer?: ComposerExtensions;
  /**
   * How to come back to the session, in the host's words, said when the
   * person presses Ctrl+C to leave: given the session's id, such as
   * `(id) => \`Come back with: mycli resume ${id}\``.
   */
  readonly leaveHint?: (sessionId: string) => string;
  /** Stops waiting and returns at once; the run itself goes on. */
  readonly signal?: AbortSignal;
  /** Ink's input stream; `process.stdin` by default. */
  readonly stdin?: NodeJS.ReadStream;
  /** Ink's output stream; `process.stdout` by default. */
  readonly stdout?: NodeJS.WriteStream;
  /** Where a start failure is written; `process.stderr` by default. */
  readonly stderr?: NodeJS.WriteStream;
  /** The environment the terminal mode reads (CI, TERM); `process.env` by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * How a turn run in the terminal ended: the client's turn outcome (less the
 * log place, which the view's follow owns), with the process exit code. `turn`
 * is undefined only when the wait stopped before the turn's first event.
 */
export type TerminalOutcome = Omit<TurnOutcome, "lastSeq" | "turn"> & {
  /** The whole turn, folded; undefined when the wait stopped before its first event. */
  readonly turn: Turn | undefined;
  /** 0 completed; 1 failed, cancelled or terminated; 130 when the wait stopped first. */
  readonly exitCode: ExitCode;
};

/** A turn that could not start or whose session could not load, worded for a person. */
export class TerminalRunError extends Error {
  /** The exit code for the failure: 3 no server, 4 a refused key, 5 not found, 1 otherwise. */
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode, cause: unknown) {
    super(message, { cause });
    this.name = "TerminalRunError";
    this.exitCode = exitCode;
  }
}

interface TerminalRunProps {
  readonly sessionId: string;
  readonly org: string;
  readonly runId: string;
  readonly until: "turn" | "exit";
  readonly live: boolean;
  readonly canAnswer: boolean;
  readonly approveDefault: "approve" | "deny";
  readonly approveSetting: string | undefined;
  readonly mode: InteractionMode | undefined;
  readonly composer: ComposerExtensions | undefined;
  readonly leaveHint: string | undefined;
  readonly onTurn: (turn: Turn) => void;
  readonly onLoadError: (error: Error) => void;
}

/** The view, watching its own conversation for this run's turn. */
function TerminalRun({ sessionId, org, runId, until, live, canAnswer, approveDefault, approveSetting, mode, composer, leaveHint, onTurn, onLoadError }: TerminalRunProps) {
  const { exit } = useApp();
  const watch = useMemo<TurnWatch>(
    () => ({
      onTurns: (turns) => {
        const turn = turns.find((t) => t.runId === runId);
        if (turn === undefined) return;
        onTurn(turn);
        if (until === "turn" && turn.status !== undefined && turn.ended) exit();
      },
      onLoadError: (error) => {
        onLoadError(error);
        exit();
      },
    }),
    // Stryker disable next-line ArrayDeclaration: the props are fixed for the one render runInTerminal makes, so the memo is never rebuilt either way
    [runId, until, onTurn, onLoadError, exit],
  );
  return (
    <TurnWatchContext.Provider value={watch}>
      <SessionView
        sessionId={sessionId}
        org={org}
        mode={mode}
        live={live}
        canAnswer={canAnswer}
        approveDefault={approveDefault}
        approveSetting={approveSetting}
        composer={composer}
        leaveHint={leaveHint}
      />
    </TurnWatchContext.Provider>
  );
}

/**
 * Sends a message as a new turn and shows it in the terminal until it ends,
 * then returns its outcome and exit code (module header).
 *
 * @example
 * ```ts
 * const outcome = await runInTerminal(client, {
 *   org: "acme",
 *   sessionSpec: { agentRef: { org: "acme", slug: "reviewer" } },
 *   message: "Review this diff",
 * });
 * process.exitCode = outcome.exitCode;
 * ```
 */
export async function runInTerminal(
  client: Stigmer,
  input: SendAndWaitInput,
  options: RunInTerminalOptions = {},
): Promise<TerminalOutcome> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const { live, canAnswer } = terminalMode({ stdin, stdout, env: options.env ?? process.env });

  let started: Awaited<ReturnType<typeof startTurn>>;
  try {
    started = await startTurn(client, input);
  } catch (error) {
    const failure = describeConnectionFailure(error, client.baseUrl, "start");
    stderr.write(`${failure.headline}\n${failure.cause}\n${failure.next}\nDetails: ${failure.details}\n`);
    throw new TerminalRunError(`${failure.headline} ${failure.cause}`, failureExitCode(error), error);
  }

  const background = typeof options.theme === "function" ? await detectBackground({ stdin, stdout, env: options.env }) : "unknown";

  let latest: Turn | undefined;
  let loadError: Error | undefined;
  const instance = render(
    <InkStigmerProvider client={client} theme={options.theme} background={background}>
      <TerminalRun
        sessionId={started.sessionId}
        org={input.org}
        runId={started.runId}
        until={canAnswer ? (options.until ?? "turn") : "turn"}
        live={live}
        canAnswer={canAnswer}
        approveDefault={options.approveDefault ?? "deny"}
        approveSetting={options.approveSetting}
        mode={options.mode}
        composer={options.composer}
        leaveHint={options.leaveHint?.(started.sessionId)}
        onTurn={(turn) => {
          latest = turn;
        }}
        onLoadError={(error) => {
          loadError = error;
        }}
      />
    </InkStigmerProvider>,
    // Stryker disable next-line BooleanLiteral: console patching only reroutes the host's own console output; the view and the outcome are the same either way
    { stdin, stdout, stderr, interactive: live, exitOnCtrlC: false, patchConsole: false, kittyKeyboard: { mode: "auto" } },
  );

  const stop = () => instance.unmount();
  // Stryker disable next-line BooleanLiteral,ObjectLiteral: unmounting twice is a no-op in Ink, so a second abort changes nothing
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted === true) stop();
  // The view never exits with an error, so the wait only resolves.
  await instance.waitUntilExit();
  // Stryker disable next-line StringLiteral: a listener left on a spent signal only unmounts an already unmounted view; removing it keeps a long-lived host signal clean
  options.signal?.removeEventListener("abort", stop);

  if (loadError !== undefined) {
    const failure = describeConnectionFailure(loadError, client.baseUrl, "load");
    throw new TerminalRunError(`${failure.headline} ${failure.cause}`, failureExitCode(loadError), loadError);
  }
  const place = { run: started.run, runId: started.runId, sessionId: started.sessionId };
  if (latest === undefined) {
    return { ...place, phase: "pending", answer: "", structuredOutput: undefined, stopCause: "", error: "", asks: [], turn: undefined, exitCode: exitCodeOf({ phase: "pending" }) };
  }
  const { lastSeq: _lastSeq, ...outcome } = turnOutcomeOf(latest, place, 0n);
  return { ...outcome, exitCode: exitCodeOf(outcome) };
}
