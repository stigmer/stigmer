// The view of one file given with a message: what the conversation hook
// hands the thread and what the file chips draw. Kept apart from the chips
// (MessageFiles.tsx) so the hook carries no component with its types.

/**
 * One file given with a message, as the thread shows it.
 *
 * Built from a run's `status.messageFiles` (`messageFileViews`) for a
 * turn the server recorded, and from the chat box's hand-off
 * (`FileHandOff.files`) for the optimistic bubble.
 */
export interface MessageFileView {
  /** The File's id (`"file_01j…"`): what its name, size and link are read by. */
  readonly fileId?: string;
  /** The filename, when known without reading the File. */
  readonly filename?: string;
  /** `"image"` shows a preview tile; `"document"` a click-to-download chip. */
  readonly kind: "image" | "document";
}
