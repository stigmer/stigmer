import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { useRoles, type InkRole } from "../theme.js";

/** Props for {@link RunProgress}. */
export interface RunProgressProps {
  /** Current run phase. */
  readonly phase: RunPhase;
}

interface PhaseDisplay {
  readonly label: string;
  readonly role?: InkRole;
  readonly showSpinner: boolean;
}

const PHASE_DISPLAY: ReadonlyMap<RunPhase, PhaseDisplay> = new Map([
  [RunPhase.RUN_PENDING, { label: "Pending", showSpinner: true }],
  [
    RunPhase.RUN_IN_PROGRESS,
    { label: "Running", role: "warning", showSpinner: true },
  ],
  [
    RunPhase.RUN_COMPLETED,
    { label: "Completed", role: "success", showSpinner: false },
  ],
  [
    RunPhase.RUN_FAILED,
    { label: "Failed", role: "danger", showSpinner: false },
  ],
  [
    RunPhase.RUN_CANCELLED,
    { label: "Cancelled", showSpinner: false },
  ],
  [
    RunPhase.RUN_TERMINATED,
    { label: "Terminated", role: "danger", showSpinner: false },
  ],
  [
    RunPhase.RUN_WAITING_FOR_APPROVAL,
    { label: "Waiting for approval", role: "warning", showSpinner: false },
  ],
  [RunPhase.RUN_PAUSED, { label: "Paused", showSpinner: false }],
]);

/**
 * Displays the current run phase as a compact terminal badge.
 *
 * Shows a spinner for active phases (pending, in-progress) and
 * static indicators for terminal phases.
 *
 * Renders nothing for unspecified phases.
 */
export function RunProgress({ phase }: RunProgressProps) {
  const role = useRoles();
  const display = PHASE_DISPLAY.get(phase);
  if (!display) return null;

  return (
    <Box gap={1} paddingLeft={1}>
      {display.showSpinner ? (
        <Text {...role[display.role ?? "accent"]}>
          <Spinner type="dots" />
        </Text>
      ) : (
        <Text {...(display.role ? role[display.role] : {})}>
          {phase === RunPhase.RUN_COMPLETED ? "✓" : "●"}
        </Text>
      )}
      <Text {...(display.role ? role[display.role] : role.muted)}>
        {display.label}
      </Text>
    </Box>
  );
}
