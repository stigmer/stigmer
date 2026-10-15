/**
 * Pins the web agent page's address after a rename: the agent read by the
 * URL's slug answers its current one, so a URL naming a slug the agent was
 * renamed away from moves to the current slug in place, and a rename made
 * from the view moves it too. The detail view itself is pinned in
 * @stigmer/react; here it is stubbed to capture its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

interface ViewProps {
  onRenamed?: (agent: Agent) => void;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  canonical: [] as string[],
  agentSlug: "",
}));

vi.mock("@stigmer/react", () => ({
  ChannelsPanel: () => null,
  AgentDetailView: (props: ViewProps) => {
    page.view.push(props);
    return null;
  },
  EditResourceYamlDialog: () => null,
  ConfirmDialog: () => null,
  useAgent: () => ({
    agent:
      page.agentSlug === "" ? null : { metadata: { slug: page.agentSlug } },
    refetch: () => {},
  }),
  useCopyResource: () => ({ copyId: () => {}, copyQualifiedSlug: () => {} }),
  useConfirmAction: () => ({
    confirmState: null,
    confirm: () => {},
    handleConfirm: () => {},
    handleCancel: () => {},
  }),
  useDeleteResource: () => ({
    deleteResource: async () => {},
    isDeleting: false,
  }),
  useExportResource: () => ({
    copyYaml: () => {},
    copyJson: () => {},
    downloadYaml: () => {},
  }),
  useBreadcrumbOverride: () => ({ setLabel: () => {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: () => {},
    canonicalSlug: (slug: string) => page.canonical.push(slug),
  }),
  useRouteDetailYieldsToOverlay: () => false,
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: () => {} }),
}));

import { AgentDetailPageInner } from "../AgentDetailPage";

beforeEach(() => {
  page.view.length = 0;
  page.canonical.length = 0;
  page.agentSlug = "";
});

describe("web AgentDetailPageInner", () => {
  it("leaves the address alone while the agent answers the URL's slug", () => {
    page.agentSlug = "support-bot";
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);

    expect(page.canonical).toEqual([]);
  });

  it("moves the address to the slug the agent answers to now, and to the one a rename gave it", () => {
    page.agentSlug = "support-bot";
    render(<AgentDetailPageInner org="acme" slug="test-bot" />);
    expect(page.canonical).toEqual(["support-bot"]);

    act(() =>
      page.view
        .at(-1)
        ?.onRenamed?.({ metadata: { slug: "help-bot" } } as Agent),
    );
    act(() =>
      page.view.at(-1)?.onRenamed?.({ metadata: { slug: "" } } as Agent),
    );

    expect(page.canonical).toEqual(["support-bot", "help-bot"]);
  });
});
