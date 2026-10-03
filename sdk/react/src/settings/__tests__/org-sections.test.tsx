/**
 * The organization settings sections hand the active organization to their
 * panel as `org`, and show a prompt instead when none is selected. The
 * organization context and the panels are stubbed: each panel only records
 * the organization it was given.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ activeId: "" as string, given: [] as Array<{ panel: string; org: string }> }));

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: state.activeId === "" ? undefined : { metadata: { id: state.activeId, slug: state.activeId } },
    refresh: () => {},
  }),
}));

function recordingPanel(panel: string) {
  return ({ org }: { org: string }) => {
    state.given.push({ panel, org });
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
});
