/**
 * No usage view shows money. Usage is counted in tokens and calls and never
 * priced, so every view that renders usage — the organization panel, the
 * dashboard KPI cards, the session widget and Usage tab, the summarization
 * badge and card — is rendered here over fully populated data, including the
 * run status's `estimated_cost_usd` (which stays on the wire only as a cost
 * cap's working number), and none may print a "$" or the word "cost". The
 * data hooks are stubbed so each view renders its populated state; each
 * view's own suite pins what it does show.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  GetOrgUsageReportOutputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ProviderKeySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import type { UseSessionUsageReturn } from "../session/useSessionUsage.js";
import type { SummarizationEventView } from "../run/useContextWindow.js";

const stubs = vi.hoisted(() => ({
  orgReport: null as GetOrgUsageReportOutput | null,
  session: null as UseSessionUsageReturn | null,
}));

vi.mock("../usage/useOrgUsageReport.js", () => ({
  useOrgUsageReport: () => ({ report: stubs.orgReport, isLoading: false, error: null, refetch: () => {} }),
}));

vi.mock("../session/useSessionUsage.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionUsage: () => stubs.session,
}));

import { OrgUsagePanel } from "../usage/OrgUsagePanel.js";
import { DashboardKPICards } from "../dashboard/DashboardKPICards.js";
import { UsageWidget } from "../run/UsageWidget.js";
import { UsageTab } from "../session/facets/UsageTab.js";
import { SummarizationBadge } from "../run/SummarizationBadge.js";
import { SummarizationCard } from "../run/SummarizationCard.js";

afterEach(cleanup);

const servedBy = [
  { providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 12_000n, llmCallCount: 10 },
  { providerKeySource: ProviderKeySource.PLATFORM, totalTokens: 4_000n, llmCallCount: 2 },
  { providerKeySource: ProviderKeySource.UNSPECIFIED, totalTokens: 2_400n, llmCallCount: 0 },
];

stubs.orgReport = create(GetOrgUsageReportOutputSchema, {
  org: "acme",
  totalRuns: 4,
  totalAgents: 1,
  totalSessions: 2,
  totalUsage: { totalTokens: 18_400n, llmCallCount: 12, servedBy },
  modelBreakdown: [
    { model: "claude-sonnet", provider: "anthropic", callCount: 12, inputTokens: 4_000n, outputTokens: 1_400n, totalTokens: 18_400n },
  ],
  dailyUsage: [{ date: "2026-10-13", runCount: 4, totalTokens: 18_400n, llmCallCount: 12 }],
  harnessUsage: [{ harness: "native", totalTokens: 18_400n, callCount: 12, runCount: 4 }],
  topAgents: [{ agentId: "agt_1", agentName: "Support Bot", runCount: 4, totalTokens: 18_400n }],
});

stubs.session = {
  totalTokens: 18_400,
  inputTokens: 4_000,
  outputTokens: 1_400,
  cacheReadTokens: 13_000,
  cacheCreationTokens: 0,
  llmCallCount: 12,
  modelBreakdown: [
    { model: "claude-sonnet", provider: "anthropic", totalTokens: 16_000, inputTokens: 3_000, outputTokens: 1_000, cacheCreationTokens: 0, cacheReadTokens: 12_000, callCount: 10 },
    { model: "composer-2", provider: "cursor", totalTokens: 2_400, inputTokens: 1_000, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 1_000, callCount: 0 },
  ],
  runBreakdown: [{ runId: "run_1", resolvedModel: "claude-sonnet", totalTokens: 18_400, isEstimated: true }],
  servedBy: servedBy.map((s) => ({ ...s, totalTokens: Number(s.totalTokens) })),
  primaryModel: "claude-sonnet",
  primaryProvider: "anthropic",
  hasUsage: true,
  isEstimated: true,
};

const runs = [
  create(RunSchema, {
    metadata: { id: "run_1" },
    spec: { target: { case: "sessionId", value: "ses_1" } },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      streamingUsage: { totalTokens: 18_400n, turnCount: 3, estimatedCostUsd: 1.25, model: "claude-sonnet" },
    },
  }),
];

const summarization: SummarizationEventView = {
  timestamp: "2026-10-13T10:30:00.000Z",
  tokensBefore: 180_000,
  tokensAfter: 80_000,
  compressionRatio: 0.56,
  durationMs: 2300,
  model: "claude-haiku-4",
  messagesBefore: 42,
  messagesAfter: 12,
};

function expectNoMoney(container: HTMLElement): void {
  const text = container.textContent ?? "";
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toContain("$");
  expect(text).not.toMatch(/\bcost\b/i);
}

describe("usage views show no money", () => {
  it("the organization usage panel, with a day hovered", () => {
    const { container, getAllByTestId } = render(<OrgUsagePanel org="acme" />);
    fireEvent.mouseEnter(getAllByTestId("daily-token-bar")[0]!);
    expectNoMoney(container);
  });

  it("the dashboard KPI cards", () => {
    const { container } = render(
      <DashboardKPICards
        summary={{ activeCount: 1, completedCount: 3, failedCount: 0, totalTokens: 18_400, orgUsage: stubs.orgReport }}
        isLoading={false}
      />,
    );
    expectNoMoney(container);
  });

  it("the session usage widget and Usage tab", () => {
    expectNoMoney(render(<UsageWidget runs={runs} />).container);
    cleanup();
    expectNoMoney(render(<UsageTab runs={runs} />).container);
  });

  it("the summarization badge, expanded, and card", () => {
    const badge = render(<SummarizationBadge events={[summarization]} />);
    fireEvent.click(badge.getByRole("button"));
    expectNoMoney(badge.container);
    cleanup();
    expectNoMoney(render(<SummarizationCard event={summarization} />).container);
  });
});
