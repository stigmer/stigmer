"use client";

// A command the agent runs in the background, in its row's header: one line
// saying how it stands ("Running in the background · 12s", or how it ended)
// and a quiet Stop while it runs; a failed stop shows under the header.

import type { BackgroundCommandView, ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import { SpinnerIcon, ThreadCardHeaderControl } from "../internal/thread-card/index.js";
import { formatElapsed } from "@stigmer/client";
import { useElapsedSince } from "../internal/useElapsedSince.js";
import { useBackgroundStop } from "./BackgroundCommandContext.js";
import { backgroundStatusLabel } from "./background-status-label.js";

/**
 * The header's trail for a tool use that started a command in the
 * background: one line saying how it stands ("Running in the background ·
 * 12s" while it runs, else how it ended), and a quiet Stop while it runs and
 * a stop handler is wired ({@link BackgroundCommandContext}); "Stopping…",
 * disabled with a spinner, while the stop is in flight. Renders nothing for
 * any other call. Stop is a control of the header's own, lifted above the
 * row's toggle, so it is reached as itself and its click never opens or
 * closes the row.
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
        className={cn(
          "stg:shrink-0 stg:text-xs stg:tabular-nums",
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
          <Button
            variant="ghost"
            size="xs"
            onClick={stop.onStop}
            disabled={stop.isStopping}
            icon={stop.isStopping ? <SpinnerIcon /> : undefined}
            data-cursor-target="background-command-stop"
          >
            {stop.isStopping ? "Stopping…" : "Stop"}
          </Button>
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
