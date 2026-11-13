/**
 * Pins when the workbench draws its toolbar: a workbench with no search,
 * one view and no header act (none, or a gated act that is `false`) draws
 * no toolbar row at all, and one with a header act draws the row with the
 * act at its right.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkbenchPage, WorkbenchPageRequest } from "../types";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ResourceWorkbench } from "../components/ResourceWorkbench";

vi.mock("../../server-info.js", () => ({
  useSingleOrg: () => false,
}));

afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return <FetchCacheContext.Provider value={null}>{children}</FetchCacheContext.Provider>;
}

const listFn = async (_req: WorkbenchPageRequest): Promise<WorkbenchPage> => ({ entries: [], nextPageToken: "" });

/** The spacer that keeps a toolbar's act at the right when there is no search box. */
const spacer = (container: HTMLElement) => container.querySelector('div[aria-hidden="true"].stg\\:flex-1');

describe("ResourceWorkbench toolbar", () => {
  it.each([
    ["no header act", undefined],
    ["a gated header act that is false", false],
  ])("draws no toolbar with no search, one view and %s", async (_name, headerAction) => {
    const { container } = render(
      <ResourceWorkbench listFn={listFn} org="acme" searchable={false} viewModes={["list"]} headerAction={headerAction} emptyTitle="No files yet" />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText("No files yet")).toBeTruthy());
    expect(spacer(container)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("draws the toolbar with its act when there is one", async () => {
    const { container } = render(
      <ResourceWorkbench listFn={listFn} org="acme" searchable={false} viewModes={["list"]} headerAction={<button type="button">Upload</button>} emptyTitle="No files yet" />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText("No files yet")).toBeTruthy());
    expect(spacer(container)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
  });
});
