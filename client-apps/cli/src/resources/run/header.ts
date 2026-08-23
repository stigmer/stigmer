// The session header shown before a headless stream starts (Go's
// renderSessionHeader / sessionHeaderInfo in run_display_header.go).
//
// Deliberate divergence (clean over chrome): Go renders a lipgloss bordered
// panel with a side-by-side "recent sessions" column. That panel is TTY
// eye-candy; the interactive path here is owned by Ink's SessionView, which
// draws its own header. The only consumers of THIS header are the headless
// (--json / non-TTY plaintext) paths, where the output target is stderr — a
// bordered panel there would be noise. So we emit a compact, aligned key/value
// block carrying the same fields (Agent, Session, Model, Mode, Workspaces).

import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { shouldColorize, styler } from "../../output/style.js";
import type { HarnessFlag, RunMode } from "./prepare.js";

export interface SessionHeaderInfo {
  readonly agentName: string;
  readonly sessionId: string;
  /** Session subject; shown for resumed sessions, empty for fresh runs. */
  readonly subject?: string;
  readonly model: string;
  readonly mode: RunMode;
  /**
   * Resolved harness for the session. Surfaced only when it is "cursor":
   * a harness switch changes the toolset, conversation-state model, and
   * billing tier, and it may come from the account preference rather than
   * a flag — a cursor session must never start silently (the CLI
   * counterpart of the web composer's harness selector).
   */
  readonly harness?: HarnessFlag;
  readonly workspaces: readonly string[];
}

// Fixed label column width; sized to the longest label ("Workspaces") + ": ".
const LABEL_WIDTH = 12;

/**
 * Write the session header to `out` (stderr). Empty fields are omitted, exactly
 * like Go's formatMetadataSection. A header with no populated fields prints
 * nothing.
 */
export function renderSessionHeader(out: { write(chunk: string): unknown; isTTY?: boolean }, info: SessionHeaderInfo): void {
  const s = styler(shouldColorize(out));
  const lines: string[] = [];

  if (info.agentName !== "") lines.push(row(s, "Agent", info.agentName));
  if (info.sessionId !== "") lines.push(row(s, "Session", info.sessionId));
  if ((info.subject ?? "") !== "") lines.push(row(s, "Subject", info.subject ?? ""));
  if (info.model !== "") lines.push(row(s, "Model", info.model));
  // Only "cursor" is surfaced; native/"" is the default and stays implicit.
  if (info.harness === "cursor") lines.push(row(s, "Harness", "Cursor"));
  // Only "plan" is surfaced; "agent"/"" is the default and stays implicit.
  if (info.mode === "plan") lines.push(row(s, "Mode", "Plan (read-only)"));
  if (info.workspaces.length > 0) {
    lines.push(row(s, "Workspaces", info.workspaces[0]));
    const indent = " ".repeat(LABEL_WIDTH);
    for (const ws of info.workspaces.slice(1)) lines.push(`${indent}${ws}`);
  }

  if (lines.length === 0) return;
  out.write(`${lines.join("\n")}\n\n`);
}

function row(s: ReturnType<typeof styler>, label: string, value: string): string {
  const padded = `${label}:`.padEnd(LABEL_WIDTH, " ");
  return `${s.dim(padded)}${value}`;
}

/** Displayable names from workspace entries (Go's workspaceNames). */
export function workspaceNames(entries: readonly WorkspaceEntry[]): string[] {
  return entries.map((e) => e.name);
}
