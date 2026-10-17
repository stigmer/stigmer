// ---------------------------------------------------------------------------
// The Settings → Billing route — Stripe's return lands in the billing section
//
// Stripe sends the person back to `?setup=success&plan=<id>` after a card
// was saved on the way to a plan. The page reads that plan into the
// section's `resumePlanId`, so the section reopens it for an explicit
// confirm, and hands it a callback that drops the query once the resume is
// handled, so a reload does not reopen it. Any other return (a cancel, the
// portal, no query) resumes nothing.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

interface SectionProps {
  readonly resumePlanId?: string;
  readonly onResumeHandled: () => void;
}
const section = vi.hoisted(() => ({ props: [] as SectionProps[] }));
vi.mock("@stigmer/react-sdk", () => ({
  BillingSection: (props: SectionProps) => {
    section.props.push(props);
    return <p>billing section</p>;
  },
}));

import BillingPage from "../page";

function lastProps(): SectionProps {
  const props = section.props.at(-1);
  expect(props, "the billing section rendered").toBeDefined();
  return props as SectionProps;
}

beforeEach(() => {
  search.value = "";
  section.props = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings → Billing route", () => {
  it("reopens the plan a saved card was for", () => {
    search.value = "?setup=success&plan=pln_team";
    render(<BillingPage />);
    expect(screen.getByText("billing section")).toBeTruthy();
    expect(lastProps().resumePlanId).toBe("pln_team");
  });

  it("resumes nothing when the card was saved without a plan", () => {
    search.value = "?setup=success";
    render(<BillingPage />);
    expect(lastProps().resumePlanId).toBeUndefined();
  });

  it("resumes nothing on a return that was not a saved card", () => {
    search.value = "?setup=cancel&plan=pln_team";
    render(<BillingPage />);
    expect(lastProps().resumePlanId).toBeUndefined();
  });

  it("drops the query from the address once the resume is handled", () => {
    search.value = "?setup=success&plan=pln_team";
    window.history.replaceState({}, "", "/settings/billing?setup=success&plan=pln_team");
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<BillingPage />);

    lastProps().onResumeHandled();

    expect(replaceState).toHaveBeenCalledWith({}, "", "/settings/billing");
    expect(window.location.search).toBe("");
  });
});
