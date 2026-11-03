import type { ReactNode } from "react";
import { useResolvedColorMode } from "../hooks/useColorModePreference";

/**
 * The frame every screen before the app shares (connecting, the sign-in, a
 * server that cannot be used): the mark, one column, tokens only, black and
 * white, the look the sign-in screen has always had. These screens render
 * above the kit's provider, so the frame wears the person's colour scheme
 * itself.
 */
export function ServerScreen({ children }: { children: ReactNode }) {
  const colorMode = useResolvedColorMode();
  return (
    <div
      data-stgm-color-mode={colorMode}
      className="flex h-screen flex-col items-center justify-center bg-background p-8 text-foreground"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-8">
        <img src="/app-icon-light.svg" alt="Stigmer" className="size-14 rounded-2xl" />
        {children}
      </div>
    </div>
  );
}

/** The quiet link-styled action under a screen's main one. */
export function QuietAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}
