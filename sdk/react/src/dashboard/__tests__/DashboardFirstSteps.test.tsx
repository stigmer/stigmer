/**
 * Pins the journey's card: six steps in the journey's order under "From
 * first agent to your users", with the count done ("3 of 6"); a done step
 * shows what the server says happened and no act; the current step has its
 * one act, a link the host routes (through its own link component when it
 * passes one), and the later steps sit quiet, with no line and no act. Each
 * later step's destination is the host's: "Make it yours" and "Put it in
 * your app" link the journey's agent, "Bring others in" the members page,
 * and a destination the host does not pass offers no act. All six done
 * folds the card to one line. "Hide" is offered only with `onHide`. A
 * journey that is off (a person the steps are not for) or still read draws
 * nothing. The journey is passed in, as the dashboard passes it; how it is
 * read is `useJourney`'s suite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderPlain, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { DashboardFirstSteps, type DashboardFirstStepLinks, type DashboardFirstStepsProps } from "../DashboardFirstSteps";
import type { JourneyStepId, UseJourneyReturn } from "../../journey/useJourney";

afterEach(cleanup);

/** Renders inside a provider: the card reads the journey itself unless given one, so it needs a client either way. */
function render(ui: ReactElement) {
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={{} as never}>{children}</StigmerContext.Provider>;
  return renderPlain(ui, { wrapper });
}

const IDS: readonly JourneyStepId[] = ["describe", "key", "watch", "make-yours", "in-app", "others"];
const TITLES = ["Say what it should do", "Add a model key", "Watch it work", "Make it yours", "Put it in your app", "Bring others in"];

/** A ready journey with its first `done` steps done. */
function journeyAt(done: number): UseJourneyReturn {
  const steps = IDS.map((id, index) => ({
    id,
    number: index + 1,
    title: TITLES[index]!,
    state: index < done ? ("done" as const) : index === done ? ("current" as const) : ("todo" as const),
    line: index < done ? `fact ${index + 1}` : `todo ${index + 1}`,
  }));
  return {
    status: "ready",
    steps,
    done,
    current: steps[done],
    agent: { ref: { org: "org_acme", slug: "variance-reporter" }, name: "Variance Reporter" },
  };
}

const LINKS: DashboardFirstStepLinks = {
  connectProvider: "/models",
  createAgent: "/",
  startSession: "/",
  makeItYours: (agent) => `/agents/${agent.org}/${agent.slug}?tab=make-it-yours`,
  putInApp: (agent) => `/agents/${agent.org}/${agent.slug}?tab=channels`,
  bringOthers: "/settings/members",
};

function renderCard(journey: UseJourneyReturn, props: Partial<DashboardFirstStepsProps> = {}) {
  return render(<DashboardFirstSteps org="org_acme" links={LINKS} journey={journey} {...props} />);
}

function rows(): HTMLElement[] {
  return within(screen.getByRole("region", { name: "From first agent to your users" })).getAllByRole("listitem");
}

describe("DashboardFirstSteps", () => {
  it("lists the six steps in order with the count done, facts for the done ones and one act on the current", () => {
    renderCard(journeyAt(3));

    // Each row's title is the first text of its first line.
    expect(rows().map((row) => row.querySelector("p")?.firstChild?.textContent)).toEqual(TITLES);
    expect(screen.getByRole("region", { name: "From first agent to your users" }).textContent).toContain("3 of 6");
    for (const index of [0, 1, 2]) {
      expect(rows()[index]!.textContent).toContain(`fact ${index + 1}`);
      expect(rows()[index]!.textContent).toContain("(done)");
      expect(within(rows()[index]!).queryByRole("link")).toBeNull();
    }
    expect(rows()[3]!.getAttribute("aria-current")).toBe("step");
    expect(rows()[3]!.textContent).toContain("todo 4");
    expect(within(rows()[3]!).getByRole("link", { name: "Make it yours" }).getAttribute("href")).toBe(
      "/agents/org_acme/variance-reporter?tab=make-it-yours",
    );
    for (const index of [4, 5]) {
      expect(rows()[index]!.textContent).not.toContain(`todo ${index + 1}`);
      expect(within(rows()[index]!).queryByRole("link")).toBeNull();
    }
  });

  it("links each step to where it is taken, as the host routes it", () => {
    const hrefs = [0, 1, 2, 3, 4, 5].map((done) => {
      const { unmount } = renderCard(journeyAt(done));
      const href = within(rows()[done]!).getByRole("link").getAttribute("href");
      unmount();
      return href;
    });
    expect(hrefs).toEqual([
      "/",
      "/models",
      "/",
      "/agents/org_acme/variance-reporter?tab=make-it-yours",
      "/agents/org_acme/variance-reporter?tab=channels",
      "/settings/members",
    ]);
  });

  it("offers no act on a step whose destination the host does not pass", () => {
    render(
      <DashboardFirstSteps
        org="org_acme"
        links={{ connectProvider: "/models", createAgent: "/", startSession: "/" }}
        journey={journeyAt(4)}
      />,
    );

    expect(within(rows()[4]!).queryByRole("link")).toBeNull();
    expect(rows()[4]!.getAttribute("aria-current")).toBe("step");
  });

  it("draws each link with the host's link component", () => {
    renderCard(journeyAt(1), {
      renderLink: ({ href, className, children }) => (
        <a href={`#${href}`} className={className}>
          {children}
        </a>
      ),
    });

    expect(screen.getByRole("link", { name: "Add a key" }).getAttribute("href")).toBe("#/models");
  });

  it("folds to one line once all six are done", () => {
    const all = journeyAt(6);
    renderCard(all);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Your organization is set up")).toBeTruthy();
    expect(document.body.textContent).toContain("6 of 6");
  });

  it("offers Hide only with onHide, and calls it", () => {
    const { unmount } = renderCard(journeyAt(2));
    expect(screen.queryByRole("button", { name: "Hide these steps" })).toBeNull();
    unmount();

    const onHide = vi.fn();
    renderCard(journeyAt(2), { onHide });
    fireEvent.click(screen.getByRole("button", { name: "Hide these steps" }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("draws nothing while the journey is read, or for a person it is not for", () => {
    const { container, unmount } = renderCard({ status: "pending", steps: [], done: 0, current: undefined, agent: undefined });
    expect(container.innerHTML).toBe("");
    unmount();

    const off = renderCard({ status: "off", steps: [], done: 0, current: undefined, agent: undefined });
    expect(off.container.innerHTML).toBe("");
  });
});
