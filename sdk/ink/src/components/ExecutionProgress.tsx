import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Props for {@link ExecutionProgress}. */
export interface ExecutionProgressProps {
  /** Current execution phase. */
  readonly phase: ExecutionPhase;
}

interface PhaseDisplay {
  readonly label: string;
  readonly color?: string;
  readonly showSpinner: boolean;
}

const PHASE_DISPLAY: ReadonlyMap<ExecutionPhase, PhaseDisplay> = new Map([
  [ExecutionPhase.EXECUTION_PENDING, { label: "Pending", showSpinner: true }],
  [
    ExecutionPhase.EXECUTION_IN_PROGRESS,
    { label: "Running", color: "yellow", showSpinner: true },
  ],
  [
    ExecutionPhase.EXECUTION_COMPLETED,
    { label: "Completed", color: "green", showSpinner: false },
  ],
  [
    ExecutionPhase.EXECUTION_FAILED,
    { label: "Failed", color: "red", showSpinner: false },
  ],
  [
    ExecutionPhase.EXECUTION_CANCELLED,
    { label: "Cancelled", showSpinner: false },
  ],
  [
    ExecutionPhase.EXECUTION_TERMINATED,
    { label: "Terminated", color: "red", showSpinner: false },
  ],
  [
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    { label: "Waiting for approval", color: "yellow", showSpinner: false },
  ],
  [ExecutionPhase.EXECUTION_PAUSED, { label: "Paused", showSpinner: false }],
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
          {phase === ExecutionPhase.EXECUTION_COMPLETED ? "✓" : "●"}
        </Text>
      )}
      <Text color={display.color} dimColor={!display.color}>
        {display.label}
      </Text>
    </Box>
  );
}
