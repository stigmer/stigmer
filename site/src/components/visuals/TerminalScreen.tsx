/**
 * One frame of a terminal recording, drawn: a `<pre>` the terminal's size,
 * its last rows showing, through the status hues and text styles alone
 * (src/lib/sgr.ts), labelled for a reader who cannot see it.
 * `<TerminalRecording>` and the first-job block's Terminal tab both draw
 * their frames with it; the playing is theirs (./playback.ts).
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RecordedSession } from "@/lib/recordings";
import { styledLines, type RunStyle, type StyledRun } from "@/lib/sgr";

export interface TerminalScreenProps {
  /** The recording whose frame is drawn. */
  recording: RecordedSession;
  /** Which of its frames. */
  index: number;
  /** What the recording shows, for a reader who cannot see it. */
  alt: string;
  className?: string;
}

/** The classes a run's style draws with: the status hues and the text styles, nothing else. */
function runClass(style: RunStyle): string {
  return cn(
    style.bold && "font-bold",
    style.dim && "opacity-60",
    style.italic && "italic",
    style.underline && "underline",
    style.inverse && "bg-fd-foreground text-fd-background",
    style.hue === "red" && "text-red-400",
    style.hue === "green" && "text-green-400",
    style.hue === "yellow" && "text-yellow-400",
  );
}

function Line({ runs }: { runs: readonly StyledRun[] }) {
  return (
    <span className="block min-h-[1lh]">
      {runs.map((run, i) => (
        <span key={i} className={runClass(run.style) || undefined}>
          {run.text}
        </span>
      ))}
    </span>
  );
}

export function TerminalScreen({ recording, index, alt, className }: TerminalScreenProps) {
  const frames = useMemo(() => recording.frames.map((frame) => styledLines(frame.text).slice(-recording.rows)), [recording]);
  return (
    <pre
      role="img"
      aria-label={alt}
      className={cn("m-0 p-4 font-mono text-[13px] leading-[1.35] text-neutral-200", className)}
      style={{ width: `calc(${recording.columns}ch + 2rem)`, height: `calc(${recording.rows} * 1.35em + 2rem)` }}
    >
      {frames[index]!.map((runs, i) => (
        <Line key={i} runs={runs} />
      ))}
    </pre>
  );
}
