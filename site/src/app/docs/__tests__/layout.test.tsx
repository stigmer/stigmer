// Pins the docs layout's chrome ownership: one `tabs` array, the hand-added
// Docs tab first and then one tab per root folder in tree order, is handed
// to both DocsHeader (the desktop tabs) and DocsSidebar (the mobile
// switcher), while Fumadocs' own tab strip stays off (`sidebar.tabs:
// false`) and RootProvider runs dark-only with static search. The order is
// load-bearing: the active tab is the LAST entry matching the URL, so the
// catch-all Docs tab must come first. Fumadocs' layout, provider and the
// site's header, sidebar and Ask AI chrome are replaced by recorders;
// getSidebarTabs runs for real over a fixture page tree.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";

interface Tab {
  readonly title: ReactNode;
  readonly url: string;
}
interface Recorded {
  headerTabs?: readonly Tab[];
  sidebarTabs?: readonly Tab[];
  layoutSidebarTabs?: unknown;
  providerTheme?: unknown;
  providerSearch?: unknown;
}
const recorded: Recorded = {};

const tree: PageTree.Root = {
  name: "Docs",
  children: [
    { type: "page", name: "Introduction", url: "/docs" },
    {
      type: "folder",
      name: "SDK",
      root: true,
      description: "Build with the SDKs",
      index: { type: "page", name: "SDK", url: "/docs/sdk" },
      children: [{ type: "page", name: "React", url: "/docs/sdk/react" }],
    },
    {
      type: "folder",
      name: "CLI",
      root: true,
      index: { type: "page", name: "CLI", url: "/docs/cli" },
      children: [],
    },
  ],
};

vi.mock("@/lib/source", () => ({ source: { pageTree: tree } }));

vi.mock("fumadocs-ui/provider/next", () => ({
  RootProvider: ({ children, theme, search }: { children: ReactNode; theme?: unknown; search?: unknown }) => {
    recorded.providerTheme = theme;
    recorded.providerSearch = search;
    return <div data-testid="root-provider">{children}</div>;
  },
}));

vi.mock("fumadocs-ui/layouts/docs", () => ({
  DocsLayout: ({
    children,
    nav,
    sidebar,
  }: {
    children: ReactNode;
    nav: { component: ReactNode };
    sidebar: { tabs: unknown; component: ReactNode };
  }) => {
    recorded.layoutSidebarTabs = sidebar.tabs;
    return (
      <div data-testid="docs-layout">
        {nav.component}
        {sidebar.component}
        <main>{children}</main>
      </div>
    );
  },
}));

vi.mock("@/components/docs/header", () => ({
  DocsHeader: ({ tabs }: { tabs: readonly Tab[] }) => {
    recorded.headerTabs = tabs;
    return <header data-testid="docs-header" />;
  },
}));

vi.mock("../sidebar", () => ({
  DocsSidebar: ({ tabs }: { tabs: readonly Tab[] }) => {
    recorded.sidebarTabs = tabs;
    return <nav data-testid="docs-sidebar" />;
  },
}));

vi.mock("@/components/docs/ask-ai", () => ({
  AskAiProvider: ({ children }: { children: ReactNode }) => <div data-testid="ask-ai-provider">{children}</div>,
  AskAiPanel: () => <aside data-testid="ask-ai-panel" />,
}));

const { default: Layout } = await import("../layout");

afterEach(() => {
  cleanup();
});

describe("docs layout", () => {
  it("hands one tabs array, Docs first then the root folders, to the header and the sidebar", () => {
    render(
      <Layout>
        <p>page body</p>
      </Layout>,
    );

    expect(screen.getByText("page body")).toBeTruthy();
    const titles = recorded.headerTabs?.map((t) => t.title);
    expect(titles).toEqual(["Docs", "SDK", "CLI"]);
    expect(recorded.headerTabs?.map((t) => t.url)).toEqual(["/docs", "/docs/sdk", "/docs/cli"]);
    // The same array feeds both owners, so the two breakpoints cannot drift.
    expect(recorded.sidebarTabs).toBe(recorded.headerTabs);
  });

  it("keeps Fumadocs' own tab strip off and runs the provider dark-only with static search", () => {
    render(
      <Layout>
        <p>page body</p>
      </Layout>,
    );

    expect(recorded.layoutSidebarTabs).toBe(false);
    expect(recorded.providerTheme).toEqual({ enabled: false });
    expect(recorded.providerSearch).toEqual({ options: { type: "static" } });
    // The Ask AI panel is mounted once, inside its provider.
    const provider = screen.getByTestId("ask-ai-provider");
    expect(provider.querySelectorAll("[data-testid='ask-ai-panel']")).toHaveLength(1);
  });
});
