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

/** Watching a session: off a terminal, return once its newest turn ended. */
function Watch({ sessionId, org, canAnswer }: { sessionId: string; org: string; canAnswer: boolean }) {
  const { exit } = useApp();
  const watch = React.useMemo<TurnWatch>(
    () => ({
      onTurns: (turns: readonly Turn[]) => {
        const newest = turns.at(-1);
        if (!canAnswer && (newest === undefined || (newest.status !== undefined && newest.ended))) exit();
      },
      onLoadError: () => exit(),
    }),
    [canAnswer, exit],
  );
  return (
    <TurnWatchContext.Provider value={watch}>
      <SessionView sessionId={sessionId} org={org} canAnswer={canAnswer} />
    </TurnWatchContext.Provider>
  );
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
    const instance = render(
      <InkStigmerProvider client={client}>
        <Watch sessionId={request.sessionId ?? ""} org={request.org} canAnswer={canAnswer} />
      </InkStigmerProvider>,
      { stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, interactive: live, exitOnCtrlC: true, patchConsole: false },
    );
    io.signal.addEventListener("abort", () => instance.unmount(), { once: true });
    await instance.waitUntilExit();
    return io.signal.aborted ? ExitCode.Interrupted : ExitCode.Success;
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
    return exitCodeOf(error);
  }
}
