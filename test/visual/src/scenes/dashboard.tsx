// The dashboard's figures, over a busy week's summary.
import { DashboardKPICards } from "@stigmer/react-sdk";
import { DASHBOARD_SUMMARY } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

export function dashboardScene(): Drawing {
  return { render: () => <DashboardKPICards summary={DASHBOARD_SUMMARY} isLoading={false} /> };
}
