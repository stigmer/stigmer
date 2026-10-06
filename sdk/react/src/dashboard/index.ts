// ─── Types ──────────────────────────────────────────────────────────────────
export type { DashboardSummary, DashboardFailedRun } from "./types.js";

// ─── Data Hooks ─────────────────────────────────────────────────────────────
export {
  useAgentRunSummary,
  AgentRunSummaryTimeWindow,
  type UseAgentRunSummaryOptions,
  type UseAgentRunSummaryReturn,
} from "./useAgentRunSummary.js";

export {
  useDashboardSummary,
  type UseDashboardSummaryOptions,
  type UseDashboardSummaryReturn,
} from "./useDashboardSummary.js";

export {
  useDashboardFailedRuns,
  type UseDashboardFailedRunsReturn,
} from "./useDashboardFailedRuns.js";

// ─── Styled Components ─────────────────────────────────────────────────────
export {
  DashboardKPICards,
  type DashboardKPICardsProps,
} from "./DashboardKPICards.js";

export {
  DashboardFailedRuns,
  type DashboardFailedRunsProps,
} from "./DashboardFailedRuns.js";

export {
  OperationalDashboard,
  type OperationalDashboardProps,
} from "./OperationalDashboard.js";
