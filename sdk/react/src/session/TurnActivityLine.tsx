"use client";

// The working turn's one line: what it is doing, for how long, and how far
// it has got, from the first second ("Running a command · 1 min 30 s · 2 of
// 5 done"), with the item in progress beneath it and Stop at hand. Every
// word comes from `describeTurnActivity` and `activityPhrase`
// (@stigmer/client), which the terminal reads too, so both harnesses and
// both surfaces say the same thing.
//
// A question or approval waiting on the person takes the line over in the
// inverse fill, the most visible thing on the screen until it is answered:
// Stigmer is black and white, so emphasis is fill and weight, never a hue.
// A reader who cannot answer it (an observer, a participant) is told the
// turn waits for an answer, in the plain fill: it is not waiting on them.

import { useEffect, useState } from "react";
import { activityPhrase, describeTurnActivity, type Turn } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { durationWords } from "./duration-words.js";

/** Props for {@link TurnActivityLine}. */
export interface TurnActivityLineProps {
  /** The working turn. */
  readonly turn: Turn;
  /** Stops the turn; omitted where the person cannot stop it. */
  readonly onStop?: () => void;
  /** Whether this reader answers what the turn waits on; false for an observer or a participant. Defaults to true. */
  readonly decides?: boolean;
  readonly isStopping?: boolean;
  readonly className?: string;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The working turn's activity line (module header). */
export function TurnActivityLine({ turn, onStop, decides = true, isStopping, className }: TurnActivityLineProps) {
  const now = useNow();
  const progress = describeTurnActivity(turn, now);
  const awaited = progress.activity.kind === "waiting_for_you";
  const waiting = awaited && decides;
  // How far it has got: the list's count, else the steps settled once one
  // has, never "0 steps".
  const facts = [
    durationWords(progress.elapsedMs),
    progress.todos !== undefined
      ? `${progress.todos.done} of ${progress.todos.total} done`
      : progress.stepsSettled > 0
        ? `${progress.stepsSettled} ${progress.stepsSettled === 1 ? "step" : "steps"}`
        : undefined,
  ].filter((fact) => fact !== undefined);
  return (
    <div
      role="status"
      aria-live="off"
      className={cn(
        "stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:px-3 stg:py-2",
        waiting ? "stg:border-foreground stg:bg-foreground stg:text-background" : "stg:border-border stg:bg-card",
        className,
      )}
    >
      <span className="stg:relative stg:flex stg:h-2 stg:w-2 stg:shrink-0" aria-hidden="true">
        {!waiting && (
          <span className="stg:absolute stg:inline-flex stg:h-full stg:w-full stg:animate-ping stg:rounded-full stg:bg-foreground stg:opacity-40" />
        )}
        <span className={cn("stg:relative stg:inline-flex stg:h-2 stg:w-2 stg:rounded-full", waiting ? "stg:bg-background" : "stg:bg-foreground")} />
      </span>
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:truncate stg:text-sm stg:font-medium">{awaited && !decides ? "Waiting for an answer" : activityPhrase(progress.activity)}</p>
        <p className={cn("stg:truncate stg:text-xs", waiting ? "stg:opacity-80" : "stg:text-muted-foreground")}>
          {facts.join(" · ")}
          {!waiting && progress.todos?.current !== undefined && ` · now: ${progress.todos.current}`}
        </p>
      </div>
      {onStop !== undefined && (
        <button
          type="button"
          onClick={onStop}
          disabled={isStopping}
          className={cn(
            "stg:shrink-0 stg:rounded-md stg:border stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            waiting ? "stg:border-background" : "stg:border-border stg:hover:bg-muted",
          )}
        >
          {isStopping ? "Stopping…" : "Stop"}
        </button>
      )}
    </div>
  );
}
