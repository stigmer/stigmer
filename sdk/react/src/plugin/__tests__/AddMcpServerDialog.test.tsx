/**
 * The "Add MCP server" form in its dialog, against an in-memory Connect
 * backend. Pins: Add stays off until the server has a name and a URL; the
 * header rows can be added, typed into and removed; Add pushes exactly the
 * plugin the library prepares from what was typed (name, URL, description,
 * the remaining headers) and hands the host the installed plugin; while the
 * push is in flight the form is locked and says "Adding…"; the reader's
 * refusal is shown in its sentences and a server's refusal as an error,
 * neither reaching the host; Cancel and Escape close the dialog, and a
 * closed dialog renders no form.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { type Plugin, PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { digestArchive } from "@stigmer/plugin-package/client";

import { StigmerContext } from "../../context.js";
import { AddMcpServerDialog } from "../AddMcpServerDialog.js";
import { prepareMcpServerPlugin } from "../useAddMcpServer.js";

afterEach(cleanup);

const ORG = "acme";
const LINEAR_URL = "https://mcp.linear.app/mcp";

interface Backend {
  /** The plugin slugs already installed. */
  readonly installed: readonly string[];
  /** The artifacts pushed, in order. */
  readonly pushes: Uint8Array[];
  /** When set, the push waits for this before it answers. */
  readonly hold?: Promise<void>;
}

function installed(slug: string): Plugin {
  return create(PluginSchema, { metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug, name: slug }) });
}

function renderDialog(backend: Backend, open = true) {
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: (ref) => {
        if (!backend.installed.includes(ref.slug)) throw new ConnectError("no plugin", Code.NotFound);
        return installed(ref.slug);
      },
    });
    service(PluginCommandController, {
      push: async (req) => {
        backend.pushes.push(req.artifact);
        await backend.hold;
        return installed("linear");
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const view = render(<AddMcpServerDialog org={ORG} open={open} onClose={onClose} onAdded={onAdded} className="host-class" />, { wrapper });
  return { onClose, onAdded, view };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: /^Add(ing…)?$/ }) as HTMLButtonElement;

function fillServer(name: string, url = LINEAR_URL) {
  fireEvent.change(field("Name"), { target: { value: name } });
  fireEvent.change(field("URL"), { target: { value: url } });
}

describe("AddMcpServerDialog", () => {
  it("keeps Add off until the server has a name and a URL", () => {
    const backend: Backend = { installed: [], pushes: [] };
    renderDialog(backend);

    expect(screen.getByRole("heading", { name: "Add MCP server" })).toBeTruthy();
    expect(addButton().disabled).toBe(true);
    fireEvent.change(field("Name"), { target: { value: "linear" } });
    expect(addButton().disabled).toBe(true);
    // A submit the button would not allow pushes nothing.
    fireEvent.submit(addButton().closest("form")!);
    expect(backend.pushes).toEqual([]);

    fireEvent.change(field("URL"), { target: { value: LINEAR_URL } });
    expect(addButton().disabled).toBe(false);
  });

  it("pushes the plugin prepared from what was typed, headers included, and hands the host the plugin", async () => {
    const backend: Backend = { installed: [], pushes: [] };
    const { onAdded } = renderDialog(backend);

    fillServer("linear");
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Linear's issues." } });

    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    const names = screen.getAllByLabelText("Header name");
    const values = screen.getAllByLabelText("Header value");
    fireEvent.change(names[0]!, { target: { value: "Authorization" } });
    fireEvent.change(values[0]!, { target: { value: "Bearer ${LINEAR_API_KEY}" } });
    fireEvent.change(names[1]!, { target: { value: "X-Drop" } });
    fireEvent.change(values[1]!, { target: { value: "gone" } });
    // A row without a name is named "row" in its Remove label.
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    expect(screen.getByRole("button", { name: "Remove header row" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove header row" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove header X-Drop" }));
    expect(screen.getAllByLabelText("Header name")).toHaveLength(1);

    fireEvent.click(addButton());

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onAdded.mock.calls[0]![0].metadata?.slug).toBe("linear");
    expect(backend.pushes).toHaveLength(1);
    const expected = await prepareMcpServerPlugin({
      name: "linear",
      url: LINEAR_URL,
      description: "Linear's issues.",
      headers: { Authorization: "Bearer ${LINEAR_API_KEY}" },
    });
    expect(await digestArchive(backend.pushes[0]!)).toBe(expected.digest);
  });

  it("locks the form and says Adding… while the push is in flight", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend: Backend = { installed: [], pushes: [], hold };
    const { onAdded } = renderDialog(backend);

    fillServer("linear");
    fireEvent.click(addButton());

    await waitFor(() => expect(addButton().textContent).toBe("Adding…"));
    expect(addButton().disabled).toBe(true);
    expect(field("Name").disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(addButton().textContent).toBe("Add");
  });

  it("shows the reader's refusal in its sentences, and the host hears nothing", async () => {
    const backend: Backend = { installed: [], pushes: [] };
    const { onAdded } = renderDialog(backend);

    fillServer("Linear Server");
    fireEvent.click(addButton());

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("'Linear Server' cannot be added");
    expect(backend.pushes).toEqual([]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as an error, and the host hears nothing", async () => {
    const backend: Backend = { installed: ["linear"], pushes: [] };
    const { onAdded } = renderDialog(backend);

    fillServer("linear");
    fireEvent.click(addButton());

    expect(await screen.findByText("The server could not be added")).toBeTruthy();
    expect(screen.getByText(/a plugin named 'linear' is installed already/)).toBeTruthy();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("closes on Cancel and on Escape", () => {
    const { onClose, view } = renderDialog({ installed: [], pushes: [] });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent(view.container.ownerDocument.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders no form while closed", () => {
    renderDialog({ installed: [], pushes: [] }, false);
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});
