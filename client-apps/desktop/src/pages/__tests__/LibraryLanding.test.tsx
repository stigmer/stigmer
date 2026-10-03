/**
 * Pins the desktop Library landing: one count card per library kind, each
 * opening its list, and the declarative Apply YAML entry point, whose apply
 * recounts every card (it can create any kind). The cards and the dialog
 * are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface CardProps {
  label: string;
  count: number;
  isLoading: boolean;
  onClick: () => void;
}

interface DialogProps {
  open: boolean;
  org: string;
  onApplied: () => void;
}

const page = vi.hoisted(() => ({
  cards: new Map<string, CardProps>(),
  dialog: [] as DialogProps[],
  tokens: [] as number[],
}));

function counter(count: number) {
  return (_org: string, options: { refetchToken: number }) => {
    page.tokens.push(options.refetchToken);
    return { count, isLoading: false };
  };
}

vi.mock("@stigmer/react", () => ({
  ApplyManifestDialog: (props: DialogProps) => {
    page.dialog.push(props);
    return null;
  },
  ResourceCountCard: (props: CardProps) => {
    page.cards.set(props.label, props);
    return null;
  },
  useAgentCount: counter(3),
  useWorkflowCount: counter(2),
  useSkillCount: counter(5),
  useMcpServerCount: counter(1),
  useScheduleCount: counter(4),
  usePluginCount: counter(0),
  useActiveOrgSlug: () => "acme",
}));

import LibraryLanding from "../library/LibraryLanding";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/library"]}>
      <Routes>
        <Route path="*" element={<LibraryLanding />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.cards.clear();
  page.dialog.length = 0;
  page.tokens.length = 0;
});

describe("desktop LibraryLanding", () => {
  it("shows one count card per library kind", () => {
    renderLanding();

    expect([...page.cards].map(([label, card]) => [label, card.count])).toEqual([
      ["Agents", 3],
      ["Workflows", 2],
      ["Skills", 5],
      ["MCP Servers", 1],
      ["Schedules", 4],
      ["Plugins", 0],
    ]);
  });

  it("opens each kind's list from its card", () => {
    renderLanding();

    act(() => page.cards.get("MCP Servers")?.onClick());
    expect(screen.getByTestId("location").textContent).toBe("/library/mcp-servers");
    act(() => page.cards.get("Schedules")?.onClick());
    expect(screen.getByTestId("location").textContent).toBe("/library/schedules");
  });

  it("opens Apply YAML in the active org, and an apply recounts every card", () => {
    renderLanding();
    expect(page.dialog.at(-1)).toMatchObject({ open: false, org: "acme" });

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)?.open).toBe(true);

    page.tokens.length = 0;
    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.tokens).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
