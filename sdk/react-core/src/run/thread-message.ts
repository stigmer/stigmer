// One message of a conversation as a thread draws it: what a person wrote, or
// an agent's message, thinking or platform note from the session's fold. The
// conversation hook builds these and every thread (the React kit's and the
// terminal kit's) renders them.

import type { MessageItem, NoteItem, ThinkingItem } from "@stigmer/client";

/**
 * The message a person wrote to start a turn, as the thread renders it: the
 * turn's `user.message` (or, before the session's events carry it, the text
 * just sent).
 */
export interface UserMessageItem {
  readonly kind: "user";
  /** The `user.message` event's id, or a stand-in for one not yet sent. */
  readonly id: string;
  readonly text: string;
}

/**
 * One message of a conversation as a thread renders it: what a
 * person wrote, or an agent's message, thinking or platform note from the
 * session's fold.
 */
export type ThreadMessage = UserMessageItem | MessageItem | ThinkingItem | NoteItem;
