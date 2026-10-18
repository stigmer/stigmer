/**
 * Pins the Environment picker against an in-process server:
 * - the first row says what applies when the field is left empty, and
 *   choosing it clears the field;
 * - the rows below it are the Environments the caller can view, by name,
 *   and choosing one names it by its organization and slug;
 * - a stored choice the caller cannot view stays listed by its slug, so the
 *   select shows the value it holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { EnvironmentPicker } from "../EnvironmentPicker";

const ORG = "org_acme";

const DATA_SCIENCE = create(EnvironmentSchema, {
  metadata: { id: "env_ds", org: ORG, slug: "data-science", name: "Data science" },
});
const BASE_TOOLS = create(EnvironmentSchema, {
  metadata: { id: "env_bt", org: ORG, slug: "base-tools", name: "" },
});

function clientListing() {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(EnvironmentQueryController, {
        list: () => create(EnvironmentListSchema, { entries: [DATA_SCIENCE, BASE_TOOLS], nextPageToken: "" }),
      });
    }),
  });
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={clientListing()}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

afterEach(cleanup);

describe("EnvironmentPicker", () => {
  it("offers the inherited row first, then the caller's Environments by name", async () => {
    render(
      <EnvironmentPicker
        org={ORG}
        value={undefined}
        onChange={() => {}}
        defaultLabel="Default: base-tools (the organization's default)"
      />,
      { wrapper: Providers },
    );
    await waitFor(() => expect(screen.getByRole("option", { name: "Data science" })).toBeTruthy());
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Default: base-tools (the organization's default)", "Data science", "base-tools"]);
    expect((screen.getByRole("combobox", { name: "Environment" }) as HTMLSelectElement).value).toBe("");
  });

  it("names a chosen Environment by organization and slug, and clears the field on the inherited row", async () => {
    const onChange = vi.fn();
    render(<EnvironmentPicker org={ORG} value={{ org: ORG, slug: "base-tools" }} onChange={onChange} />, {
      wrapper: Providers,
    });
    await waitFor(() => expect(screen.getByRole("option", { name: "Data science" })).toBeTruthy());
    const select = screen.getByRole("combobox", { name: "Environment" });
    fireEvent.change(select, { target: { value: "data-science" } });
    expect(onChange).toHaveBeenLastCalledWith({ org: ORG, slug: "data-science" });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps a stored choice the caller cannot view, by its slug", async () => {
    render(<EnvironmentPicker org={ORG} value={{ org: ORG, slug: "private-box" }} onChange={() => {}} />, {
      wrapper: Providers,
    });
    await waitFor(() => expect(screen.getByRole("option", { name: "Data science" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "private-box" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Environment" }) as HTMLSelectElement).value).toBe("private-box");
  });
});
