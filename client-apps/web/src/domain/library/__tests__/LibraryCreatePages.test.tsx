/**
 * Pins the web library's create pages: each creates in the active
 * organization by its id, the way the server names every org, and on
 * completion opens the new resource at a URL whose org segment is the
 * org's slug, resolved from the id the created resource names its org by.
 * The wizards, uploaders and forms themselves are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({
  // The server's answer to "may this person create an agent here?".
  canCreate: { allowed: true, isLoading: false },
  props: new Map<string, Props>(),
  pushed: [] as string[],
}));

vi.mock("@stigmer/react", () => {
  const capture = (name: string) => (props: Props) => {
    page.props.set(name, props);
    return null;
  };
  return {
    AgentCreationWizard: capture("AgentCreationWizard"),
    CreationPicker: capture("CreationPicker"),
    ApplyManifestDialog: capture("ApplyManifestDialog"),
    PluginUploader: capture("PluginUploader"),
    ScheduleForm: capture("ScheduleForm"),
    SkillUploader: capture("SkillUploader"),
    AGENT_TEMPLATES: [],
    useActiveOrgId: () => "org_acme",
    useCanCreateAgent: () => page.canCreate,
    AgentCreationDenied: () => <p>only admins create agents</p>,
    useActiveOrgSlug: () => "acme",
    // The person's organizations: org_acme reads "acme" in a URL.
    useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
    useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AgentNewPage } from "../agents/AgentNewPage";
import { PluginUploadPage } from "../plugins/PluginUploadPage";
import { ScheduleNewPage } from "../schedules/ScheduleNewPage";
import { SkillNewPage } from "../skills/SkillNewPage";

function propsOf(name: string): Props {
  const props = page.props.get(name);
  if (!props) throw new Error(`${name} was not rendered`);
  return props;
}

function call(name: string, prop: string, arg: unknown): void {
  const fn = propsOf(name)[prop] as (value: unknown) => void;
  act(() => fn(arg));
}

const CREATED = { metadata: { org: "org_acme", slug: "made" } };

beforeEach(() => {
  page.canCreate = { allowed: true, isLoading: false };
  page.props.clear();
  page.pushed.length = 0;
});

describe("web library create pages", () => {
  it("AgentNewPage creates in the active org id and opens the agent under the org slug", () => {
    render(<AgentNewPage />);
    call("CreationPicker", "onSelect", { kind: "scratch" });

    expect(propsOf("AgentCreationWizard").org).toBe("org_acme");
    call("AgentCreationWizard", "onComplete", {
      org: "org_acme",
      slug: "made",
    });
    expect(page.pushed).toEqual(["/library/agents/acme/made"]);
  });

  it("PluginUploadPage uploads into the active org id, names the org by slug, and opens the plugin under it", () => {
    render(<PluginUploadPage />);

    expect(screen.getByText(/installed into acme\./)).toBeTruthy();
    expect(propsOf("PluginUploader").org).toBe("org_acme");
    call("PluginUploader", "onComplete", { plugin: CREATED });
    expect(page.pushed).toEqual(["/library/plugins/acme/made"]);
  });

  it("ScheduleNewPage creates in the active org id and opens the schedule under the org slug", () => {
    render(<ScheduleNewPage />);

    expect(propsOf("ScheduleForm").org).toBe("org_acme");
    call("ScheduleForm", "onComplete", CREATED);
    expect(page.pushed).toEqual(["/library/schedules/acme/made"]);
  });

  it("SkillNewPage uploads into the active org id and opens the skill under the org slug", () => {
    render(<SkillNewPage />);

    expect(propsOf("SkillUploader").org).toBe("org_acme");
    call("SkillUploader", "onComplete", CREATED);
    expect(page.pushed).toEqual(["/library/skills/acme/made"]);
  });
});

describe("web AgentNewPage — who may create agents", () => {
  it("shows who can create agents instead of the creation picker to someone the server would refuse", () => {
    page.canCreate = { allowed: false, isLoading: false };
    render(<AgentNewPage />);

    expect(screen.getByText("only admins create agents")).toBeTruthy();
    expect(page.props.has("CreationPicker")).toBe(false);
  });

  it("shows nothing while the answer is pending", () => {
    page.canCreate = { allowed: false, isLoading: true };
    render(<AgentNewPage />);

    expect(screen.queryByText("only admins create agents")).toBeNull();
    expect(page.props.has("CreationPicker")).toBe(false);
  });
});
