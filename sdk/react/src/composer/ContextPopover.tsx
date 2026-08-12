import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useStigmerPortalContainer } from "../portal-container.js";

export function ContextPopover({
  icon,
  label,
  count,
  children,
  disabled,
  open,
  onOpenChange,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const portalContainer = useStigmerPortalContainer();

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {/* The tooltip trigger is a wrapper span, not the popover trigger
          itself: `disabled` adds `pointer-events-none` to the button, so
          only the span keeps hover — the icon's name stays discoverable
          while the composer is disabled. */}
      <Tooltip>
        <TooltipTrigger render={<span className="stg:inline-flex" />}>
          <Popover.Trigger
            disabled={disabled}
            aria-label={label}
            className={cn(
              "stg:inline-flex stg:h-8 stg:w-8 stg:items-center stg:justify-center stg:rounded-md stg:text-xs stg:transition-colors",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <span className="stg:relative">
              {icon}
              {count > 0 && (
                <span className="stg:absolute stg:-right-1.5 stg:-top-1.5 stg:flex stg:h-3.5 stg:min-w-3.5 stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-0.5 stg:text-[0.5rem] stg:font-medium stg:leading-none stg:text-primary-foreground">
                  {count}
                </span>
              )}
            </span>
          </Popover.Trigger>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={[
              "stg:z-popover stg:overflow-x-hidden stg:overflow-y-auto stg:rounded-lg stg:border stg:border-border",
              "stg:bg-popover stg:p-3 stg:shadow-md stg:text-popover-foreground",
              "stg:max-h-[80vh]",
            ].join(" ")}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
