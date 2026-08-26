/**
 * Server build version — ports the Go platform package's
 * `var Version = "dev"` (set at build time via -ldflags).
 *
 * The TS equivalent of ldflags is an esbuild `define`: release builds
 * replace the __STIGMER_SERVER_VERSION__ identifier in scripts/
 * bundle-slim.mjs (owner-ratified at this sub-project's plan gate), so the
 * bundle carries its version as a compile-time constant — hermetic, no
 * package.json read at boot. Unbundled runs (tsx dev mode, vitest) leave
 * the identifier undefined and fall back to "dev", exactly Go's unstamped
 * default.
 */

declare const __STIGMER_SERVER_VERSION__: string | undefined;

/** The version getServerInfo reports (Go platform.Version). */
export const SERVER_VERSION: string =
  typeof __STIGMER_SERVER_VERSION__ === "string" &&
  __STIGMER_SERVER_VERSION__ !== ""
    ? __STIGMER_SERVER_VERSION__
    : "dev";
