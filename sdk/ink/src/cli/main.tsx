// stigmer-ink's work, apart from the process it runs in: read the command
// line, then start or send a turn with runInTerminal, or watch a session, and
// answer with the exit code. The entry file (stigmer-ink.tsx) only wires the
// process's streams, signals and exit to it, so every path here is a test.
//
// Proven by __tests__/cli-main.test.tsx and __tests__/cli-args.test.ts.

import React from "react";
import { render, useApp } from "ink";
import type { Stigmer, Turn } from "@stigmer/client";
import { createNodeClient, exitCodeOf, ExitCode, type NodeClientConfig } from "@stigmer/client/node";
import { InkStigmerProvider } from "../provider.js";
import { SessionView } from "../app/SessionView.js";
import { TurnWatchContext, type TurnWatch } from "../app/turn-watch.js";
import { runInTerminal, TerminalRunError } from "../run/run-in-terminal.js";
import { terminalMode } from "../terminal-mode.js";
import { failureExitCode } from "../errors.js";
import { parseCliArgs, USAGE } from "./args.js";

/** The process a run reads and writes, and the signal that stops it. */
export interface CliIo {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

/** What a run is built from; tests replace them. */
export interface CliDeps {
  readonly createClient: (config: NodeClientConfig) => Stigmer;
  readonly run: typeof runInTerminal;
}

const DEFAULT_DEPS: CliDeps = { createClient: createNodeClient, run: runInTerminal };

/** What a watch saw last: the newest turn, or the error that kept the session from loading. */
interface Watched {
  newest?: Turn;
  loadError?: Error;
}

/**
 * Watching a session someone else answers: it settles no ask (a pending
 * approval stays theirs), and off a terminal it returns once the newest turn
 * ended. It records what it saw for the exit code.
 */
function Watch({ sessionId, org, live, canAnswer, seen }: { sessionId: string; org: string; live: boolean; canAnswer: boolean; seen: Watched }) {
  const { exit } = useApp();
  const watch = React.useMemo<TurnWatch>(
    () => ({
      onTurns: (turns: readonly Turn[]) => {
        seen.newest = turns.at(-1);
        const ended = seen.newest === undefined || (seen.newest.status !== undefined && seen.newest.ended);
        if (!canAnswer && ended) exit();
      },
      onLoadError: (error) => {
        seen.loadError = error;
        exit();
      },
    }),
    [canAnswer, exit, seen],
  );
  return (
    <TurnWatchContext.Provider value={watch}>
      <SessionView
        sessionId={sessionId}
        org={org}
        live={live}
        canAnswer={canAnswer}
        approveDefault="leave"
        leaveHint={comeBack(sessionId, org)}
      />
    </TurnWatchContext.Provider>
  );
}

/** A watch's exit code: the load error's, else the newest turn's phase (none: 0), else 130 when stopped first. */
function watchExitCode(seen: Watched, stopped: boolean): number {
  if (seen.loadError !== undefined) return failureExitCode(seen.loadError);
  const newest = seen.newest;
  if (newest === undefined) return stopped ? ExitCode.Interrupted : ExitCode.Success;
  const ended = newest.status !== undefined && newest.ended;
  if (!ended) return ExitCode.Interrupted;
  return exitCodeOf({ phase: newest.status!.phase });
}

/** How the bin comes back to a session, as the leave line says it. */
function comeBack(sessionId: string, org: string): string {
  return `Come back with: stigmer-ink --session ${sessionId} --org ${org}`;
}

/** Runs stigmer-ink with `argv` (without the node and script paths) and answers its exit code. */
export async function runCli(argv: readonly string[], io: CliIo, deps: CliDeps = DEFAULT_DEPS): Promise<number> {
  const request = parseCliArgs(argv, io.env);
  if (request.kind === "help") {
    io.stdout.write(`${USAGE}\n`);
    return ExitCode.Success;
  }
  if (request.kind === "usage-error") {
    io.stderr.write(`stigmer-ink: ${request.message}\n\n${USAGE}\n`);
    return ExitCode.Usage;
  }

  const client = deps.createClient({ baseUrl: request.baseUrl, apiKey: request.apiKey });

  if (request.message === undefined) {
    const { live, canAnswer } = terminalMode({ stdin: io.stdin, stdout: io.stdout, env: io.env });
    const seen: Watched = {};
    const instance = render(
      <InkStigmerProvider client={client}>
        <Watch sessionId={request.sessionId ?? ""} org={request.org} live={live} canAnswer={canAnswer} seen={seen} />
      </InkStigmerProvider>,
      { stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, interactive: live, exitOnCtrlC: false, patchConsole: false, kittyKeyboard: { mode: "auto" } },
    );
    io.signal.addEventListener("abort", () => instance.unmount(), { once: true });
    await instance.waitUntilExit();
    return watchExitCode(seen, io.signal.aborted);
  }

  try {
    const outcome = await deps.run(
      client,
      request.agent === undefined
        ? { org: request.org, sessionId: request.sessionId, message: request.message }
        : { org: request.org, sessionSpec: { agentRef: request.agent }, message: request.message },
      {
        until: request.until,
        approveDefault: request.approveDefault,
        approveSetting: "--approve-default approve",
        leaveHint: (sessionId) => comeBack(sessionId, request.org),
        mode: request.mode,
        signal: io.signal,
        stdin: io.stdin,
        stdout: io.stdout,
        stderr: io.stderr,
        env: io.env,
      },
    );
    return outcome.exitCode;
  } catch (error) {
    // A start failure was written to stderr, a load failure drawn in the view.
    if (!(error instanceof TerminalRunError)) io.stderr.write(`stigmer-ink: ${String(error)}\n`);
    return failureExitCode(error);
  }
}
