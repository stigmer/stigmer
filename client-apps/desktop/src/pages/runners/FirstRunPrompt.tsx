import { cn } from "@stigmer/theme";
import { Loader2 } from "lucide-react";

interface FirstRunPromptProps {
  readonly onEnable: () => void;
  readonly onDismiss: () => void;
  readonly isEnabling: boolean;
}

/**
 * Inline opt-in card shown once on first visit to the Runners page.
 * After the user chooses Enable or Not now, this component never
 * appears again (preference persisted in Tauri app data).
 */
export function FirstRunPrompt({
  onEnable,
  onDismiss,
  isEnabling,
}: FirstRunPromptProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-primary-subtle px-4 py-4",
      )}
    >
      <h3 className="text-sm font-semibold text-foreground">
        Make this computer available for agent runs?
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        When enabled, Stigmer will keep a local runner active while this
        app is open. You can disable this at any time.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onEnable}
          disabled={isEnabling}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isEnabling && <Loader2 size={12} className="animate-spin" />}
          Enable
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isEnabling}
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
