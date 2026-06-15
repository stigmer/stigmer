// In-process Ink renderer for the interactive resource pickers (`run` agent
// browse, `resume` session browse). Mirrors stream/ink.tsx: render an Ink tree
// in-process, reuse the CLI's already-authenticated client via
// InkStigmerProvider, and NEVER call process.exit — resolve a value and let the
// caller continue its flow.
//
// This module is only ever reached through a dynamic import() in the command
// action (DD-001), so React/Ink load lazily — non-interactive commands never
// pay for them. Within this already-lazy module, ordinary JSX/imports are fine.

import React from "react";
import { render } from "ink";
import { AgentPicker, InkStigmerProvider, SessionPicker } from "@stigmer/ink";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { DeploymentMode, Stigmer } from "@stigmer/sdk";

/** Options for {@link pickAgent}. */
export interface PickAgentOptions {
  /** The CLI's configured, refreshing-token client (backend.stigmer). */
  readonly client: Stigmer;
  /** Organization to search within. */
  readonly org: string;
  /** Seeds the search box with the unresolved text the user already typed. */
  readonly initialQuery?: string;
  /** Feature-gating mode; "cloud" unless the CLI targets a local backend. */
  readonly deploymentMode?: DeploymentMode;
}

/**
 * Render the agent picker and resolve with the chosen agent, or `undefined`
 * when the user cancels (Esc / Ctrl+C). Never throws and never exits the
 * process — the caller decides what to do with the selection.
 */
export async function pickAgent(opts: PickAgentOptions): Promise<SearchResult | undefined> {
  return runPicker<SearchResult>(
    (resolve) => (
      <AgentPicker
        org={opts.org}
        initialQuery={opts.initialQuery}
        onSelect={(agent) => resolve(agent)}
        onCancel={() => resolve(undefined)}
      />
    ),
    opts.client,
    opts.deploymentMode,
  );
}

/** Options for {@link pickSession}. */
export interface PickSessionOptions {
  /** The CLI's configured, refreshing-token client (backend.stigmer). */
  readonly client: Stigmer;
  /** Seeds the filter box with the text the user already typed. */
  readonly initialQuery?: string;
  /** Feature-gating mode; "cloud" unless the CLI targets a local backend. */
  readonly deploymentMode?: DeploymentMode;
}

/**
 * Render the session picker and resolve with the chosen session, or `undefined`
 * when the user cancels (Esc / Ctrl+C).
 */
export async function pickSession(opts: PickSessionOptions): Promise<Session | undefined> {
  return runPicker<Session>(
    (resolve) => (
      <SessionPicker
        initialQuery={opts.initialQuery}
        onSelect={(session) => resolve(session)}
        onCancel={() => resolve(undefined)}
      />
    ),
    opts.client,
    opts.deploymentMode,
  );
}

// Shared mount loop: render the picker element (which calls `resolve` on select
// or cancel), unmount on the first resolution, and clean up signal handlers.
// exitOnCtrlC is false so the picker component owns Ctrl+C (→ cancel) rather
// than Ink killing the tree out from under us.
function runPicker<T>(
  renderPicker: (resolve: (value: T | undefined) => void) => React.ReactElement,
  client: Stigmer,
  deploymentMode: DeploymentMode | undefined,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const finish = (value: T | undefined): void => {
      if (settled) return;
      settled = true;
      instance.unmount();
      resolve(value);
    };

    const instance = render(
      <InkStigmerProvider client={client} deploymentMode={deploymentMode ?? "cloud"}>
        {renderPicker(finish)}
      </InkStigmerProvider>,
      { exitOnCtrlC: false },
    );

    const onSignal = (): void => finish(undefined);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    void instance.waitUntilExit().finally(() => {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      // Covers an external unmount (e.g. terminal close) with no selection.
      finish(undefined);
    });
  });
}
