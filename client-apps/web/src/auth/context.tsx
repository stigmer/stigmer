"use client";

import { createContext } from "react";
import type { AuthState } from "./types";

/**
 * React context for auth state.
 *
 * Separated from the provider components to prevent circular imports:
 * both the provider implementations (disabled, oidc) and the `useAuth()`
 * hook import from this file, but neither imports the other.
 *
 * The context value is `null` when no provider is mounted — `useAuth()`
 * throws in this case to surface wiring mistakes during development.
 */
export const AuthContext = createContext<AuthState | null>(null);
