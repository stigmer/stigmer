"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Viewport } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { getAnimationDuration } from "./motion-preference";

/**
 * Follow-execution state machine states.
 *
 * - `auto_fit`: Initial state — viewport fitted to all nodes.
 * - `following`: Camera actively tracking the running task.
 * - `user_control`: User manually panned/zoomed — follow is paused.
 */
export type FollowState = "auto_fit" | "following" | "user_control";

/** Options for {@link useFollowExecution}. */
export interface UseFollowExecutionOptions {
  /** Whether follow-execution behavior is enabled (typically true when execution is running). */
  readonly enabled: boolean;
  /** The name of the currently active task (running or waiting_approval). */
  readonly activeTaskName: string | null;
  /** React Flow nodes array — used to find the active node's position. */
  readonly nodes: readonly Node[];
  /** Whether the initial fitView has completed. Follow waits for this. */
  readonly didInitialFit: boolean;
  /** Whether the execution has reached a terminal state. */
  readonly isTerminal: boolean;
  /**
   * Pixel width of panels (e.g. inspector) that reduce effective viewport width.
   * The follow center is offset leftward to account for this occluded area.
   * Defaults to 0.
   */
  readonly panelOffsetPx?: number;
}

/** Return value of {@link useFollowExecution}. */
export interface UseFollowExecutionReturn {
  /** Current state machine state. */
  readonly followState: FollowState;
  /** Whether follow is currently active (state === "following"). */
  readonly isFollowing: boolean;
  /** Toggle follow back on after user took manual control. */
  readonly enableFollow: () => void;
  /** Disable follow (user wants manual control). */
  readonly disableFollow: () => void;
  /**
   * Pass to React Flow's `onMoveStart` to detect user-initiated viewport changes.
   * When event is not null (real user interaction), transitions to user_control.
   */
  readonly handleMoveStart: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
}

const MIN_FOLLOW_ZOOM = 1.0;
const FOLLOW_ANIMATION_MS = 400;
const FOLLOW_DEBOUNCE_MS = 150;

/**
 * Behavior hook implementing a follow-execution state machine for the
 * workflow execution graph viewport.
 *
 * State machine transitions:
 * - auto_fit → following: first active task detected after initial fit
 * - following → user_control: user pans/zooms manually (event !== null)
 * - user_control → following: user clicks the "Follow" toggle
 * - following → following: active task changes (pan to new node)
 * - any → auto_fit: execution reaches terminal state (re-fit all)
 *
 * Respects prefers-reduced-motion for all viewport animations.
 * Offsets center point for inspector panel width.
 * Never zooms OUT — only ensures minimum zoom of 1.0.
 */
export function useFollowExecution(options: UseFollowExecutionOptions): UseFollowExecutionReturn {
  const { enabled, activeTaskName, nodes, didInitialFit, isTerminal, panelOffsetPx = 0 } = options;
  const { setCenter, getZoom, fitView } = useReactFlow();

  const [followState, setFollowState] = useState<FollowState>("auto_fit");
  const lastPannedTaskRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transition to auto_fit when execution completes
  useEffect(() => {
    if (isTerminal && followState !== "auto_fit") {
      setFollowState("auto_fit");
      lastPannedTaskRef.current = null;
      fitView({ padding: 0.15, duration: getAnimationDuration(300) });
    }
  }, [isTerminal, followState, fitView]);

  // Core follow logic: pan to active task when it changes
  useEffect(() => {
    if (!enabled || !didInitialFit || followState !== "following") return;
    if (!activeTaskName || activeTaskName === lastPannedTaskRef.current) return;

    const targetNode = nodes.find(
      (n) => (n.data as CanvasTaskNodeData).taskName === activeTaskName,
    );
    if (!targetNode) return;

    // Debounce rapid task changes (e.g., very fast sequential tasks)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const nodeWidth = targetNode.width ?? targetNode.measured?.width ?? 200;
      const nodeHeight = targetNode.height ?? targetNode.measured?.height ?? 56;
      const centerX = targetNode.position.x + nodeWidth / 2;
      const centerY = targetNode.position.y + nodeHeight / 2;

      // Offset for inspector panel: shift center leftward in flow coordinates
      const currentZoom = getZoom();
      const offsetX = panelOffsetPx > 0 ? (panelOffsetPx / 2) / currentZoom : 0;

      const targetZoom = Math.max(currentZoom, MIN_FOLLOW_ZOOM);
      const duration = getAnimationDuration(FOLLOW_ANIMATION_MS);

      setCenter(centerX - offsetX, centerY, { zoom: targetZoom, duration });
      lastPannedTaskRef.current = activeTaskName;
    }, FOLLOW_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled, didInitialFit, followState, activeTaskName, nodes, setCenter, getZoom, panelOffsetPx]);

  // Transition from auto_fit to following when first active task appears
  useEffect(() => {
    if (!enabled || !didInitialFit) return;
    if (followState === "auto_fit" && activeTaskName) {
      setFollowState("following");
    }
  }, [enabled, didInitialFit, followState, activeTaskName]);

  // Detect user-initiated viewport changes to transition to user_control
  const handleMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null, _viewport: Viewport) => {
      if (event !== null && followState === "following") {
        setFollowState("user_control");
      }
    },
    [followState],
  );

  const enableFollow = useCallback(() => {
    setFollowState("following");
    lastPannedTaskRef.current = null; // Force re-pan to current active task
  }, []);

  const disableFollow = useCallback(() => {
    setFollowState("user_control");
  }, []);

  return {
    followState,
    isFollowing: followState === "following",
    enableFollow,
    disableFollow,
    handleMoveStart,
  };
}
