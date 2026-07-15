"use client";

// The session viewer's panel toggle chip — a session-named alias of the
// shared workspace PanelChip (the workflow viewer mounts the same chip).

import { PanelChip, type PanelChipProps } from "../workspace/PanelChip.js";

/** Props for {@link SessionPanelChip}. */
export type SessionPanelChipProps = PanelChipProps;

/**
 * The always-mounted top-right toggle for the unified session panel — see
 * {@link PanelChip} for behavior (badge-while-collapsed, focus restoration).
 * Kept as a named alias so session-side call sites and tests read in the
 * session's vocabulary.
 */
export const SessionPanelChip = PanelChip;
