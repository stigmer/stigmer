/**
 * The desktop app's `mermaid` loader for `StigmerProvider`'s `loadMermaid`:
 * the kit draws ```mermaid fences as diagrams only with a host's import, and
 * Vite splits this one into a chunk fetched on the first diagram.
 */
export const loadMermaid = () => import("mermaid");
