import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

/** Props for {@link ExecutionProgress}. */
export interface ExecutionProgressProps {
  /** Current execution phase. */
  readonly phase: RunPhase;
}

interface PhaseDisplay {
  readonly label: string;
  readonly color?: string;
  readonly showSpinner: boolean;
}

const PHASE_DISPLAY: ReadonlyMap<RunPhase, PhaseDisplay> = new Map([
  [RunPhase.RUN_PENDING, { label: "Pending", showSpinner: true }],
  [
    RunPhase.RUN_IN_PROGRESS,
    { label: "Running", color: "yellow", showSpinner: true },
  ],
  [
    RunPhase.RUN_COMPLETED,
    { label: "Completed", color: "green", showSpinner: false },
  ],
  [
    RunPhase.RUN_FAILED,
    { label: "Failed", color: "red", showSpinner: false },
  ],
  [
    RunPhase.RUN_CANCELLED,
    { label: "Cancelled", showSpinner: false },
  ],
  [
    RunPhase.RUN_TERMINATED,
    { label: "Terminated", color: "red", showSpinner: false },
  ],
  [
    RunPhase.RUN_WAITING_FOR_APPROVAL,
    { label: "Waiting for approval", color: "yellow", showSpinner: false },
  ],
  [RunPhase.RUN_PAUSED, { label: "Paused", showSpinner: false }],
]);

/**
 * Displays the current execution phase as a compact terminal badge.
 *
 * Shows a spinner for active phases (pending, in-progress) and
 * static indicators for terminal phases.
 *
 * Renders nothing for unspecified phases.
 */
export function ExecutionProgress({ phase }: ExecutionProgressProps) {
  const display = PHASE_DISPLAY.get(phase);
  if (!display) return null;

  return (
    <Box gap={1} paddingLeft={1}>
      {display.showSpinner ? (
        <Text color={display.color ?? "cyan"}>
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text color={display.color}>
          {phase === RunPhase.RUN_COMPLETED ? "✓" : "●"}
        </Text>
      )}
      <Text color={display.color} dimColor={!display.color}>
        {display.label}
      </Text>
    </Box>
  );
}
