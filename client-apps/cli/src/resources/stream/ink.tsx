// In-process Ink renderer for the interactive (TTY) stream path.
//
// The CLI renders Ink in-process and — crucially — reuses its already-authenticated client
// via InkStigmerProvider rather than letting SessionApp build its own. SessionView
// (from @stigmer/ink-ui) owns the live conversation: history, streaming, approvals,
// and a follow-up composer.
//
// This module is only ever reached through a dynamic import() in the command
// action, so React/Ink load lazily — non-streaming commands never pay
// for them. Within this already-lazy module, ordinary JSX/imports are fine.
//
// The CLI is the kit's first host: it gives the composer its commands, `@`
// over the session's local folders and a history per directory (composer.ts),
// and the words for coming back after leaving. Ctrl+C is the view's key
// (clear a draft; twice on an empty composer, leave), so Ink does not exit on
// it; Shift+Enter starts a new line where the terminal reports it.
//
// How it ends is the host's mode (`until`, the kit's word, as `runInTerminal`
// reads it): "exit" keeps the conversation open until the person leaves;
// "turn" returns once the watched run's turn ends. Each turn's end is handed
// to `afterTurn` (the CLI saves the turn's outputs there), with a sink that
// writes a note in the thread while the view is up and to stderr once it has
// gone, so nothing is written under Ink's frame. Control returns only once
// every such action has finished, saying whether one failed.

import React from "react";
import { render } from "ink";
import { InkStigmerProvider, SessionView, type InteractionMode, type TurnEndContext } from "@stigmer/ink-ui";
import type { DeploymentMode, Stigmer, Turn } from "@stigmer/client";
import { cliComposer } from "./composer.js";

export interface InkSessionOptions {
  /** The CLI's configured, refreshing-token client (backend.stigmer). */
  readonly client: Stigmer;
  readonly sessionId: string;
  /** Org slug, for follow-up runs created from the composer. */
  readonly org: string;
  /** Initial interaction mode; the user can toggle with Ctrl+T. */
  readonly mode: InteractionMode;
  /** Feature-gating mode; "cloud" unless the CLI targets a local backend. */
  readonly deploymentMode?: DeploymentMode;
  /** The session's local folders, which `@` completes paths under. */
  readonly workspaceRoots?: readonly string[];
  /** When control returns: "exit" (the default) when the person leaves; "turn" when `watchRunId`'s turn ends. */
  readonly until?: "turn" | "exit";
  /** The run whose turn's end returns control under `until: "turn"`. */
  readonly watchRunId?: string;
  /** What the host does when a turn ends; its lines go to `say` (module header). */
  readonly afterTurn?: (turn: Turn, atLoad: boolean, say: (line: string) => void) => Promise<void>;
}

/** How the view ended for its host. */
export interface InkSessionOutcome {
  /** Some turn's `afterTurn` threw: its outputs were not saved, as a note in the thread said. */
  readonly actionFailed: boolean;
}

/** What the leave line says to come back to a session. */
export function comeBackHint(sessionId: string): string {
  return `Come back with \`stigmer resume ${sessionId}\`.`;
}

/**
 * Render a live session in the terminal and resolve when the user leaves
 * (Ctrl+C twice on an empty composer, or `/exit`), or under `until: "turn"`
 * once the watched turn ends and its `afterTurn` has finished. This NEVER calls process.exit — the caller still runs its
 * epilogue (final Get + usage). Termination signals unmount the Ink tree so the
 * terminal is restored cleanly, but control returns here rather than killing
 * the host process.
 */
export async function runInkSession(opts: InkSessionOptions): Promise<InkSessionOutcome> {
  const pending = new Set<Promise<void>>();
  let mounted = true;
  let actionFailed = false;
  // Assigned before Ink can report a turn: render() returns before any effect runs.
  let leave: (() => void) | undefined;

  const onTurnEnd = (turn: Turn, context: TurnEndContext): void => {
    const say = (line: string): void => {
      if (mounted) context.note(line.trim());
      else process.stderr.write(`${line}\n`);
    };
    const action = (opts.afterTurn?.(turn, context.atLoad, say) ?? Promise.resolve()).catch((error: unknown) => {
      actionFailed = true;
      say(`Could not save this turn's outputs: ${error instanceof Error ? error.message : String(error)}`);
    });
    pending.add(action);
    void action.finally(() => pending.delete(action));
    if (opts.until === "turn" && turn.runId === opts.watchRunId) void action.then(() => leave?.());
  };

  const instance = render(
    <InkStigmerProvider client={opts.client} deploymentMode={opts.deploymentMode ?? "cloud"}>
      <SessionView
        sessionId={opts.sessionId}
        org={opts.org}
        mode={opts.mode}
        composer={cliComposer(opts.workspaceRoots ?? [])}
        leaveHint={comeBackHint(opts.sessionId)}
        onTurnEnd={onTurnEnd}
      />
    </InkStigmerProvider>,
    { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
  );
  leave = () => instance.unmount();

  const onSignal = (): void => instance.unmount();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await instance.waitUntilExit();
  } finally {
    mounted = false;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  await Promise.all([...pending]);
  return { actionFailed };
}
