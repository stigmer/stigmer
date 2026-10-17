/**
 * AgentPicker compares an agent already selected with each search result by
 * organization identity: a selection naming its org by slug is the same
 * agent as a result naming it by id, so it is not offered again; an agent in
 * `exclude` is never offered, by the same comparison. The search hook is
 * stubbed; the organization list is the mounted OrgProvider's.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const RESULTS = [
  { id: "agt_1", org: GLOBEX_ID, slug: "reviewer", name: "Reviewer", description: "" },
  { id: "agt_2", org: GLOBEX_ID, slug: "triager", name: "Triager", description: "" },
];

vi.mock("../useAgentSearch.js", () => ({
  useAgentSearch: () => ({
    results: RESULTS,
    isLoading: false,
    error: null,
    query: "",
    setQuery: () => {},
  }),
}));

import { AgentPicker } from "../AgentPicker";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

describe("AgentPicker organizations", () => {
  it("does not offer the agent already selected by its org's slug", async () => {
    render(
      <AgentPicker
        org={GLOBEX_ID}
        value={{ org: "globex", slug: "reviewer", kind: ApiResourceKind.agent }}
        onChange={vi.fn()}
      />,
      { wrapper: orgWrapper({}, undefined, true) },
    );

    expect(await screen.findByRole("option", { name: /Triager/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Reviewer/ })).toBeNull();
  });

  it("never offers an excluded agent, named by its org's slug or id", async () => {
    render(
      <AgentPicker
        org={GLOBEX_ID}
        value={null}
        onChange={vi.fn()}
        exclude={[{ org: "globex", slug: "reviewer" }]}
      />,
      { wrapper: orgWrapper({}, undefined, true) },
    );

    expect(await screen.findByRole("option", { name: /Triager/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Reviewer/ })).toBeNull();
  });
});
