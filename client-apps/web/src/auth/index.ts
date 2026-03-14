// ---------------------------------------------------------------------------
// Auth module — public API
//
// This barrel export defines everything that code outside src/auth/ is
// allowed to import. Internal files (context.tsx, config.ts, token-store.ts,
// disabled/, oidc/) are implementation details and should not be imported
// directly by app components.
// ---------------------------------------------------------------------------

export { useAuth } from "./use-auth";
export { AuthProvider } from "./AuthProvider";
export { AuthGuard } from "./AuthGuard";

export type { AuthMode, AuthUser, AuthState, AuthConfig } from "./types";
