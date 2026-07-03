"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Viewport } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { getAnimationDuration } from "./motion-preference.js";

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

/** Inputs for the pure centering computation. */
export interface FollowCenterInput {
  /** Node position x in flow coordinates. */
  readonly nodeX: number;
  /** Node position y in flow coordinates. */
  readonly nodeY: number;
  /** Node width in flow coordinates. */
  readonly nodeWidth: number;
  /** Node height in flow coordinates. */
  readonly nodeHeight: number;
  /** Current viewport zoom level. */
  readonly currentZoom: number;
  /** Pixel width of an overlay panel occluding the viewport. 0 = no occlusion. */
  readonly panelOffsetPx: number;
}

/** Result of the centering computation. */
export interface FollowCenterResult {
  /** X coordinate to pass to React Flow's setCenter. */
  readonly x: number;
  /** Y coordinate to pass to React Flow's setCenter. */
  readonly y: number;
  /** Zoom level to pass to React Flow's setCenter. */
  readonly zoom: number;
}

/**
 * Pure function that computes the viewport center point for following an
 * active node. Extracted from hook internals for testability (DD-003).
 *
 * When `panelOffsetPx > 0`, the center is shifted leftward in flow coordinates
 * so the node appears centered in the *unoccluded* portion of the viewport.
 * The shift is inversely proportional to zoom (larger zoom → smaller shift).
 */
export function computeFollowCenter(input: FollowCenterInput): FollowCenterResult {
  const centerX = input.nodeX + input.nodeWidth / 2;
  const centerY = input.nodeY + input.nodeHeight / 2;

  const offsetX = input.panelOffsetPx > 0
    ? (input.panelOffsetPx / 2) / input.currentZoom
    : 0;

  return {
    x: centerX - offsetX,
    y: centerY,
    zoom: Math.max(input.currentZoom, MIN_FOLLOW_ZOOM),
  };
}

/** Inputs for the follow-selection decision. */
export interface FollowSelectionInput {
  /** Whether the follow state machine is in "following" state. */
  readonly isFollowing: boolean;
  /** The currently active (running/waiting) task name, or null. */
  readonly activeTaskName: string | null;
  /** The currently selected task name in the graph, or null. */
  readonly currentSelectedTask: string | null;
}

/**
 * Pure function that determines whether follow-selection should update
 * the selected task. Returns the task name to select, or `null` when
 * no change is needed. Extracted for testability (DD-003).
 *
 * Selection should update when all three conditions hold:
 * 1. Follow is active (`isFollowing`)
 * 2. An active task exists (`activeTaskName`)
 * 3. The active task differs from the current selection
 */
export function computeFollowSelection(input: FollowSelectionInput): string | null {
  if (!input.isFollowing || !input.activeTaskName) return null;
  if (input.activeTaskName === input.currentSelectedTask) return null;
  return input.activeTaskName;
}

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

      const center = computeFollowCenter({
        nodeX: targetNode.position.x,
        nodeY: targetNode.position.y,
        nodeWidth,
        nodeHeight,
        currentZoom: getZoom(),
        panelOffsetPx,
      });
      const duration = getAnimationDuration(FOLLOW_ANIMATION_MS);

      setCenter(center.x, center.y, { zoom: center.zoom, duration });
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
