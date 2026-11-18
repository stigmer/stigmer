import type { ReactNode } from "react";
import { useResolvedColorMode } from "../hooks/useColorModePreference";

/**
 * The colour scheme of every screen before the app (connecting, choosing a
 * server, the boot failure). These screens render above the kit's provider,
 * which is what themes the app, so this wrapper wears the person's scheme
 * itself; the screens inside are the kit's (`ServerConnectionView`,
 * `ServerChooserForm`, `StandaloneScreen`), which draw on its tokens.
 */
export function ServerScreen({ children }: { children: ReactNode }) {
  const colorMode = useResolvedColorMode();
  return <div data-stgm-color-mode={colorMode}>{children}</div>;
}
