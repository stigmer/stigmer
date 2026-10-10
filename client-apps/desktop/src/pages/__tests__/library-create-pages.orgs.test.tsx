/**
 * Pins how the desktop pages that create or install a resource name
 * organizations: the SDK creator (wizard, form, uploader, catalogue) is
 * handed the active organization's id, the page's own prose shows the active
 * organization's slug, and on completion the page opens the new resource at
 * a URL carrying the slug of the organization the server put it in. The
 * creators are pinned in @stigmer/react.
 */
import type { ComponentType } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  props: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@stigmer/react", () => {
  const capture = (name: string) => (props: Record<string, unknown>) => {
    (page.props[name] ??= []).push(props);
    return null;
  };
  const noop = () => undefined;
  return {
    AgentCreationWizard: capture("AgentCreationWizard"),
    McpServerCreationWizard: capture("McpServerCreationWizard"),
    CreationPicker: capture("CreationPicker"),
    ScheduleForm: capture("ScheduleForm"),
    SkillUploader: capture("SkillUploader"),
    PluginUploader: capture("PluginUploader"),
    MarketplaceCatalog: capture("MarketplaceCatalog"),
    ApplyManifestDialog: () => null,
    AGENT_TEMPLATES: [],
    MCP_SERVER_TEMPLATES: [],
    toast: { success: noop, error: noop },
    useBreadcrumbOverride: () => ({ setLabel: noop }),
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => page.canCreate,
    AgentCreationDenied: () => <p>only admins create agents</p>,
    useActiveOrgSlug: () => "acme",
    // The person's organizations: the active one and a second one, so a
    // completion proves it resolves the created resource's own org.
    useOrgSlugForId: () => (id: string) =>
      ({ org_acme: "acme", org_shared: "shared-team" })[id] ?? id,
  };
});

import AgentNewPage from "../library/AgentNewPage";
import McpServerNewPage from "../library/McpServerNewPage";
import ScheduleNewPage from "../library/ScheduleNewPage";
import SkillNewPage from "../library/SkillNewPage";
import PluginUploadPage from "../library/PluginUploadPage";
import MarketplacePage from "../marketplace/MarketplacePage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage(Page: ComponentType, entry = "/create") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The latest props a captured SDK component rendered with. */
function last<T>(name: string): T {
  const calls = page.props[name] ?? [];
  expect(calls.length, `${name} was never rendered`).toBeGreaterThan(0);
  return calls.at(-1) as T;
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

interface Creator<R> {
  org: string;
  onComplete: (result: R) => void;
}

type MetadataResult = { metadata?: { org?: string; slug?: string } };

const SHARED = { org: "org_shared", slug: "made" };

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props = {};
});

describe("desktop AgentNewPage — organizations", () => {
  it("preselects ?mcp servers in the active org by id and opens the agent at its org's slug", () => {
    renderPage(AgentNewPage, "/library/agents/new?mcp=github,linear");

    const wizard = last<Creator<{ org: string; slug: string }> & { initialData: unknown }>("AgentCreationWizard");
    expect(wizard.org).toBe("org_acme");
    expect(wizard.initialData).toEqual({
      mcpServerUsages: [
        { mcpServerRef: { org: "org_acme", slug: "github" } },
        { mcpServerRef: { org: "org_acme", slug: "linear" } },
      ],
    });

    act(() => wizard.onComplete(SHARED));

    expect(location()).toBe("/library/agents/shared-team/made");
  });
});

describe("desktop McpServerNewPage — organizations", () => {
  it("creates in the active org by id and opens the server at its org's slug", () => {
    renderPage(McpServerNewPage);

    act(() => last<{ onSelect: (path: { kind: string }) => void }>("CreationPicker").onSelect({ kind: "scratch" }));
    const wizard = last<Creator<{ org: string; slug: string }>>("McpServerCreationWizard");
    expect(wizard.org).toBe("org_acme");

    act(() => wizard.onComplete(SHARED));

    expect(location()).toBe("/library/mcp-servers/shared-team/made");
  });
});

describe("desktop ScheduleNewPage — organizations", () => {
  it("creates in the active org by id and opens the schedule at its org's slug", () => {
    renderPage(ScheduleNewPage);

    const form = last<Creator<MetadataResult>>("ScheduleForm");
    expect(form.org).toBe("org_acme");

    act(() => form.onComplete({ metadata: SHARED }));

    expect(location()).toBe("/library/schedules/shared-team/made");
  });
});

describe("desktop SkillNewPage — organizations", () => {
  it("uploads into the active org by id and opens the skill at its org's slug", () => {
    renderPage(SkillNewPage);

    const uploader = last<Creator<MetadataResult>>("SkillUploader");
    expect(uploader.org).toBe("org_acme");

    act(() => uploader.onComplete({ metadata: SHARED }));

    expect(location()).toBe("/library/skills/shared-team/made");
  });
});

describe("desktop PluginUploadPage — organizations", () => {
  it("names the active org by slug, uploads by id and opens the plugin at its org's slug", () => {
    renderPage(PluginUploadPage);

    expect(screen.getByText(/installed into acme\./)).toBeTruthy();
    const uploader = last<Creator<{ plugin: MetadataResult }>>("PluginUploader");
    expect(uploader.org).toBe("org_acme");

    act(() => uploader.onComplete({ plugin: { metadata: SHARED } }));

    expect(location()).toBe("/library/plugins/shared-team/made");
  });
});

describe("desktop MarketplacePage — organizations", () => {
  it("names the active org by slug, installs by id and opens the plugin at its org's slug", () => {
    renderPage(MarketplacePage);

    expect(screen.getByText(/Plugins you can install into acme:/)).toBeTruthy();
    const catalog = last<{ org: string; onInstalled: (r: { plugin: MetadataResult }) => void }>("MarketplaceCatalog");
    expect(catalog.org).toBe("org_acme");

    act(() => catalog.onInstalled({ plugin: { metadata: SHARED } }));

    expect(location()).toBe("/library/plugins/shared-team/made");
  });
});

describe("desktop AgentNewPage — who may create agents", () => {
  it("shows who can create agents instead of the wizard to someone the server would refuse", () => {
    page.canCreate = { allowed: false, isLoading: false };
    renderPage(AgentNewPage, "/library/agents/new");

    expect(screen.getByText("only admins create agents")).toBeTruthy();
    expect(page.props.AgentCreationWizard).toBeUndefined();
    expect(page.props.CreationPicker).toBeUndefined();
  });

  it("shows nothing while the answer is pending", () => {
    page.canCreate = { allowed: false, isLoading: true };
    renderPage(AgentNewPage, "/library/agents/new");

    expect(screen.queryByText("only admins create agents")).toBeNull();
    expect(page.props.AgentCreationWizard).toBeUndefined();
  });
});
