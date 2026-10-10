/**
 * The plugins picker over the organization's installed plugins, driven
 * through the real search hook against a client whose `plugin.list`
 * answers a fixed catalog filtered by the query. Pins: each installed
 * plugin is an option with its org's slug and its description; a click or
 * Enter on the focused option appends a plugin reference and hands the
 * host its display name; the arrow keys move the focus within the list and
 * back to the search box; a picked plugin is listed under Selected,
 * removable, and no longer offered; the search highlights where the query
 * meets a name; and the empty, loading and refused states each say so.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ListParams, ResourceRef } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { PluginPicker } from "../PluginPicker";

const scrollIntoView = vi.fn();

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

function result(id: string, org: string, slug: string, name: string, description: string): SearchResult {
  return { id, org, slug, name, description } as SearchResult;
}

const LINEAR = result("plg_1", ACME_ID, "linear", "Linear", "Issues and projects.");
const NOTION = result("plg_2", ACME_ID, "notion", "Notion", "");
const SEARCH = result("plg_3", GLOBEX_ID, "search", "Web search", "Search the web.");
const CATALOG = [LINEAR, NOTION, SEARCH];

/** A `plugin.list` that answers the catalog entries whose name or description holds the query. */
function catalogList(catalog: readonly SearchResult[]) {
  return vi.fn(async (params: ListParams) => {
    const query = (params.query ?? "").toLowerCase();
    const entries = catalog.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query));
    return { entries, totalPages: 1 };
  });
}

interface RenderOptions {
  readonly value?: ResourceRef[];
  readonly list?: (params: ListParams) => Promise<unknown>;
  readonly disabled?: boolean;
}

function renderPicker({ value = [], list = catalogList(CATALOG), disabled }: RenderOptions = {}) {
  const onChange = vi.fn();
  const onDisplayNameResolved = vi.fn();
  render(
    <PluginPicker
      org={ACME_ID}
      value={value}
      onChange={onChange}
      onDisplayNameResolved={onDisplayNameResolved}
      disabled={disabled}
      className="host-class"
    />,
    { wrapper: orgWrapper({ plugin: { list } }, undefined, true) },
  );
  return { onChange, onDisplayNameResolved, list };
}

const pluginRef = (org: string, slug: string): ResourceRef => ({ org, slug, kind: ApiResourceKind.plugin });

describe("PluginPicker", () => {
  it("offers each installed plugin, and a click picks it as a plugin reference", async () => {
    const { onChange, onDisplayNameResolved, list } = renderPicker();

    const linear = await screen.findByRole("option", { name: /Linear/ });
    expect(linear.textContent).toContain("Issues and projects.");
    expect(within(screen.getByRole("option", { name: /Web search/ })).getByText("globex")).toBeTruthy();
    expect(list).toHaveBeenCalledWith({ org: ACME_ID, query: undefined, page: { num: 1, size: 30 } });

    fireEvent.click(linear);
    expect(onChange).toHaveBeenCalledWith([pluginRef(ACME_ID, "linear")]);
    expect(onDisplayNameResolved).toHaveBeenCalledWith(`${ACME_ID}/linear`, "Linear");
  });

  it("moves the focus with the arrow keys and picks the focused plugin with Enter", async () => {
    const { onChange } = renderPicker();
    await screen.findByRole("option", { name: /Linear/ });
    const search = screen.getByRole("combobox");

    // Enter with nothing focused picks nothing.
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("stgm-plugin-0");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    // The last option holds the focus.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe("stgm-plugin-2");
    expect(screen.getByRole("option", { name: /Web search/ }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search.getAttribute("aria-activedescendant")).toBe("stgm-plugin-1");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith([pluginRef(ACME_ID, "notion")]);

    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
    // Another key leaves the focus where it is.
    fireEvent.keyDown(search, { key: "Tab" });
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("lists the picked plugins under Selected, removable, and offers only the rest", async () => {
    const { onChange } = renderPicker({ value: [pluginRef("acme", "linear"), pluginRef(GLOBEX_ID, "search")] });

    expect(await screen.findByText("Selected")).toBeTruthy();
    await screen.findByRole("option", { name: /Notion/ });
    expect(screen.queryByRole("option", { name: /Linear/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Web search/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove linear" }));
    expect(onChange).toHaveBeenCalledWith([pluginRef(GLOBEX_ID, "search")]);
  });

  it("says every installed plugin is selected when none is left to offer", async () => {
    renderPicker({ value: [pluginRef(ACME_ID, "linear")], list: catalogList([LINEAR]) });
    expect(await screen.findByText("All installed plugins selected")).toBeTruthy();
  });

  it("searches as the person types, highlighting where the query meets a name", async () => {
    const { list } = renderPicker();
    await screen.findByRole("option", { name: /Notion/ });
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.change(search, { target: { value: "lin" } });
    // A new query drops the focus.
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("option", { name: /Notion/ })).toBeNull());
    expect(list).toHaveBeenLastCalledWith({ org: ACME_ID, query: "lin", page: { num: 1, size: 30 } });
    const [only] = screen.getAllByRole("option");
    expect(only?.textContent).toContain("Linear");
    const highlighted = within(only!).getByText("Lin");
    expect(highlighted.className).toContain("stg:font-semibold");

    // A plugin found by its description shows its name as it is.
    fireEvent.change(search, { target: { value: "issues" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: "issues" })));
    const linear = await screen.findByRole("option", { name: /Linear/ });
    expect(within(linear).getByText("Linear").className).toContain("stg:font-medium");

    fireEvent.change(search, { target: { value: "nothing like it" } });
    expect(await screen.findByText("No plugins match your search")).toBeTruthy();
  });

  it("says no plugin is installed when the organization has none", async () => {
    renderPicker({ list: catalogList([]) });
    expect(await screen.findByText("No plugins installed")).toBeTruthy();
  });

  it("shows a loading list while the search is in flight", async () => {
    renderPicker({ list: () => new Promise<never>(() => undefined) });
    const listbox = await screen.findByRole("listbox", { name: "Plugins" });
    await waitFor(() => expect(listbox.querySelectorAll(".stg\\:animate-pulse").length).toBe(8));
    expect(within(listbox).queryByRole("option")).toBeNull();
  });

  it("shows the search's refusal", async () => {
    renderPicker({ list: () => Promise.reject(new Error("the plugin listing is unavailable")) });
    expect(await screen.findByText("the plugin listing is unavailable")).toBeTruthy();
  });

  it("disables the search, the options and Remove when disabled", async () => {
    renderPicker({ value: [pluginRef(ACME_ID, "notion")], disabled: true });
    const linear = await screen.findByRole("option", { name: /Linear/ });
    expect(linear).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Remove notion" })).toHaveProperty("disabled", true);
  });
});
