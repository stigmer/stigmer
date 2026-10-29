/**
 * SkillPicker shows each search result's organization by its slug, while a
 * picked reference keeps the id the result's org is stored by, and a skill
 * already selected by its org's slug is not offered again by its id; removing
 * one drops every attachment of that skill in its org, and a skill whose
 * target was deleted is shown and removed by id. The search hook is stubbed;
 * the organization list is the mounted OrgProvider's.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/client";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const RESULT = {
  id: "skl_1",
  org: GLOBEX_ID,
  slug: "triage-guide",
  name: "Triage guide",
  description: "",
};

vi.mock("../useSkillSearch.js", () => ({
  useSkillSearch: () => ({
    results: [RESULT],
    isLoading: false,
    error: null,
    query: "",
    setQuery: () => {},
  }),
}));

import { SkillPicker } from "../SkillPicker";

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

describe("SkillPicker organizations", () => {
  it("shows a result's org slug and picks the reference by the org's id", async () => {
    const onChange = vi.fn();
    render(<SkillPicker org={GLOBEX_ID} value={[]} onChange={onChange} />, {
      wrapper: orgWrapper(),
    });

    const option = screen.getByRole("option", { name: /Triage guide/ });
    expect(await screen.findByText("globex")).toBeTruthy();
    expect(option.textContent).not.toContain(GLOBEX_ID);

    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith([
      { org: GLOBEX_ID, slug: "triage-guide", kind: ApiResourceKind.skill },
    ]);
  });

  it("does not offer a skill already selected by its org's slug", async () => {
    render(
      <SkillPicker
        org={GLOBEX_ID}
        value={[{ org: "globex", slug: "triage-guide", kind: ApiResourceKind.skill }]}
        onChange={vi.fn()}
      />,
      { wrapper: orgWrapper({}, undefined, true) },
    );

    expect(await screen.findByText("Selected")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Triage guide/ })).toBeNull();
  });
});

describe("SkillPicker removal compares references by org id", () => {
  it("drops every attachment of the removed skill, and only in its org", async () => {
    const onChange = vi.fn();
    const value: ResourceRef[] = [
      { org: ACME_ID, slug: "triage" },
      { org: "acme", slug: "triage" },
      { org: "globex", slug: "triage" },
    ];
    render(<SkillPicker org={ACME_ID} value={value} onChange={onChange} />, { wrapper: orgWrapper({}, undefined, true) });

    fireEvent.click((await screen.findAllByRole("button", { name: "Remove triage" }))[0]!);

    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ org: "globex", slug: "triage" }]);
  });

  it("shows a skill whose target was deleted, and removes only that one, told apart by id", async () => {
    const onChange = vi.fn();
    const deleted: ResourceRef[] = [
      { org: ACME_ID, slug: "", id: "skl_first" },
      { org: ACME_ID, slug: "", id: "skl_second" },
    ];
    render(<SkillPicker org={ACME_ID} value={deleted} onChange={onChange} />, { wrapper: orgWrapper({}, undefined, true) });

    fireEvent.click((await screen.findAllByRole("button", { name: "Remove deleted skill" }))[0]!);

    expect(onChange).toHaveBeenCalledExactlyOnceWith([deleted[1]]);
  });
});
