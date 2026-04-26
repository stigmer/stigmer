import { createContext, useContext, type ReactNode } from "react";
import {
  useAppUpdater,
  type AppUpdaterState,
} from "./useAppUpdater";

const AppUpdaterCtx = createContext<AppUpdaterState | null>(null);

/**
 * Provides app-updater state to the component tree. Wraps the Tauri-specific
 * `useAppUpdater` hook so any descendant (e.g. Sidebar) can read the current
 * update status and trigger a manual check without prop drilling.
 *
 * Mount once inside `AuthenticatedApp`, above the router.
 */
export function AppUpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useAppUpdater();
  return (
    <AppUpdaterCtx.Provider value={updater}>{children}</AppUpdaterCtx.Provider>
  );
}

/**
 * Access the app-updater context.
 *
 * Throws if called outside `<AppUpdaterProvider>`.
 */
export function useAppUpdaterContext(): AppUpdaterState {
  const ctx = useContext(AppUpdaterCtx);
  if (!ctx) {
    throw new Error(
      "useAppUpdaterContext must be used within <AppUpdaterProvider>",
    );
  }
  return ctx;
}
