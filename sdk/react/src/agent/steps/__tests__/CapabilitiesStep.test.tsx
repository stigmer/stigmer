/**
 * The agent wizard's Capabilities step and its plugins. Pins: the Plugins
 * section starts open when the wizard already holds plugins and closed
 * when it holds none; a plugin picked there is written to the wizard's
 * `plugins`, after the ones it holds.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { CapabilitiesStep } from "../CapabilitiesStep";
import { createInitialWizardData } from "../types";
import { ACME_ID, orgWrapper } from "../../../organization/__tests__/org-fixture";

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

const NOTION = { id: "plg_2", org: ACME_ID, slug: "notion", name: "Notion", description: "" } as SearchResult;
const LINEAR_REF = { org: ACME_ID, slug: "linear", kind: ApiResourceKind.plugin };

function renderStep(plugins: (typeof LINEAR_REF)[]) {
  const updateData = vi.fn();
  render(<CapabilitiesStep org={ACME_ID} data={{ ...createInitialWizardData(), plugins }} updateData={updateData} />, {
    wrapper: orgWrapper({ plugin: { list: vi.fn(async () => ({ entries: [NOTION], totalPages: 1 })) } }, undefined, true),
  });
  return { updateData };
}

describe("CapabilitiesStep (agent) plugins", () => {
  it("opens Plugins on the plugins the wizard holds and appends a picked one", async () => {
    const { updateData } = renderStep([LINEAR_REF]);

    expect((await screen.findByRole("button", { name: /Plugins/ })).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Remove linear" })).toBeTruthy();

    fireEvent.click(await screen.findByRole("option", { name: /Notion/ }));
    expect(updateData).toHaveBeenCalledWith({
      plugins: [LINEAR_REF, { org: ACME_ID, slug: "notion", kind: ApiResourceKind.plugin }],
    });
  });

  it("keeps Plugins closed when the wizard holds none", async () => {
    renderStep([]);
    expect((await screen.findByRole("button", { name: /Plugins/ })).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
