/**
 * The organization settings sections hand the active organization to their
 * panel as `org`, and show a prompt instead when none is selected; the
 * profile section leaves refreshing the organization context to its panel,
 * which does it once after a save or a rename. The
 * organization context and the panels are stubbed: each panel only records
 * the organization it was given.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeId: "" as string,
  given: [] as Array<{ panel: string; org: string }>,
  onUpdated: undefined as ((org: { metadata: { id: string; slug: string } }) => void) | undefined,
  refreshed: [] as Array<string | undefined>,
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: state.activeId === "" ? undefined : { metadata: { id: state.activeId, slug: state.activeId } },
    refresh: (target?: string) => {
      state.refreshed.push(target);
    },
  }),
}));

function recordingPanel(panel: string) {
  return ({ org, onUpdated }: { org: string; onUpdated?: typeof state.onUpdated }) => {
    state.given.push({ panel, org });
    state.onUpdated = onUpdated;
    return null;
  };
}

vi.mock("../../organization/OrgPreferencesPanel.js", () => ({ OrgPreferencesPanel: recordingPanel("preferences") }));
vi.mock("../../organization/OrgProfilePanel.js", () => ({ OrgProfilePanel: recordingPanel("profile") }));
vi.mock("../../usage/OrgUsagePanel.js", () => ({ OrgUsagePanel: recordingPanel("usage") }));

import { OrgPreferencesSection } from "../OrgPreferencesSection";
import { OrgProfileSection } from "../OrgProfileSection";
import { UsageSection } from "../UsageSection";

afterEach(() => {
  cleanup();
  state.activeId = "";
  state.given = [];
  state.onUpdated = undefined;
  state.refreshed = [];
});

describe("the organization settings sections", () => {
  it.each([
    ["preferences", OrgPreferencesSection],
    ["profile", OrgProfileSection],
    ["usage", UsageSection],
  ] as const)("%s hands the active organization to its panel as org", (panel, Section) => {
    state.activeId = "acme";
    render(<Section />);
    expect(state.given).toEqual([{ panel, org: "acme" }]);
  });

  it.each([
    ["preferences", OrgPreferencesSection, /select an organization to view its preferences/i],
    ["profile", OrgProfileSection, /select an organization to view its profile/i],
  ] as const)("%s prompts for an organization when none is selected", (_panel, Section, prompt) => {
    render(<Section />);
    expect(screen.getByText(prompt)).toBeTruthy();
    expect(state.given).toEqual([]);
  });

  it("profile adds no refresh of its own to the one its panel makes", () => {
    state.activeId = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
    render(<OrgProfileSection />);
    expect(state.onUpdated).toBeUndefined();
    expect(state.refreshed).toEqual([]);
  });
});
