// In-process Ink renderer for the interactive (TTY) stream path.
//
// Go spawns a separate `stigmer-ink` subprocess (sdk/ink/src/cli/stigmer-ink.tsx)
// and pipes session config to it. Here the CLI *is* a TS process, so we render
// Ink in-process and — crucially — reuse the CLI's already-authenticated client
// via InkStigmerProvider rather than letting SessionApp build its own. SessionView
// (from @stigmer/ink) owns the live conversation: history, streaming, approvals,
// and a follow-up composer.
//
// This module is only ever reached through a dynamic import() in the command
// action (DD-001), so React/Ink load lazily — non-streaming commands never pay
// for them. Within this already-lazy module, ordinary JSX/imports are fine.

import React from "react";
import { render } from "ink";
import { InkStigmerProvider, SessionView, type InteractionMode } from "@stigmer/ink";
import type { DeploymentMode, Stigmer } from "@stigmer/sdk";

export interface InkSessionOptions {
  /** The CLI's configured, refreshing-token client (backend.stigmer). */
  readonly client: Stigmer;
  readonly sessionId: string;
  /** Org slug, for follow-up executions created from the composer. */
  readonly org: string;
  /** Initial interaction mode; the user can toggle with Ctrl+T. */
  readonly mode: InteractionMode;
  /** Feature-gating mode; "cloud" unless the CLI targets a local backend. */
  readonly deploymentMode?: DeploymentMode;
}

/**
 * Render a live session in the terminal and resolve when the user exits (Ctrl+C
 * unmounts the app). This NEVER calls process.exit — the caller still runs its
 * epilogue (final Get + usage). Termination signals unmount the Ink tree so the
 * terminal is restored cleanly, but control returns here rather than killing
 * the host process.
 */
export async function runInkSession(opts: InkSessionOptions): Promise<void> {
  const instance = render(
    <InkStigmerProvider client={opts.client} deploymentMode={opts.deploymentMode ?? "cloud"}>
      <SessionView sessionId={opts.sessionId} org={opts.org} mode={opts.mode} />
    </InkStigmerProvider>,
    { exitOnCtrlC: true },
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
