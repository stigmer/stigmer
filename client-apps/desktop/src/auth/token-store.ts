import type { StoredTokens } from "./pkce";

const STORAGE_KEY = "stigmer:auth:tokens";

/**
 * Token storage abstraction.
 *
 * Uses localStorage for MVP. Upgrade to `tauri-plugin-store` with
 * encryption or OS keychain (`tauri-plugin-stronghold`) when shipping
 * production builds.
 */
export function loadTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if stored tokens are expired (with a 60-second buffer).
 */
export function isExpired(tokens: StoredTokens): boolean {
  if (!tokens.expiresAt) return false;
  return Date.now() >= tokens.expiresAt - 60_000;
}
