"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerPrimitive } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerPrimitive>;

/**
 * Themed toast container that follows the active color mode.
 *
 * Wraps sonner's `<Toaster />` with:
 * - Theme sync via `next-themes` (light/dark/system follows the user's choice)
 * - CSS variable integration so toasts match the design system tokens
 * - `richColors` for semantic severity (success = green, error = red, etc.)
 * - Top-right position (developer tool convention)
 */
export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <SonnerPrimitive
      theme={theme as ToasterProps["theme"]}
      position="top-right"
      richColors
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
