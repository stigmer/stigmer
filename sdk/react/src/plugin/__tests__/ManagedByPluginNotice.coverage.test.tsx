/**
 * ManagedByPluginNotice names the plugin that installed a resource: nothing
 * when the resource is nobody's, the plugin's name as a link that hands the
 * host the plugin's reference when a route is given, plain text otherwise.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ManagedByPluginNotice } from "../ManagedByPluginNotice";

afterEach(cleanup);

const plugin = create(PluginSchema, { metadata: { org: "acme", slug: "github-kit", name: "GitHub Kit" } });

describe("ManagedByPluginNotice", () => {
  it("renders nothing when no plugin owns the resource", () => {
    const { container } = render(<ManagedByPluginNotice plugin={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("selecting the plugin's name hands the host the plugin's org and slug", () => {
    const onPluginClick = vi.fn();
    render(<ManagedByPluginNotice plugin={plugin} onPluginClick={onPluginClick} />);

    expect(screen.getByRole("note").textContent).toContain("Installed by the plugin GitHub Kit.");
    fireEvent.click(screen.getByRole("button", { name: "GitHub Kit" }));
    expect(onPluginClick).toHaveBeenCalledWith({ org: "acme", slug: "github-kit" });
  });

  it("names the plugin as plain text when the host gives no route", () => {
    render(<ManagedByPluginNotice plugin={plugin} />);
    expect(screen.getByRole("note").textContent).toContain("Installed by the plugin GitHub Kit.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
