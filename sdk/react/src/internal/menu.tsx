"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@stigmer/theme";
import { CheckIcon } from "lucide-react";
import { useStigmerPortalContainer } from "../portal-container.js";

// ---------------------------------------------------------------------------
// SDK-internal styled Menu primitives over @base-ui/react.
//
// These are NOT exported from @stigmer/react. They provide a single source
// of truth for dropdown menu styling across SDK styled components
// (OrgSwitcher, UserMenu, etc.) so that every menu looks identical.
//
// Portaled content uses popover-* / main-area tokens per DD-005.
// ---------------------------------------------------------------------------

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />;
}

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger {...props} />;
}

function MenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const portalContainer = useStigmerPortalContainer();

  return (
    <MenuPrimitive.Portal container={portalContainer}>
      <MenuPrimitive.Positioner
        className="stg:isolate stg:z-50 stg:outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "stg:bg-popover stg:text-popover-foreground stg:ring-foreground/10",
            "stg:data-[side=bottom]:slide-in-from-top-2 stg:data-[side=inline-end]:slide-in-from-left-2 stg:data-[side=inline-start]:slide-in-from-right-2 stg:data-[side=left]:slide-in-from-right-2 stg:data-[side=right]:slide-in-from-left-2 stg:data-[side=top]:slide-in-from-bottom-2",
            "stg:data-open:animate-in stg:data-open:fade-in-0 stg:data-open:zoom-in-95",
            "stg:data-closed:animate-out stg:data-closed:fade-out-0 stg:data-closed:zoom-out-95",
            "stg:z-50 stg:max-h-(--available-height) stg:w-(--anchor-width) stg:min-w-32 stg:origin-(--transform-origin) stg:overflow-x-hidden stg:overflow-y-auto stg:rounded-lg stg:p-1 stg:shadow-md stg:ring-1 stg:duration-100 stg:outline-none stg:data-closed:overflow-hidden",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-variant={variant}
      className={cn(
        "stg:focus:bg-accent stg:focus:text-accent-foreground stg:not-data-[variant=destructive]:focus:**:text-accent-foreground",
        "stg:data-[variant=destructive]:text-destructive stg:data-[variant=destructive]:focus:bg-destructive-subtle stg:data-[variant=destructive]:focus:text-destructive stg:data-[variant=destructive]:*:[svg]:text-destructive",
        "stg:relative stg:flex stg:cursor-default stg:items-center stg:gap-1.5 stg:rounded-md stg:px-1.5 stg:py-1 stg:text-sm stg:outline-hidden stg:select-none",
        "stg:data-disabled:pointer-events-none stg:data-disabled:opacity-50",
        "stg:[&_svg]:pointer-events-none stg:[&_svg]:shrink-0 stg:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup {...props} />;
}

function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "stg:focus:bg-accent stg:focus:text-accent-foreground stg:focus:**:text-accent-foreground",
        "stg:relative stg:flex stg:cursor-default stg:items-center stg:gap-1.5 stg:rounded-md stg:py-1 stg:pr-8 stg:pl-1.5 stg:text-sm stg:outline-hidden stg:select-none",
        "stg:data-disabled:pointer-events-none stg:data-disabled:opacity-50",
        "stg:[&_svg]:pointer-events-none stg:[&_svg]:shrink-0 stg:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="stg:pointer-events-none stg:absolute stg:right-2 stg:flex stg:items-center stg:justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function MenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("stg:bg-border stg:-mx-1 stg:my-1 stg:h-px", className)}
      {...props}
    />
  );
}

function MenuGroup({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { role?: string }) {
  return <div role="group" className={className} {...props} />;
}

function MenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "stg:text-muted-foreground stg:block stg:px-1.5 stg:py-1 stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:select-none",
        className,
      )}
      {...props}
    />
  );
}

export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuLabel,
};
