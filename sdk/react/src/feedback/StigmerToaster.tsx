"use client";

import { Toaster } from "sonner";
import { useColorMode } from "../color-mode";
import type { StigmerToasterProps } from "./types";

/**
 * Themed toast container for Stigmer SDK components.
 *
 * Uses `data-stgm-color-mode` (via {@link useColorMode}) instead of
 * `next-themes` so it works identically in the Stigmer Console and in
 * any third-party host application.
 *
 * Mount once near your `<StigmerProvider />`:
 * ```tsx
 * <StigmerProvider client={client}>
 *   <App />
 *   <StigmerToaster />
 * </StigmerProvider>
 * ```
 */
export function StigmerToaster(props: StigmerToasterProps) {
  const colorMode = useColorMode();

  return (
    <Toaster
      theme={colorMode}
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
