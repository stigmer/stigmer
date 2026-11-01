/**
 * The Memory and API Keys settings sections name the active organization to
 * their panels by its id, which every request carries, and Memory prompts for
 * an organization when none is selected. The organization context and the
 * panels are stubbed: each panel only records the organization it was given.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  activeId: "" as string,
  given: [] as Array<{ panel: string; org: string }>,
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useActiveOrgId: () => state.activeId,
  useActiveOrgSlug: () => (state.activeId === "" ? "" : "acme"),
}));

function recordingPanel(panel: string) {
  return ({ org }: { org: string }) => {
    state.given.push({ panel, org });
    return null;
  };
}

vi.mock("../../memory/MemoryListPanel.js", () => ({ MemoryListPanel: recordingPanel("memory") }));
vi.mock("../../api-key/CreateApiKeyForm.js", () => ({ CreateApiKeyForm: recordingPanel("create-api-key") }));
vi.mock("../../api-key/ApiKeyListPanel.js", () => ({ ApiKeyListPanel: () => null }));

import { MemorySection } from "../MemorySection";
import { ApiKeysSection } from "../ApiKeysSection";

afterEach(() => {
  cleanup();
  state.activeId = "";
  state.given = [];
});

describe("settings sections that name the active organization by id", () => {
  it("Memory lists the active organization's memories by its id", () => {
    state.activeId = ACME_ID;
    render(<MemorySection />);
    expect(state.given).toEqual([{ panel: "memory", org: ACME_ID }]);
  });

  it("Memory prompts for an organization when none is selected", () => {
    render(<MemorySection />);
    expect(screen.getByText(/choose an organization to see its memories/i)).toBeTruthy();
    expect(state.given).toEqual([]);
  });

  it("API Keys creates a key in the active organization, named by its id", () => {
    state.activeId = ACME_ID;
    render(<ApiKeysSection />);
    fireEvent.click(screen.getByRole("button", { name: "New API key" }));
    expect(state.given).toEqual([{ panel: "create-api-key", org: ACME_ID }]);
  });
});
