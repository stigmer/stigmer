"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useDocsColorMode,
  type StigmerColorMode,
} from "@/components/docs/demos/shared/useDocsColorMode";
import { ASK_AI_READY_TIMEOUT_MS } from "./config";

/**
 * Lifecycle of the embedded chat, as observable from the host page:
 *
 * - `connecting` — the element is (or is about to be) mounted and the hosted
 *   page has not signalled yet. The panel covers the iframe so a slow or
 *   theme-mismatched frame never flashes through.
 * - `ready` — the hosted page minted a guest session (`stigmer:ready`).
 * - `unavailable` — the platform refused this origin (`stigmer:refused`) or
 *   nothing answered within the readiness timeout. Safe to offer a retry:
 *   an embed that never became ready has no conversation to lose.
 */
export type AskAiStatus = "connecting" | "ready" | "unavailable";

export interface AskAiPanelState {
  /** Whether the panel is currently shown. */
  open: boolean;
  /** Open/close the panel; opening the first time arms the embed mount. */
  setOpen: (open: boolean) => void;
  /**
   * Latch: true once the panel has ever been opened, and never false again.
   * Gates the `<stigmer-agent>` mount — merely reading the docs must never
   * mint a guest session — while letting the element stay mounted across
   * close/reopen so the conversation survives.
   */
  everOpened: boolean;
  /**
   * Color mode captured when the embed (re)mounts, then held stable: the
   * element rebuilds its iframe — wiping the conversation — if any attribute
   * changes, and the embed protocol has no live theme channel. A stale theme
   * is the deliberate trade against a wiped chat. `null` until first open.
   */
  pinnedTheme: StigmerColorMode | null;
  status: AskAiStatus;
  /**
   * Rebuilds the embed after `unavailable` (key the element with
   * `embedEpoch`). Re-pins the theme too — a fresh mount has no
   * conversation, so it is the one moment re-reading the theme is free.
   */
  retry: () => void;
  /**
   * Render key for `<stigmer-agent>`; bumped by {@link retry} so React
   * replaces the element (and its iframe) wholesale.
   */
  embedEpoch: number;
  /**
   * Callback ref for `<stigmer-agent>`: wires the `stigmer:ready` /
   * `stigmer:refused` listeners and arms the readiness timeout, returning a
   * React 19 ref cleanup that tears both down.
   */
  elementRef: (element: HTMLElement | null) => (() => void) | undefined;
}

/**
 * Headless behavior for the docs Ask AI panel — all state and embed
 * lifecycle, no rendering. Instantiated once by `AskAiProvider`; read
 * through `useAskAi()`.
 *
 * Kept presentation-free (and free of Fumadocs/Next specifics) so a future
 * extraction into `@stigmer/react` is a file move, not a rewrite.
 */
export function useAskAiPanel(): AskAiPanelState {
  const colorMode = useDocsColorMode();
  const [open, setOpenState] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [pinnedTheme, setPinnedTheme] = useState<StigmerColorMode | null>(null);
  const [status, setStatus] = useState<AskAiStatus>("connecting");
  const [embedEpoch, setEmbedEpoch] = useState(0);
  const readyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next) {
        setEverOpened(true);
        // Functional update keeps the pin first-write-wins: reopening after
        // a site theme toggle must NOT change the attribute mid-conversation.
        setPinnedTheme((pinned) => pinned ?? colorMode);
      }
    },
    [colorMode],
  );

  const retry = useCallback(() => {
    setStatus("connecting");
    setPinnedTheme(colorMode);
    setEmbedEpoch((epoch) => epoch + 1);
  }, [colorMode]);

  const elementRef = useCallback((element: HTMLElement | null) => {
    if (!element) return undefined;

    const settle = (next: AskAiStatus) => {
      if (readyTimeout.current !== null) {
        clearTimeout(readyTimeout.current);
        readyTimeout.current = null;
      }
      setStatus(next);
    };
    const onReady = () => settle("ready");
    const onRefused = () => settle("unavailable");

    element.addEventListener("stigmer:ready", onReady);
    element.addEventListener("stigmer:refused", onRefused);
    readyTimeout.current = setTimeout(
      () => settle("unavailable"),
      ASK_AI_READY_TIMEOUT_MS,
    );

    return () => {
      element.removeEventListener("stigmer:ready", onReady);
      element.removeEventListener("stigmer:refused", onRefused);
      if (readyTimeout.current !== null) {
        clearTimeout(readyTimeout.current);
        readyTimeout.current = null;
      }
    };
  }, []);

  // Referential stability is part of the contract (mirrors DD-010): the
  // context value must not churn consumers on unrelated re-renders.
  return useMemo(
    () => ({
      open,
      setOpen,
      everOpened,
      pinnedTheme,
      status,
      retry,
      embedEpoch,
      elementRef,
    }),
    [
      open,
      setOpen,
      everOpened,
      pinnedTheme,
      status,
      retry,
      embedEpoch,
      elementRef,
    ],
  );
}
