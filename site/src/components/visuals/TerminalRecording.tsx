"use client";

/**
 * A terminal session, played in the docs.
 *
 * `<TerminalRecording name="run-approval" alt="…" />` plays one recording
 * of the terminal kit (sdk/ink/src/recordings.ts) by its name: the frames
 * `SessionView` drew over a story, event by event, held by the kit's test,
 * so the docs show exactly what the terminal draws. The frames play in a
 * `<pre>` the terminal's size, its last rows showing, through the status
 * hues and text styles alone (src/lib/sgr.ts). It starts when scrolled into
 * view, pauses and replays from its buttons, and under reduced motion shows
 * the last frame and does not play. A name the list does not hold, or blank
 * alt text, throws, so the static build fails on the page that asked; the
 * markdown exports carry the alt text and the last frame instead
 * (`cleanContent` in src/lib/llms-pages.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { recording } from "@/lib/recordings";
import { styledLines, type RunStyle, type StyledRun } from "@/lib/sgr";

export interface TerminalRecordingProps {
  /** The recording's name in sdk/ink/src/recordings.ts. */
  name: string;
  /** What the recording shows, for a reader who cannot see it; the markdown exports carry it too. */
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

/** Whether the reader asked for less motion. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function TerminalRecording({ name, alt, className }: TerminalRecordingProps) {
  const held = recording(name);
  // MDX is not typechecked, so a page can leave `alt` out entirely.
  if (!alt || alt.trim() === "") {
    throw new Error(`<TerminalRecording name="${name}">: alt text is required; it is what a reader who cannot see the recording, and the markdown exports, get`);
  }
  const frames = useMemo(() => held.frames.map((frame) => styledLines(frame.text).slice(-held.rows)), [held]);
  const last = frames.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLElement>(null);

  // Under reduced motion the recording is its last frame; otherwise it starts once scrolled into view.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setReduced(true);
      setIndex(last);
      return;
    }
    const element = box.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setPlaying(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [last]);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((at) => at + 1), held.frames[index + 1]!.at - held.frames[index]!.at);
    return () => clearTimeout(timer);
  }, [playing, index, last, held]);

  const done = index >= last;
  return (
    <figure ref={box} className={cn("not-prose my-6", className)}>
      <div className="overflow-x-auto rounded-lg border border-fd-border bg-black">
        <pre
          role="img"
          aria-label={alt}
          className="m-0 p-4 font-mono text-[13px] leading-[1.35] text-neutral-200"
          style={{ width: `calc(${held.columns}ch + 2rem)`, height: `calc(${held.rows} * 1.35em + 2rem)` }}
        >
          {frames[index]!.map((runs, i) => (
            <Line key={i} runs={runs} />
          ))}
        </pre>
      </div>
      <figcaption className="mt-2 flex items-center gap-3 text-xs text-fd-muted-foreground">
        {!reduced && (
          <button
            type="button"
            className="rounded border border-fd-border px-2 py-0.5 hover:text-fd-foreground"
            onClick={() => {
              if (done) {
                setIndex(0);
                setPlaying(true);
              } else setPlaying((now) => !now);
            }}
          >
            {done ? "Replay" : playing ? "Pause" : "Play"}
          </button>
        )}
        <span>{held.title}. Recorded from the terminal kit; no agent is running.</span>
      </figcaption>
    </figure>
  );
}
