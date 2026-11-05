"use client";

import type { BackgroundCommandView, ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { DecisionButton } from "../internal/DecisionButton.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import { ThreadCardHeaderControl } from "../internal/thread-card/index.js";
import { formatElapsed, useElapsedSince } from "../internal/useElapsedSince.js";
import { useBackgroundStop } from "./BackgroundCommandContext.js";

/**
 * How a background command stands, in the row's words: "Running in the
 * background" while it runs, else how it ended ("Exited · code 1", "Timed
 * out", "Stopped by a person", "Stopped by the agent", "Stopped when the
 * turn paused for approval", "Stopped with the turn", "Failed to start").
 */
export function backgroundStatusLabel(background: BackgroundCommandView): string {
  switch (background.state) {
    case "running":
      return "Running in the background";
    case "exited":
      return `Exited · code ${background.exitCode ?? 0}`;
    case "timed_out":
      return "Timed out";
    case "failed_to_start":
      return "Failed to start";
    case "stopped":
      switch (background.stoppedBy) {
        case "person":
          return "Stopped by a person";
        case "agent":
          return "Stopped by the agent";
        case "approval":
          return "Stopped when the turn paused for approval";
        default:
          return "Stopped with the turn";
      }
  }
}

/**
 * The header's trail for a tool use that started a command in the
 * background: a "Background" chip, its state (with a clock from its start
 * while it runs), and Stop while it runs and a stop handler is wired
 * ({@link BackgroundCommandContext}). Renders nothing for any other call.
 * Stop is a control of the header's own, lifted above the row's toggle, so
 * it is reached as itself and its click never opens or closes the row.
 */
export function BackgroundCommandTrail({ toolUse }: { readonly toolUse: ToolUse }) {
  const background = toolUse.background;
  const running = background?.state === "running";
  const elapsed = useElapsedSince(running ? (background?.startedAt ?? "") : "");
  const stop = useBackgroundStop(toolUse);
  if (background === undefined) return null;
  const ended = background.state !== "running";
  const failed = background.state === "failed_to_start" || background.state === "timed_out" || (background.state === "exited" && background.exitCode !== 0);
  return (
    <>
      <span
        className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-2xs stg:font-medium stg:leading-none stg:text-muted-foreground"
        data-cursor-target="background-command-chip"
      >
        Background
      </span>
      <span
        className={cn(
          "stg:shrink-0 stg:tabular-nums",
          ended && failed ? "stg:text-destructive" : "stg:text-muted-foreground",
        )}
        data-cursor-target="background-command-status"
      >
        {running
          ? `${backgroundStatusLabel(background)}${elapsed !== null && elapsed >= 1000 ? ` · ${formatElapsed(elapsed)}` : ""}`
          : backgroundStatusLabel(background)}
      </span>
      {stop && (
        <ThreadCardHeaderControl className="stg:shrink-0">
          <DecisionButton
            label={stop.isStopping ? "Stopping…" : "Stop"}
            variant="danger"
            onClick={stop.onStop}
            isSubmitting={stop.isStopping}
            isActive={stop.isStopping}
            className="stg:px-2 stg:py-0.5"
            cursorTarget="background-command-stop"
          />
        </ThreadCardHeaderControl>
      )}
    </>
  );
}

/** A failed stop of the row's command, under its header; nothing otherwise. */
export function BackgroundStopError({ toolUse }: { readonly toolUse: ToolUse }) {
  const stop = useBackgroundStop(toolUse);
  if (stop?.error == null) return null;
  return <InCardDecisionError error={stop.error} leadIn="stop the command" cursorTarget="background-command-stop-error" />;
}
