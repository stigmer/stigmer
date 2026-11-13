"use client";

// The pieces a helper's step header shares between its two drawings: the
// helper's own step (`SubagentSection`) and the task call's row that starts
// it (`ToolCallItem`). One glyph, one tag rule and one pill rule, so a helper
// reads the same wherever it shows. Internal: not exported from the barrel.

import type { Thread } from "@stigmer/client";
import { StatusBadge } from "../status/StatusBadge.js";

/** The tag a helper with no agent name of its own carries. */
export const HELPER_WORD = "Helper";

/**
 * The tag beside a helper's line: its agent's name, else "Helper". Null when
 * the line already says that same word (a helper with no subject is titled
 * by its name), so the header never repeats itself.
 */
export function helperTagWord(agentName: string, line: string): string | null {
  const word = agentName || HELPER_WORD;
  return word === line ? null : word;
}

/**
 * The pill a helper's header carries, following the step rows' rule: only a
 * helper that failed or stopped says so. A working helper shows its spinner
 * and a finished one says nothing, so no "Running" and no "Completed".
 */
export function HelperEndingBadge({ state }: { readonly state: Thread["state"] }) {
  if (state === "failed") return <StatusBadge phase="failed" label="Failed" />;
  if (state === "stopped") return <StatusBadge phase="disabled" label="Stopped" />;
  return null;
}

/** The helper (robot) glyph, at the step rows' 12px icon size. */
export function HelperGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="8" height="6" rx="1.5" />
      <circle cx="4.5" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <path d="M6 1V4" />
      <circle cx="6" cy="1" r="0.75" />
    </svg>
  );
}
