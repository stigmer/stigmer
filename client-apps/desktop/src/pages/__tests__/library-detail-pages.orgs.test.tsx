/**
 * Pins how the desktop detail pages for MCP servers, plugins, skills and
 * schedules name organizations. A resource a page links to (a plugin that
 * installed it, a member of a plugin, a schedule's agent) names its
 * organization by id; the page opens it at a URL carrying that
 * organization's slug. The MCP server view also learns the viewer's
 * organization by id. The views are pinned in @stigmer/react.
 */
import type { ComponentType } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface Ref {
  org: string;
  slug: string;
}

const page = vi.hoisted(() => ({
  props: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@stigmer/react", () => {
  const capture = (name: string) => (props: Record<string, unknown>) => {
    (page.props[name] ??= []).push(props);
    return null;
  };
  const noop = () => undefined;
  return {
    McpServerDetailView: capture("McpServerDetailView"),
    PluginDetailView: capture("PluginDetailView"),
    SkillDetailView: capture("SkillDetailView"),
    ScheduleDetailView: capture("ScheduleDetailView"),
    EditResourceYamlDialog: () => null,
    ConfirmDialog: () => null,
    useMcpServer: () => ({ mcpServer: undefined, refetch: noop }),
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
    useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
    useExportResource: () => ({ copyYaml: noop, copyJson: noop, downloadYaml: noop }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    useResolveAgentRunSession: () => ({ sessionId: null }),
    useActiveOrgId: () => "org_acme",
    // The person's organizations: the active one and a second one, so a
    // link proves it resolves the linked resource's own org.
    useOrgSlugForId: () => (id: string) =>
      ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
  };
});

import McpServerDetailPage from "../library/McpServerDetailPage";
import PluginDetailPage from "../library/PluginDetailPage";
import SkillDetailPage from "../library/SkillDetailPage";
import ScheduleDetailPage from "../library/ScheduleDetailPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderDetail(Page: ComponentType) {
  return render(
    <MemoryRouter initialEntries={["/library/thing/acme/current"]}>
      <Routes>
        <Route path="/library/thing/:org/:slug" element={<Page />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The latest props a captured SDK view rendered with. */
function last<T>(name: string): T {
  const calls = page.props[name] ?? [];
  expect(calls.length, `${name} was never rendered`).toBeGreaterThan(0);
  return calls.at(-1) as T;
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

const SHARED: Ref = { org: "org_shared", slug: "linked" };

beforeEach(() => {
  page.props = {};
});

describe("desktop McpServerDetailPage — organizations", () => {
  it("tells the view the viewer's org by id", () => {
    renderDetail(McpServerDetailPage);

    expect(last<{ activeOrg: string }>("McpServerDetailView").activeOrg).toBe("org_acme");
  });

  it("opens the installing plugin at its org's slug", () => {
    renderDetail(McpServerDetailPage);

    act(() => last<{ onPluginClick: (ref: Ref) => void }>("McpServerDetailView").onPluginClick(SHARED));

    expect(location()).toBe("/library/plugins/shared-team/linked");
  });
});

describe("desktop PluginDetailPage — organizations", () => {
  type PluginView = Record<
    "onSkillClick" | "onMcpServerClick" | "onAgentClick" | "onWorkflowClick",
    (ref: Ref) => void
  >;

  it.each([
    ["onSkillClick", "/library/skills/shared-team/linked"],
    ["onMcpServerClick", "/library/mcp-servers/shared-team/linked"],
    ["onAgentClick", "/library/agents/shared-team/linked"],
    ["onWorkflowClick", "/library/workflows/shared-team/linked"],
  ] as const)("%s opens the member at its org's slug", (handler, expected) => {
    renderDetail(PluginDetailPage);

    act(() => last<PluginView>("PluginDetailView")[handler](SHARED));

    expect(location()).toBe(expected);
  });
});

describe("desktop SkillDetailPage — organizations", () => {
  it("opens the installing plugin at its org's slug", () => {
    renderDetail(SkillDetailPage);

    act(() => last<{ onPluginClick: (ref: Ref) => void }>("SkillDetailView").onPluginClick(SHARED));

    expect(location()).toBe("/library/plugins/shared-team/linked");
  });
});

describe("desktop ScheduleDetailPage — organizations", () => {
  it("opens the scheduled agent at its org's slug", () => {
    renderDetail(ScheduleDetailPage);

    act(() =>
      last<{ onNavigateToAgent: (org: string, slug: string) => void }>("ScheduleDetailView").onNavigateToAgent(
        "org_shared",
        "linked",
      ),
    );

    expect(location()).toBe("/library/agents/shared-team/linked");
  });
});
