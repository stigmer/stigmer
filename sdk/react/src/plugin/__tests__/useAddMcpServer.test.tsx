/**
 * "Add MCP server": a server at an address becomes a plugin of one server,
 * built in the browser. Pins: the files are the Claude Code layout, a
 * `.claude-plugin/plugin.json` naming the plugin after the server and a
 * `.mcp.json` holding the one HTTP entry with its headers; the library
 * reads them as one server at that URL and declares a key a header names;
 * a name the reader refuses is refused before any push, in its sentences;
 * the push sends exactly the prepared archive (its digest is the one the
 * library computes) through the plugin push; a name already installed is
 * refused without a push, and so is a name whose read fails for another
 * reason; `clearError` drops the held refusal. A change pushes the form's
 * server under the plugin's own name at the plugin's current visibility,
 * and is refused without a push when the installed version is no longer
 * the one the form was read from.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { digestArchive } from "@stigmer/plugin-package/client";

import { StigmerContext } from "@stigmer/react-core";
import { PluginReadRefusal } from "../sources/read.js";
import { mcpServerPluginFiles, prepareMcpServerPlugin, useAddMcpServer } from "../useAddMcpServer.js";

afterEach(cleanup);

const LINEAR = { name: "linear", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ${LINEAR_API_KEY}" } };

describe("mcpServerPluginFiles", () => {
  it("names the plugin after the server and holds the one HTTP entry", () => {
    const files = mcpServerPluginFiles({ ...LINEAR, description: "Linear's issues." });
    expect([...files.keys()]).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
    expect(JSON.parse(files.get(".claude-plugin/plugin.json") ?? "")).toEqual({ name: "linear", description: "Linear's issues." });
    expect(JSON.parse(files.get(".mcp.json") ?? "")).toEqual({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ${LINEAR_API_KEY}" } } },
    });
  });

  it("leaves headers out when there are none, and drops a header without a name", () => {
    const files = mcpServerPluginFiles({ name: "linear", url: "https://mcp.linear.app/mcp", headers: { " ": "x" } });
    expect(JSON.parse(files.get(".mcp.json") ?? "")).toEqual({ mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } });
  });
});

describe("prepareMcpServerPlugin", () => {
  it("is read as one server at the URL, declaring the key a header names", async () => {
    const prepared = await prepareMcpServerPlugin(LINEAR);
    expect(prepared.plugin.name).toBe("linear");
    expect(prepared.plugin.mcpServers.map((server) => server.name)).toEqual(["linear"]);
    expect(prepared.digest).toBe(await digestArchive(prepared.archive));
    expect(JSON.stringify(prepared.plugin)).toContain("LINEAR_API_KEY");
  });

  it("refuses a name the reader refuses, in its sentences", async () => {
    await expect(prepareMcpServerPlugin({ name: "Linear Server", url: "https://mcp.linear.app/mcp" })).rejects.toBeInstanceOf(PluginReadRefusal);
  });
});

describe("useAddMcpServer", () => {
  function setup(installed: readonly string[]) {
    const pushes: Uint8Array[] = [];
    const transport = createRouterTransport(({ service }) => {
      service(PluginQueryController, {
        getByReference: (ref) => {
          if (ref.slug === "unreachable") throw new ConnectError("the plugin store is down", Code.Unavailable);
          if (!installed.includes(ref.slug)) throw new ConnectError("no plugin", Code.NotFound);
          return create(PluginSchema, { metadata: create(ApiResourceMetadataSchema, { org: "acme", slug: ref.slug, name: ref.slug }) });
        },
      });
      service(PluginCommandController, {
        push: (req) => {
          pushes.push(req.artifact);
          return create(PluginSchema, { metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: req.org, slug: "linear", name: "linear" }) });
        },
      });
    });
    const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
    const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
    return { hook: renderHook(() => useAddMcpServer(), { wrapper }), pushes };
  }

  it("pushes exactly the prepared archive and answers the installed plugin", async () => {
    const { hook, pushes } = setup([]);
    let slug = "";
    await act(async () => {
      slug = (await hook.result.current.add(LINEAR, { org: "acme" })).metadata?.slug ?? "";
    });
    expect(slug).toBe("linear");
    expect(pushes).toHaveLength(1);
    expect(await digestArchive(pushes[0]!)).toBe((await prepareMcpServerPlugin(LINEAR)).digest);
    expect(hook.result.current.error).toBeNull();
  });

  it("refuses a name already installed without pushing", async () => {
    const { hook, pushes } = setup(["linear"]);
    await act(async () => {
      await expect(hook.result.current.add(LINEAR, { org: "acme" })).rejects.toThrow(/a plugin named 'linear' is installed already/);
    });
    expect(pushes).toEqual([]);
    expect(hook.result.current.error?.message).toMatch(/installed already/);
  });

  it("holds the reader's refusal without pushing", async () => {
    const { hook, pushes } = setup([]);
    await act(async () => {
      await expect(hook.result.current.add({ name: "", url: "https://mcp.linear.app/mcp" }, { org: "acme" })).rejects.toBeInstanceOf(PluginReadRefusal);
    });
    expect(hook.result.current.error).toBeInstanceOf(PluginReadRefusal);
    expect(pushes).toEqual([]);
  });

  it("holds a read failure other than not-found without pushing, and clearError drops it", async () => {
    const { hook, pushes } = setup([]);
    await act(async () => {
      await expect(hook.result.current.add({ name: "unreachable", url: "https://mcp.linear.app/mcp" }, { org: "acme" })).rejects.toThrow(
        /the plugin store is down/,
      );
    });
    expect(pushes).toEqual([]);
    expect(hook.result.current.error?.message).toMatch(/the plugin store is down/);

    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeNull();
  });
});

describe("useAddMcpServer: change", () => {
  const READ = "a".repeat(64);

  function installed(digest: string): Plugin {
    return create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, {
        id: "plg_1",
        org: "acme",
        slug: "linear",
        name: "linear",
        visibility: ApiResourceVisibility.visibility_org,
      }),
      status: { digest },
    });
  }

  function setupChange(currentDigest: string) {
    const pushes: { artifact: Uint8Array; visibility: ApiResourceVisibility; org: string }[] = [];
    const transport = createRouterTransport(({ service }) => {
      service(PluginQueryController, { getByReference: () => installed(currentDigest) });
      service(PluginCommandController, {
        push: (req) => {
          pushes.push({ artifact: req.artifact, visibility: req.visibility, org: req.org });
          return installed("b".repeat(64));
        },
      });
    });
    const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
    const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
    return { hook: renderHook(() => useAddMcpServer(), { wrapper }), pushes };
  }

  it("pushes the new address under the plugin's name, at its visibility", async () => {
    const { hook, pushes } = setupChange(READ);
    await act(async () => {
      await hook.result.current.change({ name: "ignored", url: "https://mcp.linear.app/v2/mcp" }, { plugin: installed(READ) });
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.org).toBe("acme");
    expect(pushes[0]!.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(await digestArchive(pushes[0]!.artifact)).toBe(
      (await prepareMcpServerPlugin({ name: "linear", url: "https://mcp.linear.app/v2/mcp" })).digest,
    );
  });

  it("refuses without a push when the plugin changed since the form read it", async () => {
    const { hook, pushes } = setupChange("c".repeat(64));
    await act(async () => {
      await expect(
        hook.result.current.change({ name: "linear", url: "https://mcp.linear.app/v2/mcp" }, { plugin: installed(READ) }),
      ).rejects.toThrow(/'linear' was changed since this page read it/);
    });
    expect(pushes).toEqual([]);
  });
});
