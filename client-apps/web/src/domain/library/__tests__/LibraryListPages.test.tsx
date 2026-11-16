/**
 * Pins the web console's Library list pages and landing as thin shells over
 * the kit's console sections (what each list shows is pinned beside the
 * sections in @stigmer/react-sdk): each route serves its page, each page
 * links with Next's `Link` and opens a resource as a Library detail through
 * the overlay's client-side navigation, under its organization's slug. The
 * plugins list opens "Add MCP server" on arrival through `?add=mcp-server`
 * (the Library's Add menu), and the landing goes to a card's list through
 * Next's router.
 */
import type { ComponentType, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { LibraryResourceRef } from "@stigmer/react-sdk/console";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  props: new Map<string, Props>(),
  search: new URLSearchParams(),
  pushed: [] as string[],
}));

vi.mock("@stigmer/react-sdk/console", async (importOriginal) => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    ...(await importOriginal<typeof import("@stigmer/react-sdk/console")>()),
    LibraryOverview: capture("LibraryOverview"),
    LibraryAgentsSection: capture("LibraryAgentsSection"),
    LibrarySkillsSection: capture("LibrarySkillsSection"),
    LibraryPluginsSection: capture("LibraryPluginsSection"),
    LibraryRoutinesSection: capture("LibraryRoutinesSection"),
    LibraryEnvironmentsSection: capture("LibraryEnvironmentsSection"),
    LibraryFilesSection: capture("LibraryFilesSection"),
  };
});

// The person's organizations: org_acme reads "acme" in a URL.
vi.mock("@stigmer/react-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-sdk")>()),
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
  useCanonicalOrgSlug: (segment: string | null) => segment,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useSearchParams: () => page.search,
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { LibraryNavigationProvider } from "../library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";
import LibraryPage from "@/app/library/page";
import AgentsPage from "@/app/library/agents/page";
import SkillsPage from "@/app/library/skills/page";
import PluginsPage from "@/app/library/plugins/page";
import RoutinesPage from "@/app/library/routines/page";
import EnvironmentsPage from "@/app/library/environments/page";
import FilesPage from "@/app/library/files/page";

function renderInZone(Page: ComponentType) {
  return render(
    <LibraryNavigationProvider>
      <Page />
    </LibraryNavigationProvider>,
  );
}

function propsOf(name: string): Props {
  const props = page.props.get(name);
  if (!props) throw new Error(`${name} was not rendered`);
  return props;
}

beforeEach(() => {
  page.props.clear();
  page.search = new URLSearchParams();
  page.pushed.length = 0;
  window.history.replaceState(null, "", "/library");
});

afterEach(cleanup);

describe.each([
  { route: "/library/agents", Page: AgentsPage, section: "LibraryAgentsSection", kind: "agents" },
  { route: "/library/skills", Page: SkillsPage, section: "LibrarySkillsSection", kind: "skills" },
  { route: "/library/plugins", Page: PluginsPage, section: "LibraryPluginsSection", kind: "plugins" },
  { route: "/library/routines", Page: RoutinesPage, section: "LibraryRoutinesSection", kind: "routines" },
  { route: "/library/environments", Page: EnvironmentsPage, section: "LibraryEnvironmentsSection", kind: "environments" },
  { route: "/library/files", Page: FilesPage, section: "LibraryFilesSection", kind: "skills" },
] as const)("web $route", ({ Page, section, kind }) => {
  it("serves the kit's section, linked with Next's Link", () => {
    renderInZone(Page);

    expect(propsOf(section).renderLink).toBe(renderJourneyLink);
  });

  it("opens a resource as a Library detail under its organization's slug", () => {
    renderInZone(Page);

    const onOpen = propsOf(section).onOpen as (resource: LibraryResourceRef) => void;
    act(() => onOpen({ kind, org: "org_acme", slug: "kit" }));

    expect(window.location.pathname).toBe(`/library/${kind}/acme/kit`);
  });
});

describe("web RoutineListPage", () => {
  it("is the page /library/routines serves, and a row opens its routine", () => {
    renderInZone(RoutinesPage);

    act(() => (propsOf("LibraryRoutinesSection").onOpen as (r: LibraryResourceRef) => void)({ kind: "routines", org: "org_acme", slug: "nightly" }));

    expect(window.location.pathname).toBe("/library/routines/acme/nightly");
  });
});

describe("web PluginListPage Add MCP server", () => {
  it("is closed on a plain visit", () => {
    renderInZone(PluginsPage);

    expect(propsOf("LibraryPluginsSection").addMcpServerOnArrival).toBe(false);
  });

  it("opens on arrival from the Library's Add menu", () => {
    page.search = new URLSearchParams("add=mcp-server");
    renderInZone(PluginsPage);

    expect(propsOf("LibraryPluginsSection").addMcpServerOnArrival).toBe(true);
  });
});

describe("web LibraryLanding", () => {
  it("is the page /library serves, and goes to a card's list through Next's router", () => {
    renderInZone(LibraryPage);

    act(() => (propsOf("LibraryOverview").onNavigate as (path: string) => void)("/library/plugins"));

    expect(page.pushed).toEqual(["/library/plugins"]);
  });
});
