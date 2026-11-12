/**
 * Pins the composed dashboard's wiring: both data hooks read the one
 * organization it was given, the KPI cards and the recent failures render
 * inside the labelled region, and a failed run's View hands its id to the
 * host. Then the journey's card (`useJourney`, stubbed here): alone in the
 * figures' place while nothing has ever run; above the figures once
 * something has; none for a person the journey is not for, none while it is
 * read (the figures wait as their skeleton), and none read at all for a
 * host that passes no links. "Hide" removes it for this person in this
 * organization, remembered in this browser, a hidden card reads nothing,
 * and blocked storage still hides it for the visit. Figures that could not
 * be read are said with a retry, never drawn as zeros; no organization is
 * said, not drawn. The cards, the failures list and the card's rows are
 * pinned in their own suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import type { DashboardSummary } from "../types";

const state = vi.hoisted(() => ({
  asked: { summary: [] as unknown[], failed: [] as unknown[], journey: [] as Array<{ org: unknown; enabled: boolean }> },
  week: null as DashboardSummary | null,
  weekError: null as Error | null,
  journey: "new" as "new" | "ran" | "off" | "pending",
  refetch: (() => {}) as () => void,
}));

vi.mock("../useDashboardSummary.js", () => ({
  useDashboardSummary: (options: { org: unknown }) => {
    state.asked.summary.push(options.org);
    return { summary: state.week, isLoading: false, error: state.weekError, refetch: state.refetch };
  },
}));

/** A journey with the first `done` steps done (step 3 is "Watch it work"). */
function journeyAt(done: number) {
  const titles = ["Say what it should do", "Add a model key", "Watch it work", "Make it yours", "Put it in your app", "Bring others in"];
  const ids = ["describe", "key", "watch", "make-yours", "in-app", "others"];
  const steps = ids.map((id, index) => ({
    id,
    number: index + 1,
    title: titles[index],
    state: index < done ? "done" : index === done ? "current" : "todo",
    line: index < done ? `${titles[index]} is done` : `Take ${titles[index]}`,
  }));
  return {
    status: "ready",
    steps,
    done,
    current: steps[done],
    agent: { ref: { org: "org_acme", slug: "variance-reporter" }, name: "Variance Reporter" },
  };
}

vi.mock("../../journey/useJourney.js", () => ({
  useJourney: (org: unknown, options: { enabled: boolean }) => {
    state.asked.journey.push({ org, enabled: options.enabled });
    if (!options.enabled || state.journey === "off") return { status: "off", steps: [], done: 0, current: undefined, agent: undefined };
    if (state.journey === "pending") return { status: "pending", steps: [], done: 0, current: undefined, agent: undefined };
    return journeyAt(state.journey === "new" ? 1 : 3);
  },
}));

vi.mock("../useDashboardFailedRuns.js", () => ({
  useDashboardFailedRuns: (org: unknown) => {
    state.asked.failed.push(org);
    return {
      failedRuns: [
        {
          id: "run_9",
          name: "Nightly triage",
          error: "model refused",
          failedAt: new Date("2026-10-01T00:00:00Z"),
          resourceName: "triage-bot",
        },
      ],
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));

import { OperationalDashboard } from "../OperationalDashboard";
import { JOURNEY_HIDDEN_STORAGE_KEY } from "../../journey/journeyHidden";

const BUSY: DashboardSummary = { activeCount: 1, completedCount: 3, failedCount: 1, totalTokens: 0, orgUsage: null };
const QUIET: DashboardSummary = { activeCount: 0, completedCount: 0, failedCount: 0, totalTokens: 0, orgUsage: null };
const LINKS = { connectProvider: "/models", createAgent: "/", startSession: "/" };

const CARD = "From first agent to your users";

beforeEach(() => {
  state.asked = { summary: [], failed: [], journey: [] };
  state.week = BUSY;
  state.weekError = null;
  state.journey = "new";
  state.refetch = () => {};
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OperationalDashboard", () => {
  it("reads one organization and renders the cards and the failures in its region", () => {
    const onFailedRunClick = vi.fn();
    render(<OperationalDashboard org="acme" onFailedRunClick={onFailedRunClick} />);

    expect(state.asked.summary.at(-1)).toBe("acme");
    expect(state.asked.failed.at(-1)).toBe("acme");

    const region = screen.getByRole("region", { name: "Platform dashboard" });
    expect(within(region).getByText("Completed").nextElementSibling?.textContent).toBe("3");
    expect(within(region).getByText("Nightly triage")).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "View" }));
    expect(onFailedRunClick).toHaveBeenCalledWith("run_9");
  });

  it("shows an organization where nothing has ever run the journey's card alone, in the figures' place", () => {
    state.week = QUIET;
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    const region = screen.getByRole("region", { name: "Platform dashboard" });
    expect(within(region).getByRole("region", { name: CARD })).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Add a key" }).getAttribute("href")).toBe("/models");
    expect(within(region).queryByText("Completed")).toBeNull();
    expect(within(region).queryByText("Nightly triage")).toBeNull();
    expect(state.asked.journey).toContainEqual({ org: "acme", enabled: true });
  });

  it("keeps the card above the figures once something has run, until every step is done", () => {
    state.journey = "ran";
    state.week = QUIET;
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    const card = screen.getByRole("region", { name: CARD });
    expect(card.textContent).toContain("3 of 6");
    const figures = screen.getByText("Completed");
    expect(figures.nextElementSibling?.textContent).toBe("0");
    // The card comes first in the page.
    expect(card.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("CON-01 shows a person the journey is not for no card, only the figures", () => {
    state.journey = "off";
    state.week = QUIET;
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
    expect(screen.getByText("Completed").nextElementSibling?.textContent).toBe("0");
  });

  it("holds the figures as their skeleton, with no card, while the journey is read", () => {
    state.journey = "pending";
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("reads no journey for a host that passes no links", () => {
    state.week = QUIET;
    render(<OperationalDashboard org="acme" />);

    expect(state.asked.journey.every((asked) => !asked.enabled)).toBe(true);
    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
  });

  it("hides the card for this person in this organization, remembered across visits, and then reads nothing", () => {
    state.journey = "ran";
    const { unmount } = render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide these steps" }));

    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
    expect(window.localStorage.getItem(`${JOURNEY_HIDDEN_STORAGE_KEY}:acme`)).toBe("1");
    unmount();

    state.asked.journey = [];
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);
    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
    expect(state.asked.journey.every((asked) => !asked.enabled)).toBe(true);
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("keeps each organization's Hide its own", () => {
    window.localStorage.setItem(`${JOURNEY_HIDDEN_STORAGE_KEY}:other`, "1");
    state.journey = "ran";
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    expect(screen.getByRole("region", { name: CARD })).toBeTruthy();
  });

  it("shows the card when storage is blocked, and Hide still hides it for the visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    state.journey = "ran";
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide these steps" }));
    expect(screen.queryByRole("region", { name: CARD })).toBeNull();
  });

  it("says figures that could not be read, with a retry, and draws no zeros in their place", () => {
    state.week = QUIET;
    // A transient refusal, which the message offers to retry.
    state.weekError = new ConnectError("the usage report is unavailable", Code.Unavailable);
    state.refetch = vi.fn();
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The week's figures could not be read");
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(state.refetch).toHaveBeenCalled();
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("says when no organization is active instead of drawing its figures", () => {
    render(<OperationalDashboard org="" firstStepLinks={LINKS} />);

    expect(screen.getByText("No organization selected")).toBeTruthy();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
