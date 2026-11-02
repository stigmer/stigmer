/**
 * Pins on a shown screen, each on a part of the drawing that proves one of
 * the five claims, and the list of what they say.
 *
 * Where a pin sits is not chosen here: the screen's entry in the visual
 * suite's list declares each mark's box, and the suite fails when the part
 * it names moves or goes (test/visual/tests/shown.spec.ts), so a pin cannot
 * drift off what it says. `ScreenPins` lays the marks of `source` over the
 * picture `on` (the same drawing, whole or cropped) in percent of it; marks
 * outside the crop are left off. The pins are decoration (`aria-hidden`):
 * the picture's alt text says what it shows, and `PinRail`, a real list
 * numbered as the pins are, is what a screen reader meets. Each of its items
 * links to the claim's row below, where its proof is.
 */
import { cn } from "@/lib/utils";
import { AGENT_GETS } from "@/lib/agent-gets";
import { placedMarks } from "@/lib/screens";

export interface ScreenPinsProps {
  /** The shown picture whose marks are placed. */
  source: string;
  /** The picture they are placed on: `source`, or a crop of the same drawing. */
  on?: string;
  className?: string;
}

/** A pin's number, as both the pin and its rail item show it. */
function PinNumber({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full bg-foreground font-mono text-[11px] font-semibold leading-none text-background",
        className
      )}
    >
      {n}
    </span>
  );
}

export function ScreenPins({ source, on = source, className }: ScreenPinsProps) {
  return (
    <div aria-hidden="true" data-pins={on} className={cn("pointer-events-none absolute inset-0", className)}>
      {placedMarks(source, on).map((mark, index) => (
        <span
          key={mark.id}
          data-pin={mark.id}
          className="absolute rounded-md ring-[1.5px] ring-foreground/90 ring-offset-2 ring-offset-transparent shadow-[0_0_0_6px_rgb(245_245_245/0.08)]"
          style={{ left: `${mark.left}%`, top: `${mark.top}%`, width: `${mark.width}%`, height: `${mark.height}%` }}
        >
          <PinNumber n={index + 1} className="absolute -left-3 -top-3" />
        </span>
      ))}
    </div>
  );
}

export function PinRail({ source, on = source, className }: ScreenPinsProps) {
  return (
    <ol data-pin-rail={on} className={cn("flex flex-wrap items-center justify-center gap-x-6 gap-y-3", className)}>
      {placedMarks(source, on).map((mark, index) => (
        <li key={mark.id}>
          <a
            href={`#hard-parts-${mark.id}`}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <PinNumber n={index + 1} />
            {AGENT_GETS[mark.id].title}
          </a>
        </li>
      ))}
    </ol>
  );
}
