import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";

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
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {icon}
        <span>{label}</span>
        {count > 0 && (
          <span className="rounded-full bg-primary-subtle px-1.5 text-[0.6rem] font-medium text-primary">
            {count}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
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
