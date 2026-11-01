/**
 * The pause button a looping picture carries, in its bottom-right corner.
 *
 * The paused state belongs to the figure, which turns it into `data-paused`
 * for its stylesheet; the button is handed the state and the toggle. Its
 * name stays "Pause animation" either way and `aria-pressed` says which, so
 * a screen reader hears one button that is on or off. The loop's stylesheet
 * hides it when the visitor asked for less motion, through
 * `data-<prefix>-pause`.
 */
import { Icon } from "@/components/ui/icon";

function LoopPause({ prefix, paused, onToggle }: { prefix: string; paused: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      {...{ [`data-${prefix}-pause`]: "" }}
      aria-label="Pause animation"
      aria-pressed={paused}
      onClick={onToggle}
      className="absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name={paused ? "play" : "pause"} className="h-3.5 w-3.5" />
    </button>
  );
}

export { LoopPause };
