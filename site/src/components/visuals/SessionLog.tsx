/**
 * The picture on the docs' Sessions page: Northwind Books' Session as its
 * log, one run per message, each event with its type, what it says, who
 * wrote it and the Session's phase.
 *
 * It is a list, not a drawing: its rows are page text a screen reader reads
 * in order, so nothing is hidden and no caption repeats it. The data, the
 * phases and the stylesheet live in `session-log.ts`; this file draws the
 * rows. It holds no state and no hooks, and the page renders it on the
 * server.
 */
import { cn } from "@/lib/utils";
import {
  ATTRIBUTE,
  HEADINGS,
  LABEL as FIGURE_LABEL,
  PHASES,
  RUNS,
  SESSION_LOG_CSS,
  marks,
  sessionPhases,
  type LogEvent,
  type Phase,
} from "./session-log";

/** The small uppercase label the drawings name things with. */
const LABEL = "font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase";

/** One event: its type and marks, its words, its writer, and the lane in its phase. */
function Row({ event, phase }: { event: LogEvent; phase: Phase }) {
  return (
    <li {...{ [`data-${ATTRIBUTE}-row`]: "" }} data-phase={phase} className="border-t border-border">
      <span data-cell="type" className="font-mono text-xs leading-5 text-foreground">
        <code className="font-mono">{event.type}</code>
        {marks(event).map((mark) => (
          <span key={mark} className="font-mono text-xs leading-5 text-muted-foreground">
            {mark}
          </span>
        ))}
      </span>
      <span data-cell="says" className="text-sm leading-5 text-foreground">
        {event.says}
      </span>
      <span data-cell="writer" className="text-xs leading-5 text-muted-foreground">
        {event.writer}
      </span>
      <span data-cell="lane" className="text-muted-foreground">
        <span data-bar="" />
        <span className="sr-only">The Session is {PHASES[phase]}.</span>
      </span>
    </li>
  );
}

function SessionLog({ className }: { className?: string }) {
  const phases = sessionPhases(RUNS);
  return (
    <figure
      {...{ [`data-${ATTRIBUTE}`]: "" }}
      aria-label={FIGURE_LABEL}
      className={cn("@container w-full font-sans text-foreground", className)}
    >
      <style href={ATTRIBUTE} precedence="default">
        {SESSION_LOG_CSS}
      </style>
      <div {...{ [`data-${ATTRIBUTE}-head`]: "" }} aria-hidden="true" className="pb-2">
        <span data-cell="type" className={LABEL}>
          {HEADINGS.type}
        </span>
        <span data-cell="says" className={LABEL}>
          {HEADINGS.says}
        </span>
        <span data-cell="writer" className={LABEL}>
          {HEADINGS.writer}
        </span>
      </div>
      {RUNS.map((run, index) => (
        <div key={run.id} className={index === 0 ? undefined : "mt-5"}>
          <p id={`${ATTRIBUTE}-${run.id}`} className={cn(LABEL, "pb-2")}>
            {run.label}
          </p>
          <ol aria-labelledby={`${ATTRIBUTE}-${run.id}`} className="border-b border-border">
            {run.events.map((event, at) => (
              <Row key={`${event.type}-${at}`} event={event} phase={phases[index][at]} />
            ))}
          </ol>
        </div>
      ))}
      <p aria-hidden="true" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-muted-foreground">
        {(Object.keys(PHASES) as Phase[]).map((phase) => (
          <span key={phase} className="inline-flex items-center gap-2">
            <span data-swatch={phase} className="inline-block h-3 w-3 border border-border text-muted-foreground" />
            {PHASES[phase]}
          </span>
        ))}
      </p>
    </figure>
  );
}

export { SessionLog };
