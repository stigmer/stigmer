/**
 * The console's `mermaid` loader for `StigmerProvider`'s `loadMermaid`: the
 * kit draws ```mermaid fences as diagrams only with a host's import, and
 * Next splits this one into a chunk fetched on the first diagram. Shared by
 * every provider that renders a conversation.
 */
export const loadMermaid = () => import("mermaid");
