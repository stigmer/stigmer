"use client";

// A command the agent runs in the background, in its row: its second line
// saying how it stands ("Running in the background · 12s", or how it ended),
// a quiet Stop in the row's trail while it runs, and a failed stop in its
// body.

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
 * How a command the agent runs in the background stands, for its row's
 * second line: "Running in the background · 12s" while it runs, else how it
 * ended ("Exited · code 0", "Stopped by you"), in the failed hue when it
 * ended badly. Renders nothing for any other call.
 */
export function BackgroundCommandStatusWords({ toolUse }: { readonly toolUse: ToolUse }) {
  const background = toolUse.background;
  const running = background?.state === "running";
  const elapsed = useElapsedSince(running ? (background?.startedAt ?? "") : "");
  if (background === undefined) return null;
  const failed = background.state === "failed_to_start" || background.state === "timed_out" || (background.state === "exited" && background.exitCode !== 0);
  return (
    <span
      className={cn("stg:min-w-0 stg:truncate stg:tabular-nums", !running && failed ? "stg:text-status-failed" : "stg:text-muted-foreground")}
      data-cursor-target="background-command-status"
    >
      {running
        ? `${backgroundStatusLabel(background)}${elapsed !== null && elapsed >= 1000 ? ` · ${formatElapsed(elapsed)}` : ""}`
        : backgroundStatusLabel(background)}
    </span>
  );
}

/**
 * A quiet Stop on the row of a command running in the background, while a
 * stop handler is wired ({@link BackgroundCommandContext}); "Stopping…",
 * disabled with a spinner, while the stop is in flight. Renders nothing for
 * any other call. Stop is a control of the line's own, lifted above the
 * row's toggle, so it is reached as itself and its click never opens or
 * closes the row.
 */
export function BackgroundCommandStop({ toolUse }: { readonly toolUse: ToolUse }) {
  const stop = useBackgroundStop(toolUse);
  if (toolUse.background === undefined || stop === null || stop === undefined) return null;
  return (
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
  );
}

/**
 * The status and the Stop of a command the agent runs in the background,
 * side by side, for a host that draws its own row with one trailing slot:
 * {@link BackgroundCommandStatusWords} then {@link BackgroundCommandStop}.
 * The kit's own step puts the status on its second line and the Stop in its
 * trail. Renders nothing for any other call.
 */
export function BackgroundCommandTrail({ toolUse }: { readonly toolUse: ToolUse }) {
  if (toolUse.background === undefined) return null;
  return (
    <>
      <BackgroundCommandStatusWords toolUse={toolUse} />
      <BackgroundCommandStop toolUse={toolUse} />
    </>
  );
}

/** A failed stop of the row's command, under its header; nothing otherwise. */
export function BackgroundStopError({ toolUse }: { readonly toolUse: ToolUse }) {
  const stop = useBackgroundStop(toolUse);
  if (stop?.error == null) return null;
  return <InCardDecisionError error={stop.error} leadIn="stop the command" cursorTarget="background-command-stop-error" />;
}
