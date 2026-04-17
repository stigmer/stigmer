"use client";

import { useCallback, useRef, useState } from "react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useStepInteractions } from "../../engine/useStepInteractions";
import { Cursor } from "../../engine/Cursor";
import { DemoViewport } from "../../engine/DemoViewport";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type DragReorderStep,
  type TaskItem,
  DRAG_INTERACTIONS,
  dragReorderSteps,
} from "./steps";

// ---------------------------------------------------------------------------
// Board UI (inlined — single-consumer validation scenario)
// ---------------------------------------------------------------------------

function TaskCard({
  item,
  isDragging,
}: {
  readonly item: TaskItem;
  readonly isDragging: boolean;
}) {
  return (
    <div
      data-cursor-target={item.id}
      className={
        "rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-sm transition-opacity" +
        (isDragging ? " opacity-50" : "")
      }
    >
      {item.label}
    </div>
  );
}

function Column({
  title,
  items,
  dropTargetId,
  draggingItemId,
}: {
  readonly title: string;
  readonly items: readonly TaskItem[];
  readonly dropTargetId: string;
  readonly draggingItemId: string | undefined;
}) {
  return (
    <div className="flex w-1/2 flex-col gap-2">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <div
        data-cursor-target={dropTargetId}
        className="flex min-h-[80px] flex-col gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 p-2"
      >
        {items.map((item) => (
          <TaskCard
            key={item.id}
            item={item}
            isDragging={draggingItemId === item.id}
          />
        ))}
      </div>
    </div>
  );
}

function Board({
  step,
  draggingItemId,
}: {
  readonly step: DragReorderStep;
  readonly draggingItemId: string | undefined;
}) {
  return (
    <div className="flex h-[380px] items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-md gap-4">
        <Column
          title="Backlog"
          items={step.backlog}
          dropTargetId="drop-backlog"
          draggingItemId={draggingItemId}
        />
        <Column
          title="In Progress"
          items={step.inProgress}
          dropTargetId="drop-in-progress"
          draggingItemId={draggingItemId}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario component
// ---------------------------------------------------------------------------

/**
 * Drag interaction validation scenario.
 *
 * Renders a minimal two-column task board. Step 0 triggers a drag
 * action that moves "task-alpha" from the Backlog column to the
 * In Progress drop zone. Step 1 shows the board with the card in
 * its new position.
 *
 * Validates: cursor grab icon, `data-dragging` attribute, pointer
 * event dispatch, and cursor animation between source and
 * destination.
 *
 * Not registered in SCENARIO_REGISTRY — this is a validation
 * fixture, not a recordable demo.
 */
export function DragReorderValidation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [showRipple, setShowRipple] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [draggingItemId, setDraggingItemId] = useState<string | undefined>();

  const handleStepChange = useCallback(
    (_step: DragReorderStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
      setDraggingItemId(undefined);
      setIsDragging(false);
    },
    [],
  );

  const handleSetDragging = useCallback((dragging: boolean) => {
    setIsDragging(dragging);
    if (dragging) {
      setDraggingItemId("task-alpha");
    } else {
      setDraggingItemId(undefined);
    }
  }, []);

  useStepInteractions({
    stepIndex,
    interactions: DRAG_INTERACTIONS,
    narrationManifest: undefined,
    containerRef,
    setCursorTarget,
    steps: dragReorderSteps,
    setShowRipple,
    setDragging: handleSetDragging,
  });

  return (
    <div className={DEMO_PLAYER_CLASSES}>
      <DemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={dragReorderSteps}
          onStepChange={handleStepChange}
        >
          {(step) => <Board step={step} draggingItemId={draggingItemId} />}
        </ScenarioPlayer>
        <Cursor
          target={cursorTarget}
          containerRef={containerRef}
          showRipple={showRipple}
          isDragging={isDragging}
        />
      </DemoViewport>
    </div>
  );
}
