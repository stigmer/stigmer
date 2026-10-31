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

import React from "react";
import { render } from "ink";
import { InkStigmerProvider, SessionView, type InteractionMode } from "@stigmer/ink-ui";
import type { DeploymentMode, Stigmer } from "@stigmer/client";
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
}

/** What the leave line says to come back to a session. */
export function comeBackHint(sessionId: string): string {
  return `Come back with \`stigmer resume ${sessionId}\`.`;
}

/**
 * Render a live session in the terminal and resolve when the user leaves
 * (Ctrl+C twice on an empty composer, or `/exit`). This NEVER calls process.exit — the caller still runs its
 * epilogue (final Get + usage). Termination signals unmount the Ink tree so the
 * terminal is restored cleanly, but control returns here rather than killing
 * the host process.
 */
export async function runInkSession(opts: InkSessionOptions): Promise<void> {
  const instance = render(
    <InkStigmerProvider client={opts.client} deploymentMode={opts.deploymentMode ?? "cloud"}>
      <SessionView
        sessionId={opts.sessionId}
        org={opts.org}
        mode={opts.mode}
        composer={cliComposer(opts.workspaceRoots ?? [])}
        leaveHint={comeBackHint(opts.sessionId)}
      />
    </InkStigmerProvider>,
    { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
  );

  const onSignal = (): void => instance.unmount();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await instance.waitUntilExit();
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
