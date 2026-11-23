"use client";

// The thread's own built-ins, handed down to everything it draws. A
// `threadSlots` part, a tool card or anything else a host draws inside the
// thread may hand a case back to one of ours; the light chat entry's
// built-ins (`lazy-built-ins.tsx`) read the real component here, so a host
// importing them from `@stigmer/react-sdk/chat` does not pull our renderer
// into the page's first download, and the part still draws on the thread's
// very first frame. The value is a module constant (`SLOT_BUILT_INS`), so no
// reader re-renders for it. This module names the components by type only:
// importing it costs a context, not a renderer.

import { createContext } from "react";
import type { MessageThreadSlots } from "./MessageThread.js";

/** Every slot's built-in, as the thread holds them. */
export type SlotBuiltIns = Required<MessageThreadSlots>;

/**
 * The thread's built-ins; `null` outside any thread.
 *
 * @internal
 */
export const BuiltInsContext = createContext<SlotBuiltIns | null>(null);
BuiltInsContext.displayName = "BuiltInsContext";
