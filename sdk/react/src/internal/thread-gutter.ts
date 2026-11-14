// The session's one edge, shared by the session view's header, its thread
// column and its composer, so every block in a session lines up on it.

/**
 * The column's one edge: 16px, and 24px once the session it sits in is
 * 640px wide or more. It reads the session's own width (the named container
 * `session`, which the session view draws), not the viewport's, so a session
 * docked in a narrow panel on a wide screen keeps a phone's edge. Every item
 * in the column draws flush to it: none adds an edge of its own.
 */
export const THREAD_GUTTER_CLASS = "stg:px-4 stg:@min-[40rem]/session:px-6";
