/**
 * The content hash of a typed spec, for every kind whose version is its
 * stored spec rather than a pushed archive (agents today; skills and
 * plugins hash their archive bytes). The rendering is the store's canonical
 * one (store/canonical.ts says why it moves only when the content does);
 * this module keeps the names the pipeline and the migrations import.
 */
export { canonicalJson, canonicalSpecHash } from "../../store/canonical.js";
