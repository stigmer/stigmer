/**
 * Server build version: "dev" unless the build stamps one.
 *
 * The stamp is an esbuild `define`: release builds
 * replace the __STIGMER_SERVER_VERSION__ identifier in scripts/
 * bundle-slim.mjs, so the
 * bundle carries its version as a compile-time constant — hermetic, no
 * package.json read at boot. Unbundled runs (tsx dev mode, vitest) leave
 * the identifier undefined and fall back to "dev".
 */

declare const __STIGMER_SERVER_VERSION__: string | undefined;

/** The version getServerInfo reports. */
export const SERVER_VERSION: string =
  typeof __STIGMER_SERVER_VERSION__ === "string" &&
  __STIGMER_SERVER_VERSION__ !== ""
    ? __STIGMER_SERVER_VERSION__
    : "dev";
