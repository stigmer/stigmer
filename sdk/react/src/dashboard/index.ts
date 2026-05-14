// ─── Types ──────────────────────────────────────────────────────────────────
export type { DashboardSummary, DashboardFailedRun } from "./types";

// ─── Data Hooks ─────────────────────────────────────────────────────────────
export {
  useAgentExecutionSummary,
  AgentExecutionSummaryTimeWindow,
  type UseAgentExecutionSummaryOptions,
  type UseAgentExecutionSummaryReturn,
} from "./useAgentExecutionSummary";

export {
  useDashboardSummary,
  type UseDashboardSummaryOptions,
  type UseDashboardSummaryReturn,
} from "./useDashboardSummary";

export {
  useDashboardFailedRuns,
  type UseDashboardFailedRunsReturn,
} from "./useDashboardFailedRuns";

// ─── Styled Components ─────────────────────────────────────────────────────
export {
  DashboardKPICards,
  type DashboardKPICardsProps,
} from "./DashboardKPICards";

export {
  DashboardFailedRuns,
  type DashboardFailedRunsProps,
} from "./DashboardFailedRuns";

export {
  OperationalDashboard,
  type OperationalDashboardProps,
} from "./OperationalDashboard";
