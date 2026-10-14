/**
 * The organization settings sections hand the active organization to their
 * panel as `org`, and show a prompt instead when none is selected; the
 * profile section leaves refreshing the organization context to its panel,
 * which does it once after a save or a rename; the embedding section tells
 * its panel where service accounts are managed. The
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
  serviceAccountsHref: undefined as string | undefined,
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
// The profile section's child-organization list asks the server on its own;
// this suite is about which organization each section hands its panels.
vi.mock("../../organization/ChildOrganizationsList.js", () => ({ ChildOrganizationsList: () => null }));
vi.mock("../../usage/OrgUsagePanel.js", () => ({ OrgUsagePanel: recordingPanel("usage") }));
vi.mock("../../organization/OrgEmbeddingPanel.js", () => ({
  OrgEmbeddingPanel: ({ org, serviceAccountsHref }: { org: string; serviceAccountsHref?: string }) => {
    state.given.push({ panel: "embedding", org });
    state.serviceAccountsHref = serviceAccountsHref;
    return null;
  },
}));

import { OrgEmbeddingSection } from "../OrgEmbeddingSection";
import { OrgPreferencesSection } from "../OrgPreferencesSection";
import { SERVICE_ACCOUNTS_SETTINGS_HREF } from "../../service-account/copy";
import { OrgProfileSection } from "../OrgProfileSection";
import { UsageSection } from "../UsageSection";

afterEach(() => {
  cleanup();
  state.activeId = "";
  state.given = [];
  state.onUpdated = undefined;
  state.refreshed = [];
  state.serviceAccountsHref = undefined;
});

describe("the organization settings sections", () => {
  it.each([
    ["preferences", OrgPreferencesSection],
    ["profile", OrgProfileSection],
    ["usage", UsageSection],
    ["embedding", OrgEmbeddingSection],
  ] as const)("%s hands the active organization to its panel as org", (panel, Section) => {
    state.activeId = "acme";
    render(<Section />);
    expect(state.given).toEqual([{ panel, org: "acme" }]);
  });

  it.each([
    ["preferences", OrgPreferencesSection, /select an organization to view its preferences/i],
    ["profile", OrgProfileSection, /select an organization to view its profile/i],
    ["embedding", OrgEmbeddingSection, /select an organization to view its embedding settings/i],
  ] as const)("%s prompts for an organization when none is selected", (_panel, Section, prompt) => {
    render(<Section />);
    expect(screen.getByText(prompt)).toBeTruthy();
    expect(state.given).toEqual([]);
  });

  it("embedding links service accounts at the console's page, or where the host says", () => {
    state.activeId = "acme";
    render(<OrgEmbeddingSection />);
    expect(state.serviceAccountsHref).toBe(SERVICE_ACCOUNTS_SETTINGS_HREF);
    cleanup();
    render(<OrgEmbeddingSection serviceAccountsHref="#/settings/service-accounts" />);
    expect(state.serviceAccountsHref).toBe("#/settings/service-accounts");
  });

  it("profile adds no refresh of its own to the one its panel makes", () => {
    state.activeId = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
    render(<OrgProfileSection />);
    expect(state.onUpdated).toBeUndefined();
    expect(state.refreshed).toEqual([]);
  });
});
