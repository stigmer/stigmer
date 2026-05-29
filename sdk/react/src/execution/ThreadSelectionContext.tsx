"use client";

import { createContext } from "react";
import type { SelectionStore } from "../internal/store/selection-store";

/**
 * Carries the {@link SelectionStore} instance (stable ref) into the
 * thread subtree.
 *
 * **Defaults to `null`.** When absent, `useThreadSelection` returns
 * `null` and selectable components (ToolCallGroup, SubAgentSection)
 * behave exactly as they did before this feature — no DOM changes,
 * no selection affordance (DD-011 opt-in).
 *
 * `SessionViewer` provides the store; bare `MessageThread` does not.
 *
 * @internal Not exported from the public SDK barrel — consumed only
 * by SDK components and `SessionViewer`.
 */
export const ThreadSelectionContext = createContext<SelectionStore | null>(null);
