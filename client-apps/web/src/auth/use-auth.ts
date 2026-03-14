"use client";

import { useContext } from "react";
import { AuthContext } from "./context";
import type { AuthState } from "./types";

/**
 * Access the current auth state.
 *
 * This is the sole public API for auth consumers. Returns the full
 * `AuthState` including authentication status, user info, access token,
 * and login/logout actions.
 *
 * Throws if called outside `<AuthProvider>` — this is intentional to
 * surface wiring mistakes immediately during development (same pattern
 * as `useOrg()`).
 */
export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return state;
}
