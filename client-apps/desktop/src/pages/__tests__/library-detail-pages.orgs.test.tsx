/**
 * Pins how the desktop detail pages for plugins, skills and schedules name
 * organizations. A resource a page links to (a plugin that installed it,
 * the agent a plugin was added to, a schedule's agent) names its
 * organization by id; the page opens it at a URL carrying that
 * organization's slug. A plugin's "Start a chat" opens the launcher with
 * the plugin named. The views are pinned in @stigmer/react.
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
    PluginDetailView: capture("PluginDetailView"),
    SkillDetailView: capture("SkillDetailView"),
    ScheduleDetailView: capture("ScheduleDetailView"),
    EditResourceYamlDialog: () => null,
    ConfirmDialog: () => null,
    useCopyResource: () => ({ copyId: noop, copyQualifiedSlug: noop }),
    useConfirmAction: () => ({ confirmState: null, confirm: noop, handleConfirm: noop, handleCancel: noop }),
    useDeleteResource: () => ({ deleteResource: noop, isDeleting: false }),
    useExportResource: () => ({ copyYaml: noop, copyJson: noop, downloadYaml: noop }),
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    useResolveRunSession: () => ({ sessionId: null }),
    useActiveOrgId: () => "org_acme",
    // The person's organizations: the active one and a second one, so a
    // link proves it resolves the linked resource's own org.
    useOrgSlugForId: () => (id: string) =>
      ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
  };
});

import PluginDetailPage from "../library/PluginDetailPage";
import SkillDetailPage from "../library/SkillDetailPage";
import ScheduleDetailPage from "../library/ScheduleDetailPage";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <span data-testid="location">{pathname}</span>
      <span data-testid="search">{search}</span>
    </>
  );
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

describe("desktop PluginDetailPage — organizations", () => {
  type PluginView = Record<"onAgentClick" | "onStartChat", (ref: Ref) => void>;

  it("opens the agent the plugin was added to at its org's slug", () => {
    renderDetail(PluginDetailPage);

    act(() => last<PluginView>("PluginDetailView").onAgentClick(SHARED));

    expect(location()).toBe("/library/agents/shared-team/linked");
  });

  it("starts a chat on the launcher with the plugin named", () => {
    renderDetail(PluginDetailPage);

    act(() => last<PluginView>("PluginDetailView").onStartChat(SHARED));

    expect(location()).toBe("/");
    expect(new URLSearchParams(screen.getByTestId("search").textContent ?? "").get("plugin")).toBe("org_shared/linked");
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
