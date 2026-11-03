/**
 * A part of the React kit, live, in the docs.
 *
 * `<Live name="chat-popup" alt="…" />` frames one demo from the visual
 * suite's live list (test/visual/src/live.ts) by its name: the gallery
 * scene the screenshot check approves, drawn in the gallery's docs mode,
 * where a reader can send, approve and stop and a scripted server answers.
 * The frame loads lazily, takes the column's width and the list's height,
 * and says under it that it is a replay, so it never passes for an agent at
 * work. A name the list does not hold, or blank alt text, throws, so the
 * static build fails on the page that asked; the alt text is what the
 * markdown exports carry in the frame's place (`cleanContent` in
 * src/lib/llms-pages.ts).
 */
import { cn } from "@/lib/utils";
import { LIVE_CAPTION, liveDemo, liveUrl } from "@/lib/live";

export interface LiveProps {
  /** The demo's name in test/visual/src/live.ts. */
  name: string;
  /** What the demo shows, for a reader who cannot see it; the markdown exports carry it too. */
  alt: string;
  className?: string;
}

export function Live({ name, alt, className }: LiveProps) {
  const demo = liveDemo(name);
  // MDX is not typechecked, so a page can leave `alt` out entirely.
  if (!alt || alt.trim() === "") {
    throw new Error(`<Live name="${name}">: alt text is required; it is what a reader who cannot see the demo, and the markdown exports, get`);
  }
  return (
    <figure className={cn("not-prose my-6", className)}>
      <iframe
        src={liveUrl(name)}
        title={demo.title}
        aria-label={alt}
        loading="lazy"
        className="block w-full rounded-lg border border-fd-border bg-fd-card"
        style={{ height: demo.height }}
      />
      <figcaption className="mt-2 text-xs text-fd-muted-foreground">{LIVE_CAPTION}</figcaption>
    </figure>
  );
}
