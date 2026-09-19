/**
 * The upload path end to end in the browser's terms. Pins: a folder picked
 * through the directory input reaches the preview with the CLI's digest for
 * the thermos fixture and the upload origin in the header; Install pushes
 * exactly the prepared bytes and reports what landed; a zip of the same
 * folder reaches the same digest and the header says it was re-rooted; a
 * folder that arrives with no manifest (the dotfile-dropping browser) gets
 * the reader's refusal plus the sentence naming the zip path; a plain text
 * file offered as a zip is refused in its own words.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { zipSync } from "fflate";
import { Stigmer } from "@stigmer/sdk";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginMembersResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginMaterializationSchema, PluginState, PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { digestArchive } from "@stigmer/plugin-package/client";

import { StigmerContext } from "../../context.js";
import { PluginUploader } from "../PluginUploader.js";

afterEach(cleanup);

const ORG = "acme";
const THERMOS = `${resolve(process.cwd(), "../../backend/libs/ts/plugin-package/src/__tests__/fixtures/cursor-plugins/thermos")}/`;
/** The CLI's digest for the thermos fixture (backend/libs/ts/plugin-package/src/__tests__/client-select-archive.test.ts). */
const THERMOS_DIGEST = "51bc4e5450e24762bb8515765c76bfe262f65c57f9afeda015c5818038396d5a";

function bytesOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/** The fixture as `<input webkitdirectory>` yields it: `File`s named under the picked folder. */
function thermosAsInputFiles(pickedAs: string, keepDotfiles = true): File[] {
  const files: File[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile() && statSync(full).isFile()) {
        if (!keepDotfiles && path.split("/").some((segment) => segment.startsWith("."))) continue;
        const file = new File([bytesOf(readFileSync(full))], entry.name);
        Object.defineProperty(file, "webkitRelativePath", { value: `${pickedAs}/${path}` });
        files.push(file);
      }
    }
  };
  walk(THERMOS, "");
  return files;
}

/** The fixture zipped, every path under `wrapIn` (the shape `zip -r` gives a folder). */
function thermosAsZip(name: string, wrapIn: string): File {
  const tree: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else tree[`${wrapIn}${path}`] = new Uint8Array(readFileSync(full));
    }
  };
  walk(THERMOS, "");
  return new File([bytesOf(zipSync(tree))], name);
}

interface Backend {
  readonly pushes: Uint8Array[];
}

function transport(backend: Backend) {
  return createRouterTransport(({ service }) => {
    service(PluginCommandController, {
      push: async (req) => {
        backend.pushes.push(req.artifact);
        return create(PluginSchema, {
          metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: ORG, slug: "thermos", name: "thermos" }),
          status: create(PluginStatusSchema, {
            digest: await digestArchive(req.artifact),
            state: PluginState.READY,
            materialized: create(PluginMaterializationSchema, { skills: 1, mcpServers: 1, agents: 1 }),
          }),
        });
      },
    });
    service(PluginQueryController, {
      getByReference: () => {
        throw new ConnectError("no plugin", Code.NotFound);
      },
      listMembers: () => create(ListPluginMembersResponseSchema, { members: [] }),
    });
  });
}

function renderUploader(backend: Backend = { pushes: [] }, onComplete?: (outcome: unknown) => void) {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport(backend) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(<PluginUploader org={ORG} onComplete={onComplete} />, { wrapper });
}

function pickFolder(files: File[]): void {
  fireEvent.change(screen.getByTestId("plugin-folder-input"), { target: { files } });
}

/** The Install button once the organization has answered what it holds (it is disabled until then). */
async function installButton(): Promise<HTMLButtonElement> {
  const button = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

describe("PluginUploader", () => {
  it("previews a picked folder with the CLI's digest and installs exactly those bytes", async () => {
    const backend: Backend = { pushes: [] };
    const completed: unknown[] = [];
    renderUploader(backend, (outcome) => completed.push(outcome));

    pickFolder(thermosAsInputFiles("my-thermos"));
    await screen.findByRole("heading", { name: "Install thermos" });
    expect(screen.getByText(/From the folder 'my-thermos' into acme/)).toBeTruthy();
    expect(screen.getAllByText(/thermo-nuclear-review/).length).toBeGreaterThan(0);

    fireEvent.click(await installButton());
    await waitFor(() => expect(backend.pushes).toHaveLength(1));
    expect(await digestArchive(backend.pushes[0]!)).toBe(THERMOS_DIGEST);
    await screen.findByText(/Installed plugin 'thermos'/);
    expect(completed).toHaveLength(1);
  });

  it("previews a zip of the folder, re-rooted, at the same digest", async () => {
    const backend: Backend = { pushes: [] };
    renderUploader(backend);
    fireEvent.change(screen.getByTestId("plugin-zip-input"), { target: { files: [thermosAsZip("thermos.zip", "thermos/")] } });
    await screen.findByRole("heading", { name: "Install thermos" });
    expect(screen.getByText(/From thermos\.zip \(read from its 'thermos\/' folder\) into acme/)).toBeTruthy();
    fireEvent.click(await installButton());
    await waitFor(() => expect(backend.pushes).toHaveLength(1));
    expect(await digestArchive(backend.pushes[0]!)).toBe(THERMOS_DIGEST);
  });

  it("names the zip path when a picked folder arrives with no manifest, the dotfile-dropping browser's shape", async () => {
    renderUploader();
    pickFolder(thermosAsInputFiles("my-thermos", false));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("'my-thermos' cannot be installed");
    expect(alert.textContent).toContain("zip the folder and upload the .zip instead");
  });

  it("refuses a file that is not a zip in its own words", async () => {
    renderUploader();
    fireEvent.change(screen.getByTestId("plugin-zip-input"), {
      target: { files: [new File([bytesOf(new TextEncoder().encode("plain"))], "notes.zip")] },
    });
    await screen.findByText(/'notes\.zip' is not a zip archive/);
  });
});
