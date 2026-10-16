/**
 * InlineEditResourceList compares references by the id of the org they
 * name: stored references carry ids while a person types slugs, so a
 * reference typed by its org's slug is the same reference as a stored one
 * naming that org by id, and a typed one is added with the org's id. The
 * add form shows the default org's slug, never its id.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { OrgProvider, useOrg } from "../../organization/OrgProvider";
import { InlineEditResourceList } from "../InlineEditResourceList";
import type { ResourceRefRow } from "../types";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const orgs = [{ metadata: { id: ACME_ID, slug: "acme", name: "Acme" } }] as Organization[];

function Providers({ children }: { children: ReactNode }) {
  const client = {
    organization: { listMine: vi.fn().mockResolvedValue({ entries: orgs, nextPageToken: "" }) },
  };
  return (
    <StigmerContext.Provider value={client as never}>
      <OrgProvider>{children}</OrgProvider>
    </StigmerContext.Provider>
  );
}

/** Renders the list only once the person's organizations have loaded. */
function WhenLoaded({ children }: { children: ReactNode }) {
  return useOrg().isLoading ? null : <>{children}</>;
}

function renderEditing(value: ResourceRefRow[], onSave: (refs: ResourceRefRow[]) => Promise<boolean>) {
  render(
    <Providers>
      <WhenLoaded>
        <InlineEditResourceList
          value={value}
          onSave={onSave}
          editing
          resourceLabel="skill"
          defaultOrg={ACME_ID}
        />
      </WhenLoaded>
    </Providers>,
  );
}

async function typeReference(org: string, slug: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
  const orgInput = screen.getByPlaceholderText("org");
  fireEvent.change(orgInput, { target: { value: org } });
  const slugInput = screen.getByPlaceholderText("slug");
  fireEvent.change(slugInput, { target: { value: slug } });
  fireEvent.keyDown(slugInput, { key: "Enter" });
}

describe("InlineEditResourceList org comparison", () => {
  it("shows the default org's slug in the add form", async () => {
    renderEditing([], async () => true);

    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
    expect(screen.getByPlaceholderText("org")).toHaveProperty("value", "acme");
  });

  it("treats a reference typed by its org's slug as the stored one naming the org by id", async () => {
    const onSave = vi.fn(async (_refs: ResourceRefRow[]) => true);
    renderEditing([{ org: ACME_ID, slug: "triage", label: "triage" }], onSave);

    await typeReference("acme", "triage");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toEqual([{ org: ACME_ID, slug: "triage", label: "triage" }]);
  });

  it("adds a typed reference with its org's id", async () => {
    const onSave = vi.fn(async (_refs: ResourceRefRow[]) => true);
    renderEditing([], onSave);

    await typeReference("acme", "summarize");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toEqual([
      { org: ACME_ID, slug: "summarize", label: "summarize" },
    ]);
  });

  it("adds a reference typed without an org, from the add button, in the default org by id", async () => {
    const onSave = vi.fn(async (_refs: ResourceRefRow[]) => true);
    renderEditing([], onSave);

    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
    fireEvent.change(screen.getByPlaceholderText("org"), { target: { value: "" } });
    const slugInput = screen.getByPlaceholderText("slug");
    fireEvent.change(slugInput, { target: { value: "summarize" } });
    // The add button is the icon button that follows the slug field.
    const addButton = slugInput.nextElementSibling as HTMLButtonElement;
    expect(addButton.tagName).toBe("BUTTON");
    fireEvent.click(addButton);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toEqual([
      { org: ACME_ID, slug: "summarize", label: "summarize" },
    ]);
  });
});
