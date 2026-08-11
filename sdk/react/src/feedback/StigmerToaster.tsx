"use client";

import { Toaster } from "sonner";
import { useColorMode } from "../color-mode.js";
import type { StigmerToasterProps } from "./types.js";

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
      className="toaster stg:group"
      toastOptions={{
        classNames: {
          toast:
            // `toast` is sonner's own class (referenced by the group-[.toast]
            // variants below); `stg:group` is OUR marker so those variants
            // resolve against `.stg\:group` in the prefixed build.
            "stg:group toast stg:group-[.toaster]:bg-background stg:group-[.toaster]:text-foreground stg:group-[.toaster]:border-border stg:group-[.toaster]:shadow-lg",
          description: "stg:group-[.toast]:text-muted-foreground",
          actionButton:
            "stg:group-[.toast]:bg-primary stg:group-[.toast]:text-primary-foreground",
          cancelButton:
            "stg:group-[.toast]:bg-muted stg:group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
