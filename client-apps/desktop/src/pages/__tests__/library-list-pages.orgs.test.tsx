/**
 * Pins the desktop app's Library list pages as thin shells over the kit's
 * console sections (what each list shows is pinned beside the sections in
 * @stigmer/react-sdk): each page links with the router and opens a resource
 * at an address carrying the slug of the resource's own organization, never
 * its id and never the active organization's slug. The plugins list opens
 * "Add MCP server" on arrival through `?add=mcp-server`, which is how the
 * Library's Add menu reaches it.
 */
import type { ComponentType } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { LibraryResourceRef } from "@stigmer/react-sdk/console";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({ props: new Map<string, Props>() }));

vi.mock("@stigmer/react-sdk/console", async (importOriginal) => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    ...(await importOriginal<typeof import("@stigmer/react-sdk/console")>()),
    LibraryAgentsSection: capture("LibraryAgentsSection"),
    LibrarySkillsSection: capture("LibrarySkillsSection"),
    LibraryPluginsSection: capture("LibraryPluginsSection"),
    LibraryRoutinesSection: capture("LibraryRoutinesSection"),
    LibraryEnvironmentsSection: capture("LibraryEnvironmentsSection"),
    LibraryFilesSection: capture("LibraryFilesSection"),
  };
});

vi.mock("@stigmer/react-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-sdk")>()),
  // The person's organizations: the active one and the one sharing the row.
  useOrgSlugForId: () => (id: string) => ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
}));

import AgentListPage from "../library/AgentListPage";
import SkillListPage from "../library/SkillListPage";
import PluginListPage from "../library/PluginListPage";
import RoutineListPage from "../library/RoutineListPage";
import EnvironmentListPage from "../library/EnvironmentListPage";
import FileListPage from "../library/FileListPage";
import { renderJourneyLink } from "../../journey/journey-links";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage(Page: ComponentType, entry = "/library") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function propsOf(name: string): Props {
  const props = page.props.get(name);
  if (!props) throw new Error(`${name} was not rendered`);
  return props;
}

beforeEach(() => {
  page.props.clear();
});

describe.each([
  { name: "AgentListPage", Page: AgentListPage, section: "LibraryAgentsSection", kind: "agents" },
  { name: "SkillListPage", Page: SkillListPage, section: "LibrarySkillsSection", kind: "skills" },
  { name: "PluginListPage", Page: PluginListPage, section: "LibraryPluginsSection", kind: "plugins" },
  { name: "RoutineListPage", Page: RoutineListPage, section: "LibraryRoutinesSection", kind: "routines" },
  { name: "EnvironmentListPage", Page: EnvironmentListPage, section: "LibraryEnvironmentsSection", kind: "environments" },
  { name: "FileListPage", Page: FileListPage, section: "LibraryFilesSection", kind: "skills" },
] as const)("desktop $name — organizations", ({ Page, section, kind }) => {
  it("renders the kit's section, linked with the router", () => {
    renderPage(Page);

    expect(propsOf(section).renderLink).toBe(renderJourneyLink);
  });

  it("opens a resource at a URL carrying its own organization's slug", () => {
    renderPage(Page);

    act(() => (propsOf(section).onOpen as (r: LibraryResourceRef) => void)({ kind, org: "org_shared", slug: "triage" }));

    expect(screen.getByTestId("location").textContent).toBe(`/library/${kind}/shared-team/triage`);
  });
});

describe("desktop PluginListPage — Add MCP server", () => {
  it("is closed on a plain visit", () => {
    renderPage(PluginListPage, "/library/plugins");

    expect(propsOf("LibraryPluginsSection").addMcpServerOnArrival).toBe(false);
  });

  it("opens on arrival from the Library's Add menu", () => {
    renderPage(PluginListPage, "/library/plugins?add=mcp-server");

    expect(propsOf("LibraryPluginsSection").addMcpServerOnArrival).toBe(true);
  });
});
