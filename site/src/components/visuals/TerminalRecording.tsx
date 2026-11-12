"use client";

/**
 * A terminal session, played in the docs.
 *
 * `<TerminalRecording name="run-approval" alt="…" />` plays one recording
 * of the terminal kit (sdk/ink/src/recordings.ts) by its name: the frames
 * `SessionView` drew over a story, event by event, held by the kit's test,
 * so the docs show exactly what the terminal draws. Each frame is drawn by
 * `TerminalScreen`, on the docs' playback engine (./playback.ts): it starts
 * when scrolled into view, pauses and replays from its button, and under
 * reduced motion shows the last frame and does not play. A name the list does
 * not hold, or blank alt text, throws, so the static build fails on the page
 * that asked; the markdown exports carry the alt text and the last frame
 * instead (`cleanContent` in src/lib/llms-pages.ts).
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { RECORDED_LINE, recording } from "@/lib/recordings";
import { usePlayback } from "./playback";
import { TerminalScreen } from "./TerminalScreen";

export interface TerminalRecordingProps {
  /** The recording's name in sdk/ink/src/recordings.ts. */
  name: string;
  /** What the recording shows, for a reader who cannot see it; the markdown exports carry it too. */
  alt: string;
  className?: string;
}

export function TerminalRecording({ name, alt, className }: TerminalRecordingProps) {
  const held = recording(name);
  // MDX is not typechecked, so a page can leave `alt` out entirely.
  if (!alt || alt.trim() === "") {
    throw new Error(`<TerminalRecording name="${name}">: alt text is required; it is what a reader who cannot see the recording, and the markdown exports, get`);
  }
  const times = useMemo(() => held.frames.map((frame) => frame.at), [held]);
  const { index, playing, done, reduced, box, toggle } = usePlayback(times);
  return (
    <figure ref={box} className={cn("not-prose my-6", className)}>
      {/* A phone scrolls the terminal sideways, so the box takes focus for a keyboard to scroll it. */}
      <div tabIndex={0} role="region" aria-label="Terminal recording" className="overflow-x-auto rounded-lg border border-fd-border bg-black">
        <TerminalScreen recording={held} index={index} alt={alt} />
      </div>
      <figcaption className="mt-2 flex items-center gap-3 text-xs text-fd-muted-foreground">
        {!reduced && (
          <button type="button" className="rounded border border-fd-border px-2 py-0.5 hover:text-fd-foreground" onClick={toggle}>
            {done ? "Replay" : playing ? "Pause" : "Play"}
          </button>
        )}
        <span>
          {held.title}. {RECORDED_LINE}
        </span>
      </figcaption>
    </figure>
  );
}
