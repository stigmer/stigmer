import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { useStigmerPortalContainer } from "../portal-container";

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
      <Popover.Trigger
        disabled={disabled}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <span className="relative">
          {icon}
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5rem] font-medium leading-none text-primary-foreground">
              {count}
            </span>
          )}
        </span>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={[
              "z-popover overflow-x-hidden overflow-y-auto rounded-lg border border-border",
              "bg-popover p-3 shadow-md text-popover-foreground",
              "max-h-[80vh]",
            ].join(" ")}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
