#!/usr/bin/env node
// stigmer-ink: a Stigmer agent turn as one child process, for a host written
// in any language (the docs' Go, Python and Rust bridges spawn it). It starts
// a conversation with an agent (or sends into, or watches, a session), shows
// it as the kit's SessionView, and exits with the shared exit-code table
// (@stigmer/client/node), so the host branches on the code alone.
//
// Runs on Node alone: the shebang is `node` and the published file is
// compiled JavaScript. The process's signals are the bin's to map (a library
// takes none): SIGINT and SIGTERM stop the wait as Ctrl+C does, leaving the
// run going on the server, and the code is 130.
//
// Proven by __tests__/cli-args.test.ts (the command line) and
// test/install/smoke-terminal-kit.mjs (the packed bin, on a terminal and off).

import React from "react";
import { render, useApp } from "ink";
import type { Turn } from "@stigmer/client";
import { createNodeClient, exitCodeOf, ExitCode } from "@stigmer/client/node";
import { InkStigmerProvider } from "../provider.js";
import { SessionView } from "../app/SessionView.js";
import { TurnWatchContext, type TurnWatch } from "../app/turn-watch.js";
import { runInTerminal, TerminalRunError } from "../run/run-in-terminal.js";
import { terminalMode } from "../terminal-mode.js";
import { parseCliArgs, USAGE } from "./args.js";

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

async function main(): Promise<number> {
  const request = parseCliArgs(process.argv.slice(2), process.env);
  if (request.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return ExitCode.Success;
  }
  if (request.kind === "usage-error") {
    process.stderr.write(`stigmer-ink: ${request.message}\n\n${USAGE}\n`);
    return ExitCode.Usage;
  }

  const client = createNodeClient({ baseUrl: request.baseUrl, apiKey: request.apiKey });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (request.message === undefined) {
    const { live, canAnswer } = terminalMode({ stdin: process.stdin, stdout: process.stdout, env: process.env });
    const instance = render(
      <InkStigmerProvider client={client}>
        <Watch sessionId={request.sessionId ?? ""} org={request.org} canAnswer={canAnswer} />
      </InkStigmerProvider>,
      { interactive: live, exitOnCtrlC: true, patchConsole: false },
    );
    controller.signal.addEventListener("abort", () => instance.unmount(), { once: true });
    await instance.waitUntilExit();
    return controller.signal.aborted ? ExitCode.Interrupted : ExitCode.Success;
  }

  try {
    const outcome = await runInTerminal(
      client,
      request.agent === undefined
        ? { org: request.org, sessionId: request.sessionId, message: request.message }
        : { org: request.org, sessionSpec: { agentRef: request.agent }, message: request.message },
      { until: request.until, approveDefault: request.approveDefault, mode: request.mode, signal: controller.signal },
    );
    return outcome.exitCode;
  } catch (error) {
    // A start failure was written to stderr, a load failure drawn in the view.
    if (!(error instanceof TerminalRunError)) process.stderr.write(`stigmer-ink: ${String(error)}\n`);
    return exitCodeOf(error);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
    // Ink has flushed its last frame; an idle client connection must not hold the process.
    setTimeout(() => process.exit(code), 200).unref();
  },
  (error: unknown) => {
    process.stderr.write(`stigmer-ink: ${String(error)}\n`);
    process.exit(ExitCode.General);
  },
);
