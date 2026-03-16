import { Badge } from "../../internal/badge.js";
import { phaseLabel, phaseVariant, isTerminalPhase } from "../helpers.js";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { Loader2 } from "lucide-react";

interface ExecutionStatusProps {
  phase: ExecutionPhase;
  className?: string;
}

export function ExecutionStatus({ phase, className }: ExecutionStatusProps) {
  const isActive =
    phase === ExecutionPhase.EXECUTION_IN_PROGRESS ||
    phase === ExecutionPhase.EXECUTION_PENDING;
  const isWaiting = phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

  return (
    <Badge
      variant={phaseVariant(phase)}
      className={cn(isWaiting && "animate-pulse", className)}
    >
      {isActive && (
        <Loader2 className="size-3 animate-spin" data-icon="inline-start" />
      )}
      {phaseLabel(phase)}
      {isTerminalPhase(phase) &&
        phase === ExecutionPhase.EXECUTION_COMPLETED && (
          <span data-icon="inline-end">✓</span>
        )}
    </Badge>
  );
}
