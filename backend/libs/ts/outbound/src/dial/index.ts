/**
 * `@stigmer/outbound/dial`: the pinned dialer, whose every socket opens to
 * an address the egress policy judged, and `nodeGuardedFetch`, the guarded
 * fetch over it that a process composes at its root. Importing this entry
 * loads undici, which registers itself as the process's dispatcher; the
 * module header of `pinned-fetch.ts` says why that keeps it off the other
 * entries.
 */
export { nodeGuardedFetch, pinnedFetch, type NodeGuardedFetchOptions, type PinnedFetchOptions } from "./pinned-fetch.js";
