import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

export interface TaskItem {
  readonly id: string;
  readonly label: string;
}

export type DragReorderStep =
  | { readonly view: "board"; readonly backlog: readonly TaskItem[]; readonly inProgress: readonly TaskItem[] }
  | { readonly view: "board-after-drag"; readonly backlog: readonly TaskItem[]; readonly inProgress: readonly TaskItem[] };

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const TASK_ALPHA: TaskItem = { id: "task-alpha", label: "Set up agent blueprint" };
const TASK_BETA: TaskItem = { id: "task-beta", label: "Configure MCP server" };
const TASK_GAMMA: TaskItem = { id: "task-gamma", label: "Add approval policy" };

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const dragReorderSteps: ScenarioStep<DragReorderStep>[] = [
  {
    delayMs: 0,
    data: {
      view: "board",
      backlog: [TASK_ALPHA, TASK_BETA],
      inProgress: [TASK_GAMMA],
    },
    interactions: [
      { atPercent: 0.2, type: "drag", target: "task-alpha", dragTarget: "drop-in-progress" },
    ],
  },
  {
    delayMs: 3000,
    data: {
      view: "board-after-drag",
      backlog: [TASK_BETA],
      inProgress: [TASK_GAMMA, TASK_ALPHA],
    },
  },
];
