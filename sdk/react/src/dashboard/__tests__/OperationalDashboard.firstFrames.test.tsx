/**
 * A new organization's dashboard from its first frame, over the real data
 * hooks: the week's summary answers at once and quiet, the all-time
 * summary answers later. Until that answer lands the figures wait as their
 * skeleton, so no zero card ever renders before the journey's card; then
 * the card stands alone. Pinned by recording every render of the cards,
 * so a single render of settled figures (four zeros) fails the case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { RunSummarySchema, RunSummaryTimeWindow } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import type { DashboardKPICardsProps } from "../DashboardKPICards";
import { OperationalDashboard } from "../OperationalDashboard";

// Every render of the figures, with what they were given.
const cardRenders = vi.hoisted(() => [] as Array<{ isLoading: boolean; settled: boolean }>);

vi.mock("../DashboardKPICards.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../DashboardKPICards.js")>();
  return {
    ...original,
    DashboardKPICards: (props: DashboardKPICardsProps) => {
      cardRenders.push({ isLoading: props.isLoading, settled: !props.isLoading && props.summary !== null });
      return <original.DashboardKPICards {...props} />;
    },
  };
});

afterEach(cleanup);

const LINKS = { connectProvider: "/models", createAgent: "/", startSession: "/" };

function renderNewOrganization() {
  let answerEver: () => void = () => {};
  const everAnswered = new Promise<void>((resolve) => {
    answerEver = resolve;
  });
  const client = {
    run: {
      getRunSummary: vi.fn(async (input: { timeWindow: RunSummaryTimeWindow }) => {
        if (input.timeWindow === RunSummaryTimeWindow.ALL_TIME) await everAnswered;
        return create(RunSummarySchema, {});
      }),
      getOrgUsageReport: vi.fn(async () => ({})),
      list: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
    },
    platform: { getModelReadiness: vi.fn(async () => ({ providers: [], models: [] })) },
    grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    agent: {
      list: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
      listVersions: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );

  cardRenders.length = 0;
  render(<OperationalDashboard org="org_new" firstStepLinks={LINKS} />, { wrapper });
  return { answerEver };
}

describe("OperationalDashboard for a new organization, frame by frame", () => {
  it("never shows a zero card before the journey's card", async () => {
    const { answerEver } = renderNewOrganization();
    // The week's quiet summary lands; the all-time read is still out.
    await act(async () => {});
    expect(screen.queryByText("Completed")).toBeNull();

    await act(async () => answerEver());
    expect(await screen.findByRole("region", { name: "From first agent to your users" })).toBeTruthy();

    expect(cardRenders.length).toBeGreaterThan(0);
    expect(cardRenders.filter((frame) => frame.settled)).toEqual([]);
  });
});
